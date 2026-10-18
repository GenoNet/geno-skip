(() => {
  'use strict';
  const selector = '.ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-v2';

  function available(button) {
    if (!button.matches('button, [role="button"]') || button.matches(':disabled') ||
        button.closest('[aria-disabled="true"], [hidden], [inert], [aria-hidden="true"]')) return false;
    if (button.checkVisibility && !button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
  }

  function watch(root, { onBeforeSkip } = {}) {
    let clicked = new WeakSet();
    let frame = null;
    function forgetRemoved(records) {
      for (const record of records) for (const node of record.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const controls = [...node.querySelectorAll(selector)];
        if (node.matches(selector)) controls.push(node);
        for (const button of controls) if (!root.contains(button)) clicked.delete(button);
      }
    }
    function check(records = []) {
      if (!root.isConnected) return;
      if (Array.isArray(records)) {
        // Class transitions can be batched, with the root already back in its ad state.
        if (records.some(record => record.target === root && record.attributeName === 'class' &&
            !(record.oldValue || '').split(/\s+/).some(name => name === 'ad-showing' || name === 'ad-interrupting'))) clicked = new WeakSet();
        forgetRemoved(records);
      }
      if (!root.matches('.ad-showing, .ad-interrupting')) { clicked = new WeakSet(); return; }
      for (const button of root.querySelectorAll(selector)) {
        if (button.closest('.html5-video-player') !== root) continue;
        if (!available(button)) { clicked.delete(button); continue; }
        if (clicked.has(button)) continue;
        clicked.add(button);
        // Use the site's exposed skip control; never enable a countdown or seek past an ad.
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
    return { check, destroy() {
      observer.disconnect();
      displayEvents.forEach(type => root.removeEventListener(type, check, true));
      if (frame !== null) cancelAnimationFrame(frame);
    } };
  }

  globalThis.GenoAdSkip = Object.freeze({ watch });
})();
