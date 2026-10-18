const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, loadContent, state, videoState } = require('./helpers/browser.cjs');

test('restores exact rate, zero volume and existing mute', async t => {
  const page = await openPage(t);
  await page.locator('video').evaluate(v => { v.playbackRate = 1.5; v.volume = 0; v.muted = true; });
  await loadContent(page);
  await page.keyboard.press('s');
  assert.equal((await videoState(page)).rate, 16);
  await page.keyboard.press('s');
  assert.deepEqual(await videoState(page), { rate: 1.5, volume: 0, muted: true });
});

test('manual acceleration remutes after a player volume change and restores audio on stop',async t=>{
  const page=await openPage(t);
  await loadContent(page);
  await page.keyboard.press('s');
  const muted=await page.locator('video').evaluate(video=>{
    video.muted=false;video.dispatchEvent(new Event('volumechange'));return video.muted;
  });
  assert.equal(muted,true);
  await page.keyboard.press('s');
  assert.deepEqual(await videoState(page),{rate:1,volume:1,muted:false});
});

test('click cancellation broadcasts state and cancels its old timer', async t => {
  const page = await openPage(t);
  await page.clock.install();
  await loadContent(page);
  await page.keyboard.press('s');
  await page.clock.fastForward(2000);
  await page.mouse.click(1, 1);
  assert.equal(await page.evaluate(() => window.testMessages.at(-1).isActive), false);
  await page.keyboard.press('s');
  await page.clock.fastForward(1100);
  assert.equal((await state(page)).isActive, true);
  await page.clock.fastForward(1900);
  assert.equal((await state(page)).isActive, false);
});

test('ignores key repeat, modifiers, composing and nested editable content', async t => {
  const page = await openPage(t, { html: '<video></video><div contenteditable><span id="edit">text</span></div>' });
  await loadContent(page);
  for (const values of [{repeat:true}, {ctrlKey:true}, {altKey:true}, {metaKey:true}, {shiftKey:true}, {isComposing:true}]) {
    await page.evaluate(values => document.dispatchEvent(new KeyboardEvent('keydown', { key:'s', bubbles:true, ...values })), values);
    assert.equal((await state(page)).isActive, false);
  }
  await page.locator('#edit').click();
  await page.keyboard.press('s');
  assert.equal((await state(page)).isActive, false);
});

test('no video or rejected playback rate does not activate', async t => {
  const page = await openPage(t, { html: '<div>no video</div>' });
  await loadContent(page);
  assert.equal((await page.evaluate(() => window.toggleMessage())).isActive, false);
  await page.evaluate(() => { const v=document.createElement('video'); v.style.cssText='width:200px;height:100px'; document.body.append(v); Object.defineProperty(v,'playbackRate',{get:()=>1,set:()=>{throw new Error('unsupported');}}); });
  assert.equal((await page.evaluate(() => window.toggleMessage())).isActive, false);
});

test('targets the largest visible video and stops when it is removed', async t => {
  const page = await openPage(t, { html: '<video id="small" style="width:40px;height:40px"></video><video id="main" style="width:640px;height:360px"></video>' });
  await loadContent(page);
  await page.keyboard.press('s');
  assert.equal((await videoState(page,'#small')).rate, 1);
  assert.equal((await videoState(page,'#main')).rate, 16);
  await page.locator('#main').evaluate(v=>v.remove());
  await page.waitForFunction(() => window.testMessages.at(-1)?.isActive === false);
  assert.equal((await state(page)).isActive, false);
});
