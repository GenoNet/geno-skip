const {test} = require('node:test');
const assert=require('node:assert/strict');
const {openPage,loadContent,state,videoState}=require('./helpers/browser.cjs');

test('saved settings enable a new site immediately and removal restores the active video',async t=>{
  const page=await openPage(t,{hostname:'custom.example',storage:{videoUrls:['youtube.com']}});
  await loadContent(page);
  assert.equal(await page.locator('.geno-skip-button').count(),0);
  assert.equal((await page.evaluate(()=>window.toggleMessage())).isActive,false);
  await page.evaluate(()=>window.updateSettings({videoUrls:['custom.example'],accelerationKey:'A'}));
  assert.equal(await page.locator('.geno-skip-button').count(),1);
  await page.keyboard.press('s');assert.equal((await state(page)).isActive,false);
  await page.keyboard.press('a');assert.equal((await state(page)).isActive,true);
  await page.evaluate(()=>window.updateSettings({videoUrls:[]}));
  assert.equal((await videoState(page)).rate,1);
  assert.equal((await state(page)).isActive,false);
  assert.equal(await page.locator('.geno-skip-button').count(),0);
});

test('offscreen videos already have a fallback button when scrolled into view',async t=>{
  const page=await openPage(t,{html:'<div style="height:1800px"></div><video style="width:640px;height:360px"></video>'});
  await loadContent(page);
  assert.equal(await page.locator('.geno-skip-button').count(),1);
  await page.locator('video').scrollIntoViewIfNeeded();
  await page.locator('.geno-skip-button').click();
  assert.equal((await videoState(page)).rate,16);
});

test('preloaded hidden players gain controls when their ancestor is shown',async t=>{
  const page=await openPage(t,{html:'<section id="panel" style="display:none"><div><video style="width:640px;height:360px"></video></div></section>'});
  await loadContent(page);
  assert.equal(await page.locator('.geno-skip-button').count(),0);
  await page.locator('#panel').evaluate(e=>{e.style.display='block';});
  await page.waitForFunction(()=>document.querySelectorAll('.geno-skip-button').length===1,{},{timeout:1500});
  await page.locator('.geno-skip-button').click();
  assert.equal((await videoState(page)).rate,16);
});

test('saved shifted punctuation shortcut works while Shift-letter remains ignored',async t=>{
  const page=await openPage(t,{storage:{accelerationKey:'!'}});
  await loadContent(page);
  await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'!',shiftKey:true,bubbles:true})));
  assert.equal((await state(page)).isActive,true);
});

test('a single player with multiple media elements gets one button for the main video',async t=>{
  const page=await openPage(t,{html:'<div class="html5-video-player"><video id="preview" style="width:30px;height:20px"></video><video id="main" style="width:640px;height:360px"></video><div class="ytp-right-controls"></div></div>'});
  await loadContent(page);
  assert.equal(await page.locator('.geno-skip-button').count(),1);
  await page.locator('.geno-skip-button').click();
  assert.equal((await videoState(page,'#main')).rate,16);
  assert.equal((await videoState(page,'#preview')).rate,1);
});

test('player rate override clears acceleration instead of showing a stale spinning face',async t=>{
  const page=await openPage(t);
  await loadContent(page);
  await page.locator('.geno-skip-button').click();
  await page.locator('video').evaluate(v=>{v.playbackRate=1;});
  await page.waitForTimeout(50);
  assert.equal((await state(page)).isActive,false);
  assert.equal(await page.locator('.geno-skip-button').getAttribute('aria-pressed'),'false');
});

test('SPA transition cancels acceleration and does not accelerate the replacement video',async t=>{
  const page=await openPage(t);
  await loadContent(page);
  await page.keyboard.press('s');
  await page.evaluate(()=>{document.querySelector('video').outerHTML='<video style="width:640px;height:360px"></video>';document.dispatchEvent(new Event('yt-navigate-finish'));});
  await page.waitForFunction(()=>document.querySelectorAll('.geno-skip-button').length===1);
  assert.equal((await videoState(page)).rate,1);
  assert.equal((await state(page)).isActive,false);
});

test('an actual local media file advances while accelerated and returns to its prior speed',async t=>{
  const page=await openPage(t);
  const samples=8000*10;
  const wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  await page.route('https://www.youtube.com/local.wav',route=>route.fulfill({contentType:'audio/wav',body:wav}));
  await page.locator('video').evaluate(async v=>{v.src='/local.wav';v.muted=true;await v.play();v.playbackRate=1.5;});
  await loadContent(page);
  await page.keyboard.press('s');
  await page.waitForFunction(()=>document.querySelector('video').currentTime>1);
  assert.equal((await videoState(page)).rate,16);
  await page.keyboard.press('s');
  assert.deepEqual(await videoState(page),{rate:1.5,volume:1,muted:true});
});
