const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, loadContent, videoState } = require('./helpers/browser.cjs');
const { connectWorker } = require('./helpers/debugger.cjs');
const html = '<div class="html5-video-player"><video style="width:640px;height:360px"></video><div class="ytp-right-controls"></div><button class="ytp-skip-ad-button" id="skip-button:2"><div class="ytp-skip-ad-button__text">スキップ</div><span class="ytp-skip-ad-button__icon">▶</span></button></div>';

async function setup(t, options = {}) {
  const page = await openPage(t, { html, local: { debuggerSkip: true }, ...options });
  await page.evaluate(() => {
    const video = document.querySelector('video');
    video.playbackRate = 1.5;
    window.skipEvents = [];
    document.querySelector('button.ytp-skip-ad-button').addEventListener('click', event => {
      window.skipEvents.push({ trusted: event.isTrusted, rate: video.playbackRate, muted: video.muted });
      if (event.isTrusted && !window.ignoreTrusted) document.querySelector('.html5-video-player').classList.remove('ad-showing');
    });
  });
  const worker = await connectWorker(t, page, options);
  await loadContent(page);
  return { page, ...worker };
}

test('opt-in skip restores speed before trusted input and keeps mute until the ad ends', async t => {
  const { page, calls } = await setup(t);
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForFunction(() => window.skipEvents.some(event => event.trusted), null, { timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => window.skipEvents), [{ trusted: true, rate: 1.5, muted: true }]);
  assert.deepEqual(await videoState(page), { rate: 1.5, volume: 1, muted: false });
  await page.waitForFunction(() => !document.querySelector('[data-geno-debugger-skip]'));
  assert.equal(calls.filter(call => call.method === 'attach').length, 1);
  assert.equal(calls.filter(call => call.method === 'detach').length, 1);
});

test('debugger preparation keeps the ad muted while browser input is pending',async t=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const {page}=await setup(t,{beforeCommand:async(method,params)=>{
    if(method==='Input.dispatchMouseEvent'&&params.type==='mouseMoved'){
      await page.evaluate(()=>window.prepared=true);
      await gate;
    }
  }});
  t.after(()=>release());
  await page.locator('.html5-video-player').evaluate(root=>root.classList.add('ad-showing'));
  await page.waitForFunction(()=>window.prepared);
  assert.deepEqual(await videoState(page),{rate:1.5,volume:1,muted:true});
  await page.locator('video').evaluate(video=>{video.muted=false;video.dispatchEvent(new Event('volumechange'));});
  assert.equal((await videoState(page)).muted,true);
  release();
  await page.waitForFunction(()=>window.skipEvents.some(event=>event.trusted));
  assert.deepEqual(await videoState(page),{rate:1.5,volume:1,muted:false});
});

test('default mode never attaches a debugger when synthetic clicks are ignored', async t => {
  const { page, calls } = await setup(t, { local: {} });
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForTimeout(650);
  assert.equal(calls.length, 0);
  assert.ok((await page.evaluate(() => window.skipEvents)).every(event => !event.trusted));
});

test('enabling browser input during an ad retries after ignored synthetic clicks', async t => {
  const { page } = await setup(t, { local: {} });
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForFunction(() => window.skipEvents.length >= 3);
  await page.evaluate(() => window.updateLocalSettings({ debuggerSkip: true }));
  await page.waitForFunction(() => window.skipEvents.some(event => event.trusted), null, { timeout: 4000 });
});

test('an ignored synthetic click immediately resumes ad acceleration and mute', async t => {
  const { page } = await setup(t, { local: {} });
  await page.locator('.ytp-skip-ad-button').evaluate(button => button.addEventListener('click', () => queueMicrotask(() => {
    const video = document.querySelector('video');
    window.afterIgnoredClick = { rate: video.playbackRate, muted: video.muted };
  })));
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForFunction(() => window.afterIgnoredClick);
  assert.deepEqual(await page.evaluate(() => window.afterIgnoredClick), { rate: 16, muted: true });
});

test('an occupied debugger disables retries and leaves the ad accelerated and muted', async t => {
  const { page, calls } = await setup(t, { attachError: 'Another debugger is already attached to the tab' });
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForFunction(() => window.testLocalStorage.debuggerSkip === false, null, { timeout: 5000 });
  assert.match(await page.evaluate(() => window.testLocalStorage.debuggerSkipError), /DevTools/);
  assert.deepEqual(await videoState(page), { rate: 16, volume: 1, muted: true });
  await page.waitForTimeout(650);
  assert.equal(calls.filter(call => call.method === 'attach').length, 1);
});

test('worker refuses disabled mode, other origins, subframes and foreign extension senders', async t => {
  const page = await openPage(t, { local: { debuggerSkip: true } });
  const { request, calls } = await connectWorker(t, page);
  const valid = { id: 'geno-test', url: page.url(), frameId: 0, documentId: 'test-document', tab: { id: 7 } };
  const message = { type: 'GENO_DEBUGGER_SKIP', token: 'test-request' };
  for (const sender of [{ ...valid, url: 'https://youtube.com.evil.test/' }, { ...valid, frameId: 1 }, { ...valid, id: 'foreign' }, { ...valid, documentId: undefined }]) {
    const result = await request(message, sender);
    assert.equal(result?.sent, false);
  }
  await page.evaluate(() => window.testLocalStorage.debuggerSkip = false);
  assert.equal((await request(message, valid)).sent, false);
  await page.evaluate(() => { window.testLocalStorage.debuggerSkip = true; window.testStorage.videoUrls = []; });
  assert.equal((await request(message, valid)).sent, false);
  assert.equal(calls.length, 0);
});

test('a covered skip control never receives browser input', async t => {
  const { page, calls } = await setup(t);
  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:black;z-index:999999';
    document.body.append(overlay);
    document.querySelector('.html5-video-player').classList.add('ad-showing');
  });
  await page.waitForTimeout(650);
  assert.equal(calls.length, 0);
  assert.deepEqual(await videoState(page), { rate: 16, volume: 1, muted: true });
});

test('temporary hiding cannot bypass the two browser-input attempts for one button', async t => {
  const { page, calls } = await setup(t);
  await page.evaluate(() => {
    window.ignoreTrusted = true;
    const button = document.querySelector('.ytp-skip-ad-button');
    button.addEventListener('click', event => {
      if (!event.isTrusted) return;
      button.hidden = true;
      if (window.skipEvents.filter(event => event.trusted).length < 3) setTimeout(() => { button.hidden = false; }, 20);
    });
    document.querySelector('.html5-video-player').classList.add('ad-showing');
  });
  await page.waitForTimeout(4600);
  assert.equal((await page.evaluate(() => window.skipEvents)).filter(event => event.trusted).length, 2);
  assert.equal(calls.filter(call => call.method === 'attach').length, 2);
});

test('the target is checked again after hover changes its position', async t => {
  let page;
  const worker = await setup(t, { beforeCommand: async (method, params) => {
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved') {
      await page.locator('.ytp-skip-ad-button').evaluate(button => button.style.marginLeft = '100px');
    }
  } });
  page = worker.page;
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForFunction(() => window.skipEvents.some(event => event.trusted));
  const events = worker.calls.filter(call => call.method === 'Input.dispatchMouseEvent');
  assert.equal(events.find(call => call.params.type === 'mousePressed').params.x - events[0].params.x, 100);
});

test('a control hidden after preparation is not pressed and the ad stays muted', async t => {
  let page;
  const worker = await setup(t, { beforeCommand: async (method, params) => {
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved') await page.locator('.ytp-skip-ad-button').evaluate(button => button.hidden = true);
  } });
  page = worker.page;
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForFunction(() => window.testMessages.some(message => message.type === 'GENO_DEBUGGER_SKIP'));
  await page.waitForFunction(() => !document.querySelector('[data-geno-debugger-skip]'));
  assert.equal(worker.calls.some(call => call.params?.type === 'mousePressed'), false);
  assert.equal(worker.calls.filter(call => call.method === 'detach').length, 1);
  assert.deepEqual(await videoState(page), { rate: 16, volume: 1, muted: true });
});

test('switching mode off while attach is pending cleans up a late connection', async t => {
  let release, page;
  const gate = new Promise(resolve => { release = resolve; });
  const worker = await setup(t, { beforeAttach: async () => {
    await page.evaluate(() => window.attachStarted = true);
    await gate;
  } });
  page = worker.page;
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForFunction(() => window.attachStarted);
  await new Promise(resolve => worker.api.storage.local.set({ debuggerSkip: false }, resolve));
  release();
  await page.waitForFunction(() => !document.querySelector('[data-geno-debugger-skip]'));
  await page.waitForTimeout(100);
  assert.equal(worker.calls.some(call => call.method === 'Input.dispatchMouseEvent'), false);
  assert.equal(worker.calls.filter(call => call.method === 'detach').length, 1);
});

test('an OFF change during storage reads cannot create a debugger connection', async t => {
  const page = await openPage(t, { local: { debuggerSkip: true } });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const worker = await connectWorker(t, page, { beforeLocalRead: async () => {
    await page.evaluate(() => window.readStarted = true);
    await gate;
  } });
  const result = worker.request({ type: 'GENO_DEBUGGER_SKIP', token: 'test-request' });
  await page.waitForFunction(() => window.readStarted);
  await new Promise(resolve => worker.api.storage.local.set({ debuggerSkip: false }, resolve));
  release();
  assert.equal((await result).sent, false);
  assert.equal(worker.calls.length, 0);
});

test('a canceled pending attach keeps the tab reserved until its callback settles', async t => {
  let release, page;
  const gate = new Promise(resolve => { release = resolve; });
  const worker = await setup(t, { beforeAttach: async () => {
    await page.evaluate(() => window.attachStarted = true);
    await gate;
  } });
  page = worker.page;
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForFunction(() => window.attachStarted);
  await new Promise(resolve => worker.api.storage.local.set({ debuggerSkip: false }, resolve));
  await new Promise(resolve => worker.api.storage.local.set({ debuggerSkip: true }, resolve));
  await page.waitForTimeout(150);
  assert.equal(worker.calls.filter(call => call.method === 'attach').length, 1);
  release();
  await page.waitForTimeout(150);
  assert.equal(worker.calls.filter(call => call.method === 'detach').length, 1);
});

test('pagehide invalidates an outstanding request before browser input', async t => {
  let release, page;
  const gate = new Promise(resolve => { release = resolve; });
  const worker = await setup(t, { beforeAttach: async () => {
    await page.evaluate(() => window.attachStarted = true);
    await gate;
  } });
  page = worker.page;
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForFunction(() => window.attachStarted);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  release();
  await page.waitForTimeout(100);
  assert.equal(worker.calls.some(call => call.method === 'Input.dispatchMouseEvent'), false);
  assert.equal(worker.calls.filter(call => call.method === 'detach').length, 1);
  assert.deepEqual(await videoState(page), { rate: 1.5, volume: 1, muted: false });
});

test('canceling the debugger turns the feature off instead of reconnecting', async t => {
  let worker;
  worker = await setup(t, { beforeCommand: async (method, params) => {
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved') await worker.disconnect();
  } });
  const { page, calls } = worker;
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForFunction(() => window.testLocalStorage.debuggerSkip === false);
  assert.match(await page.evaluate(() => window.testLocalStorage.debuggerSkipError), /中断/);
  await page.waitForTimeout(700);
  assert.equal(calls.filter(call => call.method === 'attach').length, 1);
  assert.equal(calls.some(call => call.params?.type === 'mousePressed'), false);
});

test('a timed out press is released outside the page and the session is detached', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { page, calls } = await setup(t, { afterCommand: async (method, params) => {
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed') await gate;
  } });
  t.after(() => release());
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForFunction(() => window.testLocalStorage.debuggerSkip === false, null, { timeout: 5000 });
  await page.waitForFunction(() => !document.querySelector('[data-geno-debugger-skip]'));
  assert.ok(calls.some(call => call.params?.type === 'mouseReleased' && call.params.x < 0));
  assert.equal(calls.filter(call => call.method === 'detach').length, 1);
  assert.equal((await page.evaluate(() => window.skipEvents)).some(event => event.trusted), false);
  release();
});

test('navigation after target evaluation cannot click an unrelated page', async t => {
  let page, evaluations = 0;
  const worker = await setup(t, { afterCommand: async method => {
    if (method !== 'Runtime.evaluate' || ++evaluations !== 2) return;
    const rect = await page.locator('.ytp-skip-ad-button').boundingBox();
    await page.route('https://other.test/**', route => route.fulfill({ contentType: 'text/html', body: `<button style="position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px">Unrelated</button><script>window.foreignClicks=0;document.querySelector('button').onclick=e=>{if(e.isTrusted)window.foreignClicks++};</script>` }));
    await page.goto('https://other.test/');
  } });
  page = worker.page;
  await page.locator('.html5-video-player').evaluate(root => root.classList.add('ad-showing'));
  await page.waitForURL('https://other.test/');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.foreignClicks), 0);
  assert.equal(worker.calls.some(call => call.params?.type === 'mousePressed'), false);
  assert.equal(worker.calls.filter(call => call.method === 'detach').length, 1);
});
