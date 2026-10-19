const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openPage, loadContent, root } = require('./helpers/browser.cjs');
const { connectWorker } = require('./helpers/debugger.cjs');

test('button and effect load the worker PNG when page resource requests are forbidden', async t => {
  const page = await openPage(t, { html: '<div class="html5-video-player ad-showing"><video style="width:640px;height:360px"></video><div class="ytp-right-controls"></div></div>', local: { debuggerSkip: false, showSkipEffect: true } });
  const { assetLoads } = await connectWorker(t, page);
  await page.evaluate(() => {
    window.pageFetches = 0;
    window.fetch = async () => { window.pageFetches++; throw new Error('Unsafe attempt to load extension URL'); };
  });
  await loadContent(page);
  await page.waitForFunction(() => ['.geno-skip-face', '.geno-skip-effect-face'].every(selector => document.querySelector(selector)?.style.backgroundImage.startsWith('url("data:image/png;base64,')), null, { timeout: 2000 });
  assert.equal(await page.evaluate(() => window.pageFetches), 0);
  assert.equal(assetLoads.length, 1);
  assert.equal(await page.evaluate(() => window.testMessages.filter(message => message.type === 'GENO_FACE_SOURCE').length), 1);
});

test('worker returns only its fixed PNG and shares the load across requests', async t => {
  const page = await openPage(t, { hostname: 'www.nicovideo.jp' });
  const { request, assetLoads, calls } = await connectWorker(t, page);
  const results = await Promise.all([
    request({ type: 'GENO_FACE_SOURCE' }),
    request({ type: 'GENO_FACE_SOURCE', path: '../settings.js' })
  ]);
  for (const result of results) {
    assert.equal(typeof result?.source, 'string');
    assert.ok(result.source.startsWith('data:image/png;base64,'));
    assert.ok(Buffer.from(result.source.split(',')[1], 'base64').equals(fs.readFileSync(path.join(root, 'assets/geno-face.png'))));
  }
  assert.equal(assetLoads.length, 1);
  assert.equal(calls.length, 0);
});

test('face requests reject foreign senders, subframes and non-web documents', async t => {
  const page = await openPage(t);
  const { request, assetLoads, calls } = await connectWorker(t, page);
  const sender = { id: 'geno-test', url: page.url(), frameId: 0, tab: { id: 7 } };
  for (const source of [{ ...sender, id: 'foreign' }, { ...sender, frameId: 1 }, { ...sender, tab: undefined }, { ...sender, url: 'file:///tmp/video.html' }]) {
    assert.equal((await request({ type: 'GENO_FACE_SOURCE' }, source))?.source, null);
  }
  assert.equal(assetLoads.length, 0);
  assert.equal(calls.length, 0);
});
