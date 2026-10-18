(() => {
  'use strict';
  const mounted = new WeakMap();

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

  function mount({ root, video, onToggle }) {
    const controls = controlsFor(root);
    const anchor = controls ? null : dockAnchor(video, root);
    const previous = mounted.get(video);
    if (previous?.button.isConnected && (controls ? previous.button.parentElement === controls : previous.dock?.previousElementSibling === anchor)) return previous;
    previous?.destroy();

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `geno-skip-button${controls ? ' ytp-button' : ''}`;
    const face = document.createElement('span');
    face.className = 'geno-skip-face';
    face.setAttribute('aria-hidden', 'true');
    face.style.backgroundImage = `url("${chrome.runtime.getURL('assets/geno-faces.png')}")`;
    const badge = document.createElement('span');
    badge.className = 'geno-skip-badge';
    badge.textContent = '16×';
    badge.setAttribute('aria-hidden', 'true');
    button.append(face, badge);
    button.addEventListener('click', event => { event.stopPropagation(); onToggle(); });
    // A player's mouse-down handler must not treat our control as a video click.
    button.addEventListener('pointerdown', event => event.stopPropagation());

    let dock = null;
    if (controls) {
      controls.insertBefore(button, controls.querySelector(':scope > .ytp-settings-button'));
    } else {
      dock = document.createElement('div');
      dock.className = 'geno-skip-dock';
      dock.append(button);
      anchor.after(dock);
    }
    const handle = {
      button, dock,
      setActive(active) {
        const value = String(active);
        if (button.getAttribute('aria-pressed') === value) return;
        button.setAttribute('aria-pressed', value);
        const label = active ? 'じーのスキップ：加速を解除' : 'じーのスキップ：3秒間16倍速';
        button.setAttribute('aria-label', label);
        button.title = label;
      },
      destroy() {
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
