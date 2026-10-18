const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, loadContent, state, videoState } = require('./helpers/browser.cjs');
const youtube = '<div class="html5-video-player"><video style="width:640px;height:360px"></video><div class="ytp-chrome-controls"><div class="ytp-right-controls"><button id="other">Other extension</button><button class="ytp-settings-button">Settings</button></div></div></div>';

test('YouTube button changes face and spins throughout acceleration, restores on click', async t => {
  const page = await openPage(t,{html:youtube});
  await loadContent(page);
  assert.equal(await page.locator('.ytp-right-controls .geno-skip-button').count(),1);
  const button=page.locator('.geno-skip-button');
  const before=await button.locator('.geno-skip-face').evaluate(e=>getComputedStyle(e).backgroundPosition);
  await button.click();
  assert.equal((await videoState(page)).rate,16);
  assert.equal(await button.getAttribute('aria-pressed'),'true');
  assert.notEqual(await button.locator('.geno-skip-face').evaluate(e=>getComputedStyle(e).backgroundPosition),before);
  assert.notEqual(await button.locator('.geno-skip-face').evaluate(e=>getComputedStyle(e).animationName),'none');
  await button.click();
  assert.equal((await videoState(page)).rate,1);
  assert.equal(await button.getAttribute('aria-pressed'),'false');
  assert.equal(await button.locator('.geno-skip-face').evaluate(e=>getComputedStyle(e).animationName),'none');
  assert.equal(await page.locator('#other').count(),1);
});

test('keyboard activation and automatic restoration update button state', async t=>{
  const page=await openPage(t,{html:youtube});
  await page.clock.install();
  await loadContent(page);
  const button=page.locator('.geno-skip-button');
  assert.equal(await button.count(),1);
  await button.focus(); await page.keyboard.press('Space');
  assert.equal((await state(page)).isActive,true);
  await page.clock.fastForward(3000);
  assert.equal(await button.getAttribute('aria-pressed'),'false');
  await button.focus(); await page.keyboard.press('Enter');
  assert.equal((await state(page)).isActive,true);
});

test('control replacement and SPA navigation create one button without removing other controls',async t=>{
  const page=await openPage(t,{html:youtube});
  await loadContent(page);
  assert.equal(await page.locator('.geno-skip-button').count(),1);
  await page.evaluate(()=>{document.querySelector('.ytp-right-controls').innerHTML='<button class="ytp-settings-button">Settings</button>';document.dispatchEvent(new Event('yt-navigate-finish'));});
  await page.waitForFunction(()=>document.querySelectorAll('.ytp-right-controls .geno-skip-button').length===1);
  await page.evaluate(()=>{for(let i=0;i<200;i++) document.body.append(document.createElement('span'));document.dispatchEvent(new Event('yt-navigate-finish'));});
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.geno-skip-button').count(),1);
});

test('fallback buttons operate their own video and switch sessions safely',async t=>{
  const page=await openPage(t,{hostname:'www.nicovideo.jp',html:'<video id="a" style="width:300px;height:150px"></video><video id="b" style="width:300px;height:150px"></video>'});
  await loadContent(page);
  assert.equal(await page.locator('.geno-skip-dock .geno-skip-button').count(),2);
  await page.locator('.geno-skip-button').nth(0).click();
  assert.equal((await videoState(page,'#a')).rate,16);
  await page.locator('.geno-skip-button').nth(1).click();
  assert.equal((await videoState(page,'#a')).rate,1);
  assert.equal((await videoState(page,'#b')).rate,16);
});

test('new controls replace generic dock and disabling site removes buttons',async t=>{
  const page=await openPage(t,{html:'<div class="html5-video-player"><video style="width:500px;height:300px"></video></div>'});
  await loadContent(page);
  assert.equal(await page.locator('.geno-skip-dock').count(),1);
  await page.evaluate(()=>{const e=document.createElement('div');e.className='ytp-right-controls';document.querySelector('.html5-video-player').append(e);});
  await page.waitForFunction(()=>document.querySelector('.ytp-right-controls .geno-skip-button'));
  assert.equal(await page.locator('.geno-skip-dock').count(),0);
  await page.evaluate(()=>window.updateSettings({videoUrls:[]}));
  assert.equal(await page.locator('.geno-skip-button').count(),0);
});
