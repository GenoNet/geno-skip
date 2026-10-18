const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {openPage, root} = require('./helpers/browser.cjs');
async function popup(t,{storage={},local={},response={isActive:false},missing=false}={}) {
  const html=fs.readFileSync(path.join(root,'popup.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  const page=await openPage(t,{html,storage,local});
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
test('popup shows SKIP progress separately from errors and updates only for its active tab',async t=>{
  const page=await popup(t,{response:{isActive:true,skipStatus:'SKIP：ボタン待ち',reason:'待ってくれ！'}});
  assert.equal(await page.locator('#skipStatus').count(),1);
  assert.equal(await page.locator('#skipStatus').textContent(),'SKIP：ボタン待ち');
  assert.equal(await page.locator('#statusMessage').textContent(),'待ってくれ！');
  await page.evaluate(()=>window.testMessageListeners.forEach(fn=>fn({type:'ACCEL_STATE',isActive:true,skipStatus:'別のタブ'},{tab:{id:99}})));
  assert.equal(await page.locator('#skipStatus').textContent(),'SKIP：ボタン待ち');
  await page.evaluate(()=>window.testMessageListeners.forEach(fn=>fn({type:'ACCEL_STATE',isActive:true,skipStatus:'SKIP：入力中'},{tab:{id:10}})));
  assert.equal(await page.locator('#skipStatus').textContent(),'SKIP：入力中');
  await page.evaluate(()=>window.testMessageListeners.forEach(fn=>fn({type:'ACCEL_STATE',isActive:false},{tab:{id:10}})));
  assert.equal(await page.locator('#skipStatus').isVisible(),false);
});
test('storage failure is shown and never claimed as saved',async t=>{
  const page=await popup(t);
  await page.evaluate(()=>{chrome.storage.sync.set=(data,cb)=>{chrome.runtime.lastError={message:'quota'};cb();delete chrome.runtime.lastError;};});
  await page.locator('#saveButton').click();
  assert.equal(await page.locator('#statusMessage').count(),1);
  assert.match(await page.locator('#statusMessage').textContent(),/保存できません/);
});
test('debugger mode defaults on, saves per browser and can be turned off again',async t=>{
  const page=await popup(t);
  assert.equal(await page.locator('#debuggerSkip').count(),1);
  assert.equal(await page.locator('#debuggerSkip').isChecked(),true);
  await page.locator('#saveButton').click();
  assert.equal(await page.evaluate(()=>window.testLocalStorage.debuggerSkip),true);
  assert.equal(await page.evaluate(()=>window.testStorage.debuggerSkip),undefined);
  await page.locator('#debuggerSkip').uncheck();
  await page.locator('#saveButton').click();
  assert.equal(await page.evaluate(()=>window.testLocalStorage.debuggerSkip),false);
});
test('skip effect defaults off, saves locally and has only its requested label',async t=>{
  const page=await popup(t);
  assert.equal(await page.locator('#showSkipEffect').count(),1);
  assert.equal(await page.locator('#showSkipEffect').isChecked(),false);
  assert.equal((await page.locator('label[for="showSkipEffect"]').textContent()).trim(),'ぶっとばし演出表示');
  await page.locator('#showSkipEffect').check();
  await page.locator('#saveButton').click();
  assert.equal(await page.evaluate(()=>window.testLocalStorage.showSkipEffect),true);
  assert.equal(await page.evaluate(()=>window.testStorage.showSkipEffect),undefined);
  assert.equal(await page.locator('#debuggerHelp').count(),0);
  assert.equal(await page.locator('#saveButton ~ p').count(),0);
  assert.doesNotMatch(await page.locator('body').textContent(),/顔を押せ！|Chromeのデバッグ権限を使います/);
});
test('saved OFF and effect ON are restored when settings are reopened',async t=>{
  const page=await popup(t,{local:{debuggerSkip:false,showSkipEffect:true}});
  assert.equal(await page.locator('#debuggerSkip').isChecked(),false);
  assert.equal(await page.locator('#showSkipEffect').count(),1);
  assert.equal(await page.locator('#showSkipEffect').isChecked(),true);
});
test('the save button fits the initial Chrome popup without scrolling',async t=>{
  const page=await popup(t);
  await page.setViewportSize({width:360,height:600});
  const bounds=await page.locator('#saveButton').boundingBox();
  assert.ok(bounds.y+bounds.height<=600,JSON.stringify(bounds));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),360);
});
test('a stopped debugger is reflected in the checkbox with its reason visible',async t=>{
  const page=await popup(t,{local:{debuggerSkip:true}});
  assert.equal(await page.locator('#debuggerSkip').count(),1);
  assert.equal(await page.locator('#debuggerSkip').isChecked(),true);
  await page.evaluate(()=>window.updateLocalSettings({debuggerSkip:false,debuggerSkipError:'DevToolsを閉じて、もう一度ONにしてくれ！'}));
  assert.equal(await page.locator('#debuggerSkip').isChecked(),false);
  assert.match(await page.locator('#debuggerStatus').textContent(),/DevTools/);
});
