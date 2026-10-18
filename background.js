importScripts('settings.js');

(() => {
  'use strict';
  const jobs = new Map();
  let settingsGeneration = 0;
  let faceSource = null;
  const settingsApi = globalThis.GenoSkipSettings;
  const connectionError = 'SKIPのデバッグ接続に失敗！DevToolsを閉じて、設定でもう一度ONにしてくれ！';

  function call(object, method, ...args) {
    return new Promise((resolve, reject) => {
      object[method](...args, result => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result);
      });
    });
  }

  function loadFaceSource() {
    if (!faceSource) faceSource = Promise.resolve()
      // Read the packaged asset in the extension origin, never in the site's frame.
      .then(() => fetch(chrome.runtime.getURL('assets/geno-faces.png')))
      .then(response => {
        if (!response.ok) throw new Error('Face image could not be loaded');
        return response.arrayBuffer();
      })
      .then(buffer => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return `data:image/png;base64,${btoa(binary)}`;
      })
      .catch(error => { faceSource = null; throw error; });
    return faceSource;
  }

  function validFaceSender(sender) {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) return false;
    try { return ['http:', 'https:'].includes(new URL(sender.url).protocol); } catch { return false; }
  }

  // Serialized into the target page. All inputs are data; no page-supplied code is run.
  function locateSkip(token, expectedURL) {
    if (location.href !== expectedURL) return null;
    const selector = '.ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-v2';
    const button = [...document.querySelectorAll('[data-geno-debugger-skip]')].find(item => item.getAttribute('data-geno-debugger-skip') === token);
    if (!button?.matches('button, [role="button"]') || !button.closest(selector)) return null;
    const root = button.closest('.html5-video-player');
    if (!root?.matches('.ad-showing, .ad-interrupting') || button.closest(selector).closest('.html5-video-player') !== root ||
        button.matches(':disabled') || button.closest('[hidden], [inert], [aria-disabled="true"]')) return null;
    if (button.checkVisibility && !button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
    const style = getComputedStyle(button), rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    if (rect.width <= 0 || rect.height <= 0 || style.visibility !== 'visible' || style.pointerEvents === 'none' ||
        x < 0 || y < 0 || x >= innerWidth || y >= innerHeight || !button.contains(document.elementFromPoint(x, y))) return null;
    return { x, y };
  }

  function validSender(sender) {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.documentId || !Number.isInteger(sender.tab?.id)) return false;
    try {
      const url = new URL(sender.url);
      return url.protocol === 'https:' && settingsApi.matches(url.hostname, ['youtube.com', 'youtube-nocookie.com']);
    } catch { return false; }
  }

  async function detach(job) {
    if (!job.attached) return;
    job.detaching = true;
    job.attached = false;
    await call(chrome.debugger, 'detach', job.target).catch(() => {});
  }

  async function skip(sender, token) {
    if (!validSender(sender) || typeof token !== 'string' || !/^[\w-]{1,80}$/.test(token)) return { sent: false };
    const generation = settingsGeneration;
    const [local, sync] = await Promise.all([
      call(chrome.storage.local, 'get', ['debuggerSkip']),
      call(chrome.storage.sync, 'get', ['videoUrls'])
    ]);
    if (generation !== settingsGeneration || !settingsApi.fromStorage(local).debuggerSkip || !settingsApi.matches(new URL(sender.url).hostname, settingsApi.fromStorage(sync).videoUrls) || jobs.has(sender.tab.id)) return { sent: false };

    const job = { target: { tabId: sender.tab.id }, attached: false, cancelled: false, pressed: false };
    jobs.set(sender.tab.id, job);
    const aborted = new Promise((resolve, reject) => {
      job.abort = (reason, silent = false) => {
        job.cancelled = true;
        job.silent = silent;
        reject(new Error(reason));
      };
    });
    const deadline = setTimeout(() => job.abort('SKIPの入力が間に合わなかった！設定でもう一度ONにしてくれ！'), 2500);
    function active() { if (job.cancelled) throw new Error('Cancelled'); }
    async function command(method, params) {
      active();
      const result = await call(chrome.debugger, 'sendCommand', job.target, method, params);
      active();
      return result;
    }
    async function target() {
      const result = await command('Runtime.evaluate', {
        expression: `(${locateSkip.toString()})(${JSON.stringify(token)}, ${JSON.stringify(sender.url)})`,
        returnByValue: true,
        timeout: 500
      });
      if (result.exceptionDetails) throw new Error('Cannot inspect skip control');
      return result.result?.value;
    }
    async function run() {
      job.attaching = true;
      await call(chrome.debugger, 'attach', job.target, '1.3').then(async () => {
        job.attaching = false;
        job.attached = true;
        // An attach callback may arrive after the deadline or a settings change.
        if (job.cancelled) {
          await detach(job);
          if (jobs.get(sender.tab.id) === job) jobs.delete(sender.tab.id);
        }
      }, error => {
        job.attaching = false;
        if (job.cancelled && jobs.get(sender.tab.id) === job) jobs.delete(sender.tab.id);
        throw error;
      });
      active();
      await command('Page.enable', {});
      const tree = await command('Page.getFrameTree', {});
      job.frameId = tree.frameTree.frame.id;
      let point = await target();
      if (!point) return { sent: false };
      const prepared = await call(chrome.tabs, 'sendMessage', sender.tab.id, { type: 'GENO_PREPARE_DEBUGGER_SKIP', token }, { documentId: sender.documentId, frameId: 0 });
      active();
      if (!prepared?.ready) return { sent: false };
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none', buttons: 0 });
      // Hover, scrolling or player controls may move the target during attachment.
      point = await target();
      if (!point) return { sent: false };
      job.pressed = true;
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
      job.pressed = false;
      return { sent: true };
    }
    try {
      return await Promise.race([run(), aborted]);
    } catch (error) {
      if (job.silent) return { sent: false };
      const reason = job.cancelled ? error.message : connectionError;
      await call(chrome.storage.local, 'set', { debuggerSkip: false, debuggerSkipError: reason }).catch(() => {});
      return { sent: false, reason };
    } finally {
      clearTimeout(deadline);
      job.cancelled = true;
      if (job.pressed && job.attached) {
        // Release outside the viewport when interrupted, without clicking another control.
        await call(chrome.debugger, 'sendCommand', job.target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: -1, y: -1, button: 'left', buttons: 0 }).catch(() => {});
      }
      await detach(job);
      if (!job.attaching && jobs.get(sender.tab.id) === job) jobs.delete(sender.tab.id);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'GENO_FACE_SOURCE') {
      if (!validFaceSender(sender)) { sendResponse({ source: null }); return; }
      loadFaceSource().then(source => sendResponse({ source }), () => sendResponse({ source: null }));
      return true;
    }
    if (message?.type !== 'GENO_DEBUGGER_SKIP') return;
    skip(sender, message.token).then(sendResponse, () => sendResponse({ sent: false, reason: connectionError }));
    return true;
  });
  chrome.debugger.onDetach.addListener((source, reason) => {
    const job = jobs.get(source.tabId);
    if (!job || job.detaching) return;
    job.attached = false;
    job.abort(reason === 'canceled_by_user' ? 'デバッグ入力を中断したぞ！再開するときは設定でもう一度ONにしてくれ！' : connectionError);
  });
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const job = jobs.get(source.tabId);
    if (!job || job.detaching) return;
    const navigation = method === 'Page.frameNavigated' && !params.frame.parentId;
    const sameFrame = params.frameId === job.frameId && ['Page.frameStartedNavigating', 'Page.navigatedWithinDocument', 'Page.frameDetached'].includes(method);
    if (navigation || sameFrame) job.abort('Navigation', true);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'local' && changes.debuggerSkip) || (area === 'sync' && changes.videoUrls)) {
      settingsGeneration++;
      if (area === 'sync' || !settingsApi.fromStorage({ debuggerSkip: changes.debuggerSkip.newValue }).debuggerSkip) {
        for (const job of jobs.values()) job.abort('Cancelled', true);
      }
    }
  });
})();
