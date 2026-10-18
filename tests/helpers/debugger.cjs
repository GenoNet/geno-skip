const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { root } = require('./browser.cjs');

// Chrome's extension API is unavailable under the cloud browser's managed policy.
// Adapt only its transport; Runtime/Input commands go to a real Chromium CDP session.
async function connectWorker(t, page, { attachError, beforeAttach, beforeLocalRead, beforeCommand, afterCommand } = {}) {
  let listener, session;
  const detached = [], events = [], storageListeners = [], calls = [], assetLoads = [];
  const api = { runtime: { id: 'geno-test', getURL: file => `chrome-extension://geno-test/${file}`, onMessage: { addListener: fn => { listener = fn; } } } };
  function run(callback, task) {
    Promise.resolve().then(task).then(result => callback?.(result), error => {
      api.runtime.lastError = { message: error.message };
      callback?.();
      delete api.runtime.lastError;
    });
  }
  api.storage = {
    sync: { get: (keys, cb) => run(cb, () => page.evaluate(() => window.testStorage)) },
    local: {
      get: (keys, cb) => run(cb, async () => {
        const value = await page.evaluate(() => window.testLocalStorage);
        await beforeLocalRead?.();
        return value;
      }),
      set: (values, cb) => run(cb, async () => {
        const changes = await page.evaluate(values => {
          const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: window.testLocalStorage[key], newValue }]));
          window.updateLocalSettings(values);
          return changes;
        }, values);
        storageListeners.forEach(fn => fn(changes, 'local'));
      })
    },
    onChanged: { addListener: fn => storageListeners.push(fn) }
  };
  api.debugger = {
    attach: (target, version, cb) => run(cb, async () => {
      calls.push({ method: 'attach', target, version });
      if (attachError) throw new Error(attachError);
      session = await page.context().newCDPSession(page);
      for (const method of ['Page.frameNavigated', 'Page.frameStartedNavigating', 'Page.navigatedWithinDocument', 'Page.frameDetached']) {
        session.on(method, params => events.forEach(fn => fn({ tabId: target.tabId }, method, params)));
      }
      await beforeAttach?.();
    }),
    sendCommand: (target, method, params, cb) => run(cb, async () => {
      calls.push({ method, params });
      await beforeCommand?.(method, params);
      if (!session) throw new Error('Debugger detached');
      const result = await session.send(method, params);
      await afterCommand?.(method, params);
      return result;
    }),
    detach: (target, cb) => run(cb, async () => {
      calls.push({ method: 'detach', target });
      await session?.detach();
      session = null;
    }),
    onDetach: { addListener: fn => detached.push(fn) },
    onEvent: { addListener: fn => events.push(fn) }
  };
  api.tabs = {
    sendMessage: (tabId, message, options, cb) => run(cb, () => page.evaluate(message => {
      let response;
      window.testMessageListeners.forEach(fn => fn(message, { id: 'geno-test' }, value => { response = value; }));
      return response;
    }, message))
  };
  const context = vm.createContext({ URL, console, setTimeout, clearTimeout, chrome: api, btoa,
    fetch: async url => {
      assert.equal(url, 'chrome-extension://geno-test/assets/geno-faces.png');
      assetLoads.push(url);
      return new Response(fs.readFileSync(path.join(root, 'assets/geno-faces.png')), { headers: { 'Content-Type': 'image/png' } });
    }
  });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context));
  const worker = path.join(root, 'background.js');
  if (fs.existsSync(worker)) vm.runInContext(fs.readFileSync(worker, 'utf8'), context);
  const sender = () => ({ id: 'geno-test', frameId: 0, documentId: 'test-document', url: page.url(), tab: { id: 7 } });
  const request = (message, source = sender()) => new Promise(resolve => {
    assert.equal(typeof listener, 'function', 'background registers its skip message handler');
    const keepAlive = listener(message, source, resolve);
    if (keepAlive !== true) resolve(undefined);
  });
  await page.exposeFunction('genoWorkerMessage', message => request(message));
  await page.evaluate(() => {
    chrome.runtime.id = 'geno-test';
    const sendMessage = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (message, cb) => {
      if (!['GENO_DEBUGGER_SKIP', 'GENO_FACE_SOURCE'].includes(message.type)) return sendMessage(message, cb);
      window.testMessages.push(message);
      return window.genoWorkerMessage(message).then(response => cb?.(response));
    };
  });
  t.after(async () => { await session?.detach().catch(() => {}); });
  async function disconnect(reason = 'canceled_by_user') {
    await session?.detach();
    session = null;
    detached.forEach(fn => fn({ tabId: 7 }, reason));
  }
  return { calls, request, api, disconnect, assetLoads };
}

module.exports = { connectWorker };
