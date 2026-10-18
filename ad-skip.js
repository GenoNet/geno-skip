(() => {
  'use strict';
  const selector = '.ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-v2';
  const retryDelay = 500;
  const slowRetryDelay = 2000;
  const fastAttempts = 3;
  const maxRateAttempts = 3;

  function available(button, hitTest = false) {
    if (typeof button.click !== 'function' || button.matches(':disabled') ||
        button.closest('[aria-disabled="true"], [hidden], [inert]')) return false;
    if (button.checkVisibility && !button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    return !hitTest || (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && button.contains(document.elementFromPoint(x, y)));
  }

  function watch(root, { onBeforeSkip, getVideo, onBeforeAccelerate, onStateChange, useDebugger, requestSkip, onSkipError } = {}) {
    let clicked = new WeakMap();
    let frame = null, timer = null, destroyed = false;
    let acceleration = null, cancelled = false, rejected = new WeakSet();
    let pending = null;
    let debuggerMode = useDebugger?.() === true;
    function cancelPending() {
      if (!pending) return;
      clearTimeout(pending.timer);
      if (pending.button.getAttribute('data-geno-debugger-skip') === pending.token) pending.button.removeAttribute('data-geno-debugger-skip');
      pending = null;
    }
    function requestDebugSkip(button) {
      const request = { button, token: crypto.randomUUID(), prepared: false };
      pending = request;
      button.setAttribute('data-geno-debugger-skip', request.token);
      function finish(response) {
        if (pending !== request) return;
        cancelPending();
        if (response?.reason) onSkipError?.(response.reason);
        check();
      }
      request.timer = setTimeout(() => finish({ reason: 'SKIPの応答がないぞ！いったん設定でOFFにしてくれ！' }), 3000);
      Promise.resolve().then(() => requestSkip(request.token)).then(finish, () => finish({ reason: 'SKIPのデバッグ入力に失敗！拡張とタブを再読み込みしてくれ！' }));
    }
    function stopAcceleration() {
      if (!acceleration) return;
      const saved = acceleration;
      acceleration = null;
      saved.video.removeEventListener('volumechange', onVolumeChange);
      for (const [property, value] of [['playbackRate', saved.rate], ['muted', saved.muted]]) {
        try { saved.video[property] = value; } catch { /* Keep restoring the other property if one fails. */ }
      }
      onStateChange?.();
    }
    function muteAcceleration() {
      if (!acceleration || acceleration.video.muted) return;
      if (acceleration.muteAttempts >= 3) throw new Error('Mute repeatedly reset');
      acceleration.muteAttempts++;
      acceleration.video.muted = true;
      if (!acceleration.video.muted) throw new Error('Mute rejected');
    }
    function onVolumeChange() {
      try { muteAcceleration(); } catch {
        rejected.add(acceleration.video);
        stopAcceleration();
        onSkipError?.('プレーヤーにミュートを戻された！加速をやめるぞ！');
      }
    }
    function prepareMediaForSkip() {
      onBeforeSkip?.();
      if (!acceleration) return;
      // Restore speed before the site switches videos, but keep the ad silent until it ends.
      try {
        const previousRate = acceleration.video.playbackRate;
        acceleration.video.playbackRate = acceleration.rate;
        if (previousRate === 16 && acceleration.rate !== 16 && acceleration.video.playbackRate === acceleration.rate) acceleration.resumeRate = true;
      } catch { /* Audio ownership still needs to be retained. */ }
      onVolumeChange();
    }
    function accelerate() {
      const video = getVideo?.();
      if (acceleration?.video !== video) stopAcceleration();
      if (cancelled || !video?.isConnected || rejected.has(video)) return;
      if (acceleration && video.playbackRate === 16 && video.muted) return;
      if (!acceleration) {
        onBeforeAccelerate?.(video);
        acceleration = { video, rate: video.playbackRate, muted: video.muted, attempts: 0, muteAttempts: 0 };
        video.addEventListener('volumechange', onVolumeChange);
      }
      try {
        if (video.playbackRate !== 16) {
          if (!acceleration.resumeRate) {
            if (acceleration.attempts >= maxRateAttempts) throw new Error('Rate repeatedly reset');
            acceleration.attempts++;
          }
          acceleration.resumeRate = false;
          video.playbackRate = 16;
          if (video.playbackRate !== 16) throw new Error('Rate rejected');
        }
        muteAcceleration();
        onStateChange?.();
      } catch {
        rejected.add(video);
        stopAcceleration();
      }
    }
    function resetAd() {
      cancelPending();
      clicked = new WeakMap();
      cancelled = false;
      rejected = new WeakSet();
      stopAcceleration();
    }
    function cancelCheck() { clearTimeout(timer); timer = null; }
    function scheduleCheck() {
      if (timer === null) timer = setTimeout(() => { timer = null; check(); }, retryDelay);
    }
    function forgetRemoved(records) {
      for (const record of records) for (const node of record.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const controls = [node, ...node.querySelectorAll(`${selector}, button, [role="button"]`)];
        for (const button of controls) if (!root.contains(button)) clicked.delete(button);
      }
    }
    function check(records = []) {
      if (destroyed || !root.isConnected) { cancelPending(); cancelCheck(); stopAcceleration(); return; }
      if (Array.isArray(records)) {
        // Class transitions can be batched, with the root already back in its ad state.
        if (records.some(record => record.target === root && record.attributeName === 'class' &&
            !(record.oldValue || '').split(/\s+/).some(name => name === 'ad-showing' || name === 'ad-interrupting'))) resetAd();
        forgetRemoved(records);
      }
      if (!root.matches('.ad-showing, .ad-interrupting')) { resetAd(); cancelCheck(); return; }
      // CSS visibility and late event handlers do not always produce DOM mutations.
      scheduleCheck();
      const debug = useDebugger?.() === true;
      if (debug !== debuggerMode) { cancelPending(); clicked = new WeakMap(); debuggerMode = debug; }
      if (pending?.prepared && acceleration && acceleration.video !== getVideo?.()) cancelPending();
      if (!pending?.prepared) accelerate();
      if (pending) return;
      for (const control of root.querySelectorAll(selector)) {
        const button = control.matches('button, [role="button"]') ? control : control.querySelector('button, [role="button"]') || control;
        if (button.closest('.html5-video-player') !== root) continue;
        if (!available(button, debug)) { if (!debug) clicked.delete(button); continue; }
        const previous = clicked.get(button), now = performance.now();
        const delay = debug || previous?.attempts >= fastAttempts ? slowRetryDelay : retryDelay;
        if (previous && now - previous.time < delay) continue;
        if (debug && previous?.attempts >= 2) {
          if (!previous.warned) { previous.warned = true; onSkipError?.('SKIPを2回押したが広告が残ってる！この広告は手で押してくれ！'); }
          continue;
        }
        clicked.set(button, { attempts: (previous?.attempts || 0) + 1, time: now });
        if (debug) { requestDebugSkip(button); break; }
        // Use the site's exposed skip control; never enable a countdown or seek past an ad.
        prepareMediaForSkip();
        button.click();
        if (root.matches('.ad-showing, .ad-interrupting')) accelerate();
        else stopAcceleration();
        const ownChanges = observer.takeRecords();
        forgetRemoved(ownChanges);
        // A click can rebuild the player's classes. Do not treat those changes as a new ad.
        if (ownChanges.length && frame === null) frame = requestAnimationFrame(() => { frame = null; check(); });
        break;
      }
    }
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeOldValue: true,
      attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-disabled', 'aria-hidden', 'inert'] });
    const displayEvents = ['transitionend', 'animationend'];
    displayEvents.forEach(type => root.addEventListener(type, check, true));
    function onMediaLoad(event) {
      if (!event.target.matches?.('video') || event.target.closest('.html5-video-player') !== root) return;
      rejected.delete(event.target);
      if (acceleration?.video === event.target) { acceleration.attempts = 0; acceleration.muteAttempts = 0; }
      check();
    }
    const mediaEvents = ['loadstart', 'loadedmetadata'];
    mediaEvents.forEach(type => root.addEventListener(type, onMediaLoad, true));
    return { check,
      prepareSkip(token) {
        if (!pending || pending.token !== token || !useDebugger?.() || destroyed || !root.isConnected ||
            !root.matches('.ad-showing, .ad-interrupting') || pending.button.closest('.html5-video-player') !== root || !available(pending.button)) return false;
        pending.prepared = true;
        prepareMediaForSkip();
        return true;
      },
      isAccelerating(video) { return !!acceleration && (!video || acceleration.video === video); },
      cancelAcceleration() { cancelled = true; stopAcceleration(); },
      destroy() {
        destroyed = true;
        cancelPending();
        cancelCheck();
        stopAcceleration();
        observer.disconnect();
        displayEvents.forEach(type => root.removeEventListener(type, check, true));
        mediaEvents.forEach(type => root.removeEventListener(type, onMediaLoad, true));
        if (frame !== null) cancelAnimationFrame(frame);
      }
    };
  }

  globalThis.GenoAdSkip = Object.freeze({ watch });
})();
