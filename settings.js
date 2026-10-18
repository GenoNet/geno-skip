(() => {
  'use strict';
  const defaults = Object.freeze({ accelerationKey: 'S', videoUrls: Object.freeze(['youtube.com', 'nicovideo.jp']) });
  function normalizeKey(value) {
    if (typeof value !== 'string') return null;
    const key = value.trim().toUpperCase();
    return [...key].length === 1 && !/\s/u.test(key) ? key : null;
  }
  function parseSites(input) {
    const lines = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/\r?\n/) : [];
    const sites = new Set();
    const invalidLines = [];
    lines.forEach((line, index) => {
      if (typeof line !== 'string') { invalidLines.push(index + 1); return; }
      const text = line.trim();
      if (!text) return;
      try {
        if (/\s|\*/u.test(text)) throw new Error('invalid host');
        const url = new URL(text.includes('://') ? text : `https://${text}`);
        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host ||
            !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label) && label.length <= 63) || host.length > 253) throw new Error('invalid host');
        sites.add(host);
      } catch { invalidLines.push(index + 1); }
    });
    return { sites: [...sites], invalidLines };
  }
  function fromStorage(value = {}) {
    return {
      accelerationKey: normalizeKey(value.accelerationKey) || defaults.accelerationKey,
      videoUrls: Array.isArray(value.videoUrls) ? parseSites(value.videoUrls).sites : [...defaults.videoUrls]
    };
  }
  function matches(hostname, sites) {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    return sites.some(site => host === site || host.endsWith(`.${site}`));
  }
  globalThis.GenoSkipSettings = Object.freeze({ defaults, normalizeKey, parseSites, fromStorage, matches });
})();
