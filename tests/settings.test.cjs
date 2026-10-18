const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function settings() {
  const context=vm.createContext({URL});
  const file=path.join(__dirname,'../settings.js');
  if(fs.existsSync(file)) vm.runInContext(fs.readFileSync(file,'utf8'),context);
  assert.ok(context.GenoSkipSettings,'shared settings validator exists');
  return context.GenoSkipSettings;
}
test('normalizes URL hosts and deduplicates without accepting misleading domains',()=>{
  const s=settings();
  assert.equal(JSON.stringify(s.parseSites('YouTube.com\nhttps://youtube.com/watch?v=x\nnicovideo.jp').sites),JSON.stringify(['youtube.com','nicovideo.jp']));
  assert.equal(s.matches('www.youtube.com',['youtube.com']),true);
  assert.equal(s.matches('notyoutube.com',['youtube.com']),false);
  assert.equal(s.matches('youtube.com.evil.test',['youtube.com']),false);
});
test('reports invalid lines and rejects credentials, wildcards and non-web protocols',()=>{
  const s=settings();
  const result=s.parseSites('youtube.com\n*.test\nfile:///x\nhttps://name:secret@example.com\nhello world');
  assert.equal(JSON.stringify(result.invalidLines),'[2,3,4,5]');
});
test('empty sites disable all sites and corrupt stored values are ignored',()=>{
  const s=settings();
  assert.equal(s.fromStorage({videoUrls:[]}).videoUrls.length,0);
  assert.equal(s.fromStorage({videoUrls:['youtube.com',null,{},'bad host']}).videoUrls.length,1);
  assert.equal(s.fromStorage({accelerationKey:{}}).accelerationKey,'S');
  assert.equal(s.normalizeKey(' a '),'A');
  assert.equal(s.normalizeKey('Enter'),null);
});
test('debugger skip is opt-in and only accepts an explicit boolean',()=>{
  const s=settings();
  assert.equal(s.fromStorage().debuggerSkip,false);
  assert.equal(s.fromStorage({debuggerSkip:'true'}).debuggerSkip,false);
  assert.equal(s.fromStorage({debuggerSkip:true}).debuggerSkip,true);
});
