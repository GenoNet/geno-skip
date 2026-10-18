(() => {
  'use strict';
  const selector = '.ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-v2';
  const retryDelay = 500;
  const maxAttempts = 3;

  function available(button) {
    if (typeof button.click !== 'function' || button.matches(':disabled') ||
        button.closest('[aria-disabled="true"], [hidden], [inert], [aria-hidden="true"]')) return false;
    if (button.checkVisibility && !button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
  }

  function watch(root, { onBeforeSkip, getVideo, onBeforeAccelerate, onStateChange } = {}) {
    let clicked = new WeakMap();
    let frame = null, timer = null, destroyed = false;
    let acceleration = null, cancelled = false, rejected = new WeakSet();
    function stopAcceleration() {
      if (!acceleration) return;
      const saved = acceleration;
      acceleration = null;
      try { saved.video.playbackRate = saved.rate; } catch { /* A detached player may reject restoration. */ }
      onStateChange?.();
    }
    function accelerate() {
      const video = getVideo?.();
      if (acceleration?.video !== video) stopAcceleration();
      if (cancelled || !video?.isConnected || rejected.has(video)) return;
      if (acceleration && video.playbackRate === 16) return;
      if (!acceleration) {
        onBeforeAccelerate?.(video);
        acceleration = { video, rate: video.playbackRate, attempts: 0 };
      }
      if (acceleration.attempts >= maxAttempts) { rejected.add(video); stopAcceleration(); return; }
      acceleration.attempts++;
      try {
        video.playbackRate = 16;
        if (video.playbackRate !== 16) throw new Error('Rate rejected');
        onStateChange?.();
      } catch {
        rejected.add(video);
        stopAcceleration();
      }
    }
    function resetAd() {
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
      if (destroyed || !root.isConnected) { cancelCheck(); stopAcceleration(); return; }
      if (Array.isArray(records)) {
        // Class transitions can be batched, with the root already back in its ad state.
        if (records.some(record => record.target === root && record.attributeName === 'class' &&
            !(record.oldValue || '').split(/\s+/).some(name => name === 'ad-showing' || name === 'ad-interrupting'))) resetAd();
        forgetRemoved(records);
      }
      if (!root.matches('.ad-showing, .ad-interrupting')) { resetAd(); cancelCheck(); return; }
      // CSS visibility and late event handlers do not always produce DOM mutations.
      scheduleCheck();
      accelerate();
      for (const control of root.querySelectorAll(selector)) {
        const button = control.matches('button, [role="button"]') ? control : control.querySelector('button, [role="button"]') || control;
        if (button.closest('.html5-video-player') !== root) continue;
        if (!available(button)) { clicked.delete(button); continue; }
        const previous = clicked.get(button), now = performance.now();
        if (previous && (previous.attempts >= maxAttempts || now - previous.time < retryDelay)) continue;
        clicked.set(button, { attempts: (previous?.attempts || 0) + 1, time: now });
        // Use the site's exposed skip control; never enable a countdown or seek past an ad.
        stopAcceleration();
        onBeforeSkip?.();
        button.click();
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
      if (acceleration?.video === event.target) acceleration.attempts = 0;
      check();
    }
    const mediaEvents = ['loadstart', 'loadedmetadata'];
    mediaEvents.forEach(type => root.addEventListener(type, onMediaLoad, true));
    return { check,
      isAccelerating(video) { return !!acceleration && (!video || acceleration.video === video); },
      cancelAcceleration() { cancelled = true; stopAcceleration(); },
      destroy() {
        destroyed = true;
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
