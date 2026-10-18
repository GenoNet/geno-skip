(() => {
  'use strict';
  const settingsApi = globalThis.GenoSkipSettings;
  let settings = settingsApi.fromStorage();
  let ready = false;
  let pageActive = true;
  let session = null;
  let timer = null;
  let reason = '';
  let observer = null;
  let resizeObserver = null;
  let appearanceObserver = null;
  const observedVideos = new Set();
  let refreshFrame = null;
  const buttons = new Map();
  const adSkippers = new Map();
  const lifecycleEvents = ['ended', 'emptied', 'loadstart'];
  const playerSelector = 'video, .html5-video-player, .ytp-right-controls, .ytp-chrome-controls';
  const supported = () => ready && pageActive && settingsApi.matches(location.hostname, settings.videoUrls);
  const adAccelerationFor = video => [...adSkippers.values()].find(skipper => skipper.isAccelerating(video));
  const videoIsActive = video => session?.video === video || !!adAccelerationFor(video);
  const getAccelerationState = () => {
    const skipStatus = [...adSkippers.values()].map(skipper => skipper.getStatus()).find(Boolean);
    return { isActive: !!session || !!adAccelerationFor(), ...(reason ? { reason } : {}), ...(skipStatus ? { skipStatus } : {}) };
  };

  function updateButton(video, button) {
    button.setActive(videoIsActive(video));
    button.setEffect(settings.showSkipEffect && (session?.video === video || [...adSkippers.values()].some(skipper => skipper.isSkipping(video))));
  }

  function publishState() {
    for (const [video, button] of buttons) updateButton(video, button);
    try {
      chrome.runtime.sendMessage({ type: 'ACCEL_STATE', ...getAccelerationState() }, () => { void chrome.runtime.lastError; });
    } catch { /* Extension may have been reloaded while the tab stayed open. */ }
  }

  function restore(saved) {
    // Restore independently: a disconnected or site-controlled element may reject a property.
    for (const [property, value] of [['playbackRate', saved.rate], ['volume', saved.volume], ['muted', saved.muted]]) {
      try { saved.video[property] = value; } catch { /* Keep restoring remaining properties. */ }
    }
  }

  function stopAcceleration(stopReason = '') {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (session) {
      const saved = session;
      session = null;
      lifecycleEvents.forEach(type => saved.video.removeEventListener(type, onVideoReset));
      saved.video.removeEventListener('ratechange', onRateChange);
      saved.video.removeEventListener('volumechange', onVolumeChange);
      restore(saved);
    }
    reason = stopReason;
    publishState();
  }

  function onVideoReset() { stopAcceleration(); }

  function onRateChange() {
    if (session && session.video.playbackRate !== 16) stopAcceleration('プレーヤーに速度を戻された！いったん加速をやめるぞ！');
  }

  function muteSession(saved) {
    if (saved.video.muted) return;
    if (saved.muteAttempts >= 3) throw new Error('Mute repeatedly reset');
    saved.muteAttempts++;
    saved.video.muted = true;
    if (!saved.video.muted) throw new Error('Mute rejected');
  }

  function onVolumeChange() {
    if (!session) return;
    try { muteSession(session); }
    catch { stopAcceleration('プレーヤーにミュートを戻された！加速をやめるぞ！'); }
  }

  function layoutArea(video) {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    if (style.visibility === 'hidden' || style.display === 'none' ||
        (video.checkVisibility && !video.checkVisibility())) return 0;
    return rect.width * rect.height;
  }

  function visibleArea(video) {
    const rect = video.getBoundingClientRect();
    if (layoutArea(video) <= 0) return 0;
    return Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) *
      Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
  }

  function chooseVideo() {
    return [...document.querySelectorAll('video')].map(video => ({ video, area: visibleArea(video) }))
      .filter(item => item.area > 0)
      .sort((a, b) => Number(!b.video.paused && !b.video.ended) - Number(!a.video.paused && !a.video.ended) || b.area - a.area)[0]?.video;
  }

  function startAcceleration(video) {
    if (!supported()) { reason = 'このサイトはまだ登録されてないぞ！設定で追加してくれ！'; publishState(); return false; }
    if (!video?.isConnected) { reason = '動画が見つからないぞ！動画のあるページで頼む！'; publishState(); return false; }
    if (session) stopAcceleration();
    const saved = { video, rate: video.playbackRate, volume: video.volume, muted: video.muted, muteAttempts: 0 };
    try {
      video.playbackRate = 16;
      if (video.playbackRate !== 16) throw new Error('Rate rejected');
      muteSession(saved);
    } catch {
      restore(saved);
      reason = 'ここのプレーヤー、16倍速かミュートを受け付けないぞ！';
      publishState();
      return false;
    }
    session = saved;
    reason = '';
    lifecycleEvents.forEach(type => video.addEventListener(type, onVideoReset));
    video.addEventListener('ratechange', onRateChange);
    video.addEventListener('volumechange', onVolumeChange);
    timer = setTimeout(() => stopAcceleration(), 3000);
    publishState();
    return true;
  }

  function toggleAcceleration(video) {
    const adAcceleration = adAccelerationFor(video || session?.video || chooseVideo());
    if (adAcceleration) adAcceleration.cancelAcceleration();
    else if (session && (!video || session.video === video)) stopAcceleration();
    else startAcceleration(video || chooseVideo());
  }

  function refreshButtons() {
    refreshFrame = null;
    if (!supported()) return;
    if (session && !session.video.isConnected) stopAcceleration();
    if (!globalThis.GenoPlayerButtons) return;
    const videos = [...document.querySelectorAll('video')];
    for (const video of observedVideos) {
      if (!video.isConnected) { resizeObserver?.unobserve(video); observedVideos.delete(video); }
    }
    appearanceObserver?.disconnect();
    const appearanceTargets = new Set();
    for (const video of videos) {
      if (!observedVideos.has(video)) { resizeObserver?.observe(video); observedVideos.add(video); }
      // Observe only ancestors of videos, rather than every page attribute change.
      for (let element = video; element; element = element.parentElement) appearanceTargets.add(element);
    }
    for (const element of appearanceTargets) appearanceObserver?.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    const players = new Map();
    for (const video of videos) {
      const area = layoutArea(video);
      if (area <= 0) continue;
      const root = video.closest('.html5-video-player') || video.parentElement;
      if (!root) continue;
      const key = video.closest('.html5-video-player') || video;
      const previous = players.get(key);
      if (!previous || area > previous.area) players.set(key, { root, video, area });
    }
    const selected = new Set([...players.values()].map(player => player.video));
    for (const [video, button] of buttons) {
      if (!selected.has(video)) {
        if (session?.video === video) stopAcceleration();
        button.destroy(); buttons.delete(video);
      }
    }
    for (const { root, video } of players.values()) {
      const button = globalThis.GenoPlayerButtons.mount({ root, video, onToggle: () => toggleAcceleration(video), accelerationKey: settings.accelerationKey });
      buttons.set(video, button);
      updateButton(video, button);
    }
    configureAdSkipping();
  }

  function configureAdSkipping() {
    if (!globalThis.GenoAdSkip) return;
    const roots = new Set(settingsApi.matches(location.hostname, ['youtube.com', 'youtube-nocookie.com']) ?
      document.querySelectorAll('.html5-video-player') : []);
    for (const [root, skipper] of adSkippers) {
      if (!roots.has(root)) { skipper.destroy(); adSkippers.delete(root); }
    }
    for (const root of roots) {
      if (!adSkippers.has(root)) adSkippers.set(root, globalThis.GenoAdSkip.watch(root, {
        getVideo: () => [...buttons.keys()].find(video => video.isConnected && video.closest('.html5-video-player') === root),
        onBeforeAccelerate: video => { if (session?.video === video) stopAcceleration(); },
        onStateChange: publishState,
        onBeforeSkip: () => { if (session && root.contains(session.video)) stopAcceleration(); },
        useDebugger: () => settings.debuggerSkip,
        requestSkip: token => new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'GENO_DEBUGGER_SKIP', token }, response => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response);
          });
        }),
        onSkipError: message => { reason = message; publishState(); }
      }));
      adSkippers.get(root).check();
    }
  }

  function stopAdSkipping() {
    for (const skipper of adSkippers.values()) skipper.destroy();
    adSkippers.clear();
  }

  function scheduleRefresh() {
    if (supported() && refreshFrame === null) refreshFrame = requestAnimationFrame(refreshButtons);
  }

  function relevantNode(node) {
    return node.nodeType === Node.ELEMENT_NODE && !node.closest('.geno-skip-button, .geno-skip-dock') &&
      (node.matches(playerSelector) || !!node.querySelector(playerSelector));
  }

  function configureMonitoring() {
    if (!supported()) {
      observer?.disconnect(); observer = null;
      resizeObserver?.disconnect(); resizeObserver = null;
      appearanceObserver?.disconnect(); appearanceObserver = null;
      observedVideos.clear();
      if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
      refreshFrame = null;
      stopAcceleration();
      for (const button of buttons.values()) button.destroy();
      buttons.clear();
      stopAdSkipping();
      return;
    }
    if (!observer) {
      observer = new MutationObserver(records => {
        if (session && !session.video.isConnected) stopAcceleration();
        const lostButton = records.some(record => [...record.removedNodes].some(node =>
          node.nodeType === Node.ELEMENT_NODE &&
          (node.matches('.geno-skip-button') || node.querySelector('.geno-skip-button'))));
        if (lostButton || records.some(record => [...record.addedNodes, ...record.removedNodes].some(relevantNode))) scheduleRefresh();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      resizeObserver = new ResizeObserver(scheduleRefresh);
      appearanceObserver = new MutationObserver(scheduleRefresh);
    }
    refreshButtons();
  }

  document.addEventListener('keydown', event => {
    if (!supported() || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    // Shift is needed to type punctuation shortcuts (e.g. !), but not alphabetic ones.
    if (event.shiftKey && event.key.toLowerCase() !== event.key.toUpperCase()) return;
    const target = event.composedPath()[0];
    if (target instanceof Element && (target.closest('input, textarea, select, [role="textbox"]') || target.isContentEditable)) return;
    if (event.key.toUpperCase() === settings.accelerationKey) { event.preventDefault(); toggleAcceleration(); }
  });
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    if (session && !event.composedPath().some(node => node instanceof Element && node.classList.contains('geno-skip-button'))) stopAcceleration();
  });
  document.addEventListener('yt-navigate-finish', () => { if (session) stopAcceleration(); stopAdSkipping(); scheduleRefresh(); });
  document.addEventListener('loadedmetadata', scheduleRefresh, true);
  document.addEventListener('fullscreenchange', scheduleRefresh);
  window.addEventListener('pagehide', () => { pageActive = false; configureMonitoring(); });
  window.addEventListener('pageshow', () => { pageActive = true; configureMonitoring(); });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'GENO_PREPARE_DEBUGGER_SKIP' && sender.id === chrome.runtime.id) {
      sendResponse({ ready: supported() && [...adSkippers.values()].some(skipper => skipper.prepareSkip(message.token)) });
    } else if (message?.type === 'TOGGLE_ACCELERATION') {
      toggleAcceleration();
      sendResponse(getAccelerationState());
    } else if (message?.type === 'REQUEST_STATE') {
      sendResponse({ ...getAccelerationState(), ...(!supported() ? { reason: 'このサイトはまだ登録されてないぞ！設定で追加してくれ！' } : {}) });
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.debuggerSkip || changes.showSkipEffect)) {
      settings = settingsApi.fromStorage({ ...settings,
        ...(changes.debuggerSkip ? { debuggerSkip: changes.debuggerSkip.newValue } : {}),
        ...(changes.showSkipEffect ? { showSkipEffect: changes.showSkipEffect.newValue } : {}) });
      configureMonitoring();
      return;
    }
    if (area !== 'sync' || (!changes.accelerationKey && !changes.videoUrls)) return;
    settings = settingsApi.fromStorage({ ...settings,
      ...(changes.accelerationKey ? { accelerationKey: changes.accelerationKey.newValue } : {}),
      ...(changes.videoUrls ? { videoUrls: changes.videoUrls.newValue } : {}) });
    configureMonitoring();
  });
  chrome.storage.sync.get(['accelerationKey', 'videoUrls'], result => {
    settings = settingsApi.fromStorage(result);
    chrome.storage.local.get(['debuggerSkip', 'showSkipEffect'], local => {
      const localSettings = settingsApi.fromStorage(local);
      settings.debuggerSkip = localSettings.debuggerSkip;
      settings.showSkipEffect = localSettings.showSkipEffect;
      ready = true;
      configureMonitoring();
    });
  });
})();
