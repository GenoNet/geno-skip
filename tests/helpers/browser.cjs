const { chromium } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');

async function openPage(t, { html = '<video style="width:640px;height:360px"></video>', hostname = 'www.youtube.com', storage = {} } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route(`https://${hostname}/**`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>${html}</body></html>` }));
  await page.goto(`https://${hostname}/watch`);
  await page.evaluate(storage => {
    window.testMessages = [];
    window.testStorage = storage;
    window.testStorageListeners = [];
    window.testMessageListeners = [];
    window.chrome = {
      runtime: {
        getURL: file => `https://assets.test/${file}`,
        sendMessage: (message, callback) => { window.testMessages.push(message); callback?.(); },
        onMessage: { addListener: callback => window.testMessageListeners.push(callback) }
      },
      storage: {
        sync: { get: (keys, cb) => cb(window.testStorage), set: (values, cb) => { Object.assign(window.testStorage, values); cb?.(); } },
        onChanged: { addListener: cb => window.testStorageListeners.push(cb) }
      }
    };
    window.requestState = () => new Promise(resolve => window.testMessageListeners.at(-1)({ type: 'REQUEST_STATE' }, {}, resolve));
    window.toggleMessage = () => new Promise(resolve => window.testMessageListeners.at(-1)({ type: 'TOGGLE_ACCELERATION' }, {}, resolve));
    window.updateSettings = values => {
      const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value, oldValue: window.testStorage[key] }]));
      Object.assign(window.testStorage, values);
      window.testStorageListeners.forEach(fn => fn(changes, 'sync'));
    };
  }, storage);
  return page;
}

async function loadContent(page) {
  for (const file of ['settings.js', 'player-button.js', 'content.js']) {
    if (fs.existsSync(path.join(root, file))) await page.addScriptTag({ path: path.join(root, file) });
  }
  if (fs.existsSync(path.join(root, 'player-button.css'))) await page.addStyleTag({ path: path.join(root, 'player-button.css') });
}
async function state(page) { return page.evaluate(() => window.requestState()); }
async function videoState(page, selector = 'video') {
  return page.locator(selector).evaluate(v => ({ rate: v.playbackRate, volume: v.volume, muted: v.muted }));
}
module.exports = { openPage, loadContent, state, videoState, root };
