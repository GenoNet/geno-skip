(() => {
  'use strict';
  const mounted = new WeakMap();
  let tooltipId = 0;

  function createTooltip(button, host, native) {
    const tooltip = document.createElement('div');
    tooltip.id = `geno-skip-tooltip-${++tooltipId}`;
    tooltip.className = `geno-skip-tooltip${native ? ' ytp-tooltip ytp-bottom' : ''}`;
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.hidden = true;
    const wrapper = document.createElement('div');
    wrapper.className = 'ytp-tooltip-text-wrapper';
    const text = document.createElement('span');
    text.className = 'geno-skip-tooltip-text ytp-tooltip-bottom-text';
    wrapper.append(text);
    tooltip.append(wrapper);
    host.append(tooltip);
    button.setAttribute('aria-describedby', tooltip.id);
    let hovered = false, focused = false, dismissed = false, timer = null;

    function position() {
      if (tooltip.hidden) return;
      const parent = host.getBoundingClientRect(), control = button.getBoundingClientRect();
      const scaleX = parent.width / host.offsetWidth || 1, scaleY = parent.height / host.offsetHeight || 1;
      tooltip.style.maxWidth = `${Math.max(0, host.clientWidth - 16)}px`;
      const center = (control.left + control.right) / 2;
      const left = (center - parent.left) / scaleX - host.clientLeft - tooltip.offsetWidth / 2;
      tooltip.style.left = `${Math.max(8, Math.min(left, host.clientWidth - tooltip.offsetWidth - 8))}px`;
      const above = (control.top - parent.top) / scaleY - host.clientTop - tooltip.offsetHeight - 12;
      const minimum = native ? 8 : (8 - parent.top) / scaleY - host.clientTop;
      const top = !native && above < minimum ? (control.bottom - parent.top) / scaleY - host.clientTop + 12 : Math.max(minimum, above);
      tooltip.style.top = `${top}px`;
    }
    function hide() {
      clearTimeout(timer); timer = null;
      tooltip.hidden = true;
      tooltip.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onEscape, true);
      window.removeEventListener('resize', position);
    }
    function dismiss() { dismissed = true; hide(); }
    function onEscape(event) { if (event.key === 'Escape') dismiss(); }
    function show() {
      timer = null;
      if (dismissed || (!hovered && !focused) || !button.isConnected ||
          (button.checkVisibility && !button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) { hide(); return; }
      tooltip.hidden = false;
      tooltip.setAttribute('aria-hidden', 'false');
      position();
      window.addEventListener('resize', position);
    }
    function schedule(delay) {
      clearTimeout(timer);
      document.addEventListener('keydown', onEscape, true);
      if (delay) timer = setTimeout(show, delay);
      else show();
    }
    const listeners = {
      pointerenter(event) {
        if (event.pointerType === 'touch') return;
        hovered = true; dismissed = false; schedule(focused ? 0 : 300);
      },
      pointerleave() { hovered = false; if (!focused) hide(); },
      focus() { focused = button.matches(':focus-visible'); if (focused) { dismissed = false; schedule(0); } },
      blur() { focused = false; if (!hovered) hide(); },
      click: dismiss
    };
    for (const [type, listener] of Object.entries(listeners)) button.addEventListener(type, listener);
    return {
      setText(value) {
        if (text.textContent !== value) text.textContent = value;
        if (tooltip.hidden && (hovered || focused) && !dismissed && timer === null) schedule(0);
        else position();
      },
      destroy() {
        hide();
        for (const [type, listener] of Object.entries(listeners)) button.removeEventListener(type, listener);
        button.removeAttribute('aria-describedby');
        tooltip.remove();
      }
    };
  }

  function syncNativeControl(controls, button, face) {
    const candidates = [...controls.querySelectorAll('button.ytp-button:not(.geno-skip-button)')].filter(item =>
      item.offsetWidth && item.offsetHeight && (!item.checkVisibility || item.checkVisibility({ checkVisibilityCSS: true })));
    const reference = candidates.find(item => item.querySelector('svg[viewBox]')) || candidates[0];
    for (const [name, size] of [['width', reference?.offsetWidth], ['height', reference?.offsetHeight]]) {
      const property = `--geno-control-${name}`, value = `${size || 48}px`;
      if (button.style.getPropertyValue(property) !== value) button.style.setProperty(property, value);
    }
    const viewBox = reference?.querySelector('svg[viewBox]')?.getAttribute('viewBox') || '0 0 36 36';
    if (face.getAttribute('viewBox') !== viewBox) face.setAttribute('viewBox', viewBox);
  }

  function controlsFor(root) {
    if (!root.matches('.html5-video-player')) return null;
    const right = root.querySelector('.ytp-right-controls');
    if (right) return right;
    const controls = root.querySelector('.ytp-chrome-controls');
    const last = controls?.lastElementChild;
    return last && !last.matches('button, .geno-skip-dock') ? last : controls;
  }

  function dockAnchor(video, root) {
    let anchor = video;
    if (['absolute', 'fixed'].includes(getComputedStyle(video).position)) {
      let container = video.parentElement;
      while (container && container !== document.body) {
        const style = getComputedStyle(container);
        if (style.position !== 'static' || style.transform !== 'none') break;
        container = container.parentElement;
      }
      if (container && container !== document.body) anchor = container;
      else if (root !== document.body) anchor = root;
    }
    // Put the row outside a player that would clip everything below the video.
    for (let parent = anchor.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(parent).overflowY) &&
          parent.getBoundingClientRect().bottom < video.getBoundingClientRect().bottom + 40) anchor = parent;
      else break;
    }
    return anchor;
  }

  function mount({ root, video, onToggle, accelerationKey = 'S' }) {
    const controls = controlsFor(root);
    const anchor = controls ? null : dockAnchor(video, root);
    const previous = mounted.get(video);
    if (previous?.button.isConnected && (controls ? previous.button.parentElement === controls : previous.dock?.previousElementSibling === anchor)) {
      if (controls) syncNativeControl(controls, previous.button, previous.button.querySelector('.geno-skip-native-marker'));
      previous.setShortcut(accelerationKey);
      return previous;
    }
    previous?.destroy();

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `geno-skip-button${controls ? ' ytp-button' : ''}`;
    const face = document.createElement('span');
    face.className = 'geno-skip-face';
    face.setAttribute('aria-hidden', 'true');
    // Paint on HTML: SVG applies same-origin restrictions to extension image URLs.
    face.style.backgroundImage = `url("${chrome.runtime.getURL('assets/geno-faces.png')}")`;
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    marker.setAttribute('class', 'geno-skip-native-marker');
    marker.setAttribute('viewBox', '0 0 36 36');
    marker.setAttribute('focusable', 'false');
    marker.setAttribute('aria-hidden', 'true');
    const icon = document.createElement('span');
    icon.className = 'geno-skip-icon';
    icon.setAttribute('aria-hidden', 'true');
    // Keep YouTube's viewBox-based hover rules without loading an image in SVG.
    icon.append(marker, face);
    const badge = document.createElement('span');
    badge.className = 'geno-skip-badge';
    badge.textContent = '16×';
    badge.setAttribute('aria-hidden', 'true');
    button.append(icon, badge);
    button.addEventListener('click', event => { event.stopPropagation(); onToggle(); });
    // A player's mouse-down handler must not treat our control as a video click.
    button.addEventListener('pointerdown', event => event.stopPropagation());

    let dock = null;
    if (controls) {
      controls.prepend(button);
      syncNativeControl(controls, button, marker);
    } else {
      dock = document.createElement('div');
      dock.className = 'geno-skip-dock';
      dock.append(button);
      anchor.after(dock);
    }
    const tooltip = createTooltip(button, controls ? root : dock, !!controls);
    let shortcut = accelerationKey, isActive = false;
    function updateLabel() {
      button.setAttribute('aria-label', isActive ? 'じーのスキップ：加速を解除' : 'じーのスキップ：3秒間16倍速');
      button.setAttribute('aria-keyshortcuts', shortcut);
      tooltip.setText(`${isActive ? '加速を解除' : 'じーのスキップ'} (${shortcut})`);
    }
    const handle = {
      button, dock,
      setActive(active) {
        const value = String(active);
        if (button.getAttribute('aria-pressed') === value) return;
        isActive = active;
        button.setAttribute('aria-pressed', value);
        updateLabel();
      },
      setShortcut(value) { shortcut = value; updateLabel(); },
      destroy() {
        tooltip.destroy();
        button.remove();
        dock?.remove();
        if (mounted.get(video) === handle) mounted.delete(video);
      }
    };
    mounted.set(video, handle);
    handle.setActive(false);
    return handle;
  }
  globalThis.GenoPlayerButtons = Object.freeze({ mount });
})();
