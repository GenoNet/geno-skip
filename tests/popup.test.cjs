const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {openPage, root} = require('./helpers/browser.cjs');
async function popup(t,{storage={},response={isActive:false},missing=false}={}) {
  const html=fs.readFileSync(path.join(root,'popup.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  const page=await openPage(t,{html,storage});
  await page.evaluate(({response,missing})=>{
    window.testResponse=response;window.testMissing=missing;
    chrome.tabs={query:(filter,cb)=>cb([{id:10}]),sendMessage:(id,message,cb)=>{
      if(window.testMissing)chrome.runtime.lastError={message:'No receiver'};
      cb(window.testMissing?undefined:window.testResponse);
      delete chrome.runtime.lastError;
    }};
  },{response,missing});
  for(const file of ['settings.js','popup.js']) await page.addScriptTag({path:path.join(root,file)});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  return page;
}
test('settings UI normalizes and saves hotkey/sites with empty list allowed',async t=>{
  const page=await popup(t);
  await page.locator('#accelerationKey').fill('a');
  await page.locator('#videoUrl').fill('https://www.youtube.com/watch?v=x\nwww.youtube.com\nnicovideo.jp');
  await page.locator('#saveButton').click();
  const saved=await page.evaluate(()=>window.testStorage);
  assert.equal(saved.accelerationKey,'A');
  assert.deepEqual(saved.videoUrls,['www.youtube.com','nicovideo.jp']);
  await page.locator('#videoUrl').fill('');await page.locator('#saveButton').click();
  assert.deepEqual((await page.evaluate(()=>window.testStorage)).videoUrls,[]);
});
test('invalid site line prevents any settings write and displays line number',async t=>{
  const page=await popup(t);
  await page.locator('#videoUrl').fill('youtube.com\n*.invalid');
  await page.locator('#saveButton').click();
  assert.deepEqual(await page.evaluate(()=>window.testStorage),{});
  assert.match(await page.locator('#statusMessage').textContent(),/2/);
});
test('unavailable receiver displays a useful message instead of silently failing',async t=>{
  const page=await popup(t,{missing:true});
  assert.equal(await page.locator('#statusMessage').count(),1);
  assert.match(await page.locator('#statusMessage').textContent(),/動画|更新|操作/);
  await page.locator('#goButton').click();
  assert.match(await page.locator('#statusMessage').textContent(),/動画|更新|操作/);
});
test('ignores acceleration notifications from another tab',async t=>{
  const page=await popup(t);
  await page.evaluate(()=>window.testMessageListeners.forEach(fn=>fn({type:'ACCEL_STATE',isActive:true},{tab:{id:99}})));
  assert.equal(await page.locator('#goButton').textContent(),'Go!');
  await page.evaluate(()=>window.testMessageListeners.forEach(fn=>fn({type:'ACCEL_STATE',isActive:true},{tab:{id:10}})));
  assert.equal(await page.locator('#goButton').textContent(),'Stop!');
});
test('storage failure is shown and never claimed as saved',async t=>{
  const page=await popup(t);
  await page.evaluate(()=>{chrome.storage.sync.set=(data,cb)=>{chrome.runtime.lastError={message:'quota'};cb();delete chrome.runtime.lastError;};});
  await page.locator('#saveButton').click();
  assert.equal(await page.locator('#statusMessage').count(),1);
  assert.match(await page.locator('#statusMessage').textContent(),/保存できません/);
});
