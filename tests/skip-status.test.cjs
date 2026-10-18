const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, loadContent, state, videoState } = require('./helpers/browser.cjs');
const { connectWorker } = require('./helpers/debugger.cjs');
const html = '<div class="html5-video-player ad-showing"><video style="width:640px;height:360px"></video><div class="ytp-right-controls"></div></div>';

test('skip status distinguishes missing, disabled and covered controls from sent input', async t => {
  const page = await openPage(t, { html, local: { debuggerSkip: true } });
  const { calls } = await connectWorker(t, page);
  await loadContent(page);
  assert.match((await state(page)).skipStatus || '', /ボタン待ち/);
  assert.deepEqual(await videoState(page), { rate: 16, volume: 1, muted: true });
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.className = 'ytp-skip-ad-button'; button.disabled = true; button.textContent = 'SKIP';
    document.querySelector('.html5-video-player').append(button);
  });
  assert.match((await state(page)).skipStatus || '', /まだ押せない/);
  await page.waitForFunction(() => window.testMessages.filter(message => message.type === 'ACCEL_STATE').at(-1)?.skipStatus === 'SKIP：まだ押せない', null, { timeout: 1200 });
  await page.evaluate(() => {
    document.querySelector('.ytp-skip-ad-button').disabled = false;
    const cover = document.createElement('div'); cover.id = 'cover';
    cover.style.cssText = 'position:fixed;inset:0;z-index:99999;background:black';
    document.body.append(cover);
  });
  assert.match((await state(page)).skipStatus || '', /隠れてる/);
  await page.waitForFunction(() => window.testMessages.filter(message => message.type === 'ACCEL_STATE').at(-1)?.skipStatus === 'SKIP：ボタンが隠れてる', null, { timeout: 1200 });
  assert.equal(calls.some(call => call.params?.type === 'mousePressed'), false);
  await page.evaluate(() => document.getElementById('cover').remove());
  await page.waitForFunction(() => window.testMessages.some(message => message.type === 'GENO_DEBUGGER_SKIP'));
  await page.waitForFunction(() => !document.querySelector('[data-geno-debugger-skip]'));
  assert.match((await state(page)).skipStatus || '', /送信済み.*終了待ち/);
  assert.equal(calls.filter(call => call.params?.type === 'mousePressed').length, 1);
  await page.locator('.html5-video-player').evaluate(root => root.classList.remove('ad-showing'));
  assert.equal((await state(page)).skipStatus, undefined);
});

test('worker reports an aborted preparation without claiming input was sent', async t => {
  const page = await openPage(t, { html: html.replace('</div></div>', '</div><button class="ytp-skip-ad-button">SKIP</button></div>'), local: { debuggerSkip: true } });
  const { api, calls } = await connectWorker(t, page);
  api.tabs.sendMessage = (tab, message, options, callback) => callback({ ready: false });
  await loadContent(page);
  await page.waitForFunction(() => window.testMessages.some(message => message.type === 'GENO_DEBUGGER_SKIP'));
  await page.waitForFunction(() => !document.querySelector('[data-geno-debugger-skip]'));
  assert.match((await state(page)).skipStatus || '', /準備をやり直し/);
  assert.equal(calls.some(call => call.params?.type === 'mousePressed'), false);
});

test('worker identifies a changed page while refusing to send input', async t => {
  const page = await openPage(t, { html, local: { debuggerSkip: true } });
  const { request, calls } = await connectWorker(t, page);
  const sender = { id: 'geno-test', url: page.url(), frameId: 0, documentId: 'test-document', tab: { id: 7 } };
  await page.evaluate(() => history.pushState({}, '', '/watch?v=changed'));
  const result = await request({ type: 'GENO_DEBUGGER_SKIP', token: 'test-request' }, sender);
  assert.equal(result.sent, false);
  assert.equal(result.status, 'page-changed');
  assert.equal(calls.some(call => call.method === 'Input.dispatchMouseEvent'), false);
});
