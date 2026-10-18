const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const manifest=require('../manifest.json');
test('manifest wires classic scripts, settings page, CSS and only the face asset',()=>{
  assert.equal(manifest.manifest_version,3);
  assert.equal(manifest.version,'666.666');
  assert.equal(manifest.description,'地獄に落ちろ！！！');
  assert.deepEqual(manifest.permissions,['activeTab','storage','debugger']);
  assert.equal(manifest.background.service_worker,'background.js');
  assert.deepEqual(manifest.content_scripts[0].js,['settings.js','player-button.js','ad-skip.js','content.js']);
  assert.equal(manifest.options_ui.page,'popup.html');
  assert.deepEqual(manifest.web_accessible_resources[0].resources,['assets/geno-faces.png']);
  for(const file of [manifest.background.service_worker,...manifest.content_scripts[0].js,...manifest.content_scripts[0].css,manifest.action.default_popup,...Object.values(manifest.icons),...manifest.web_accessible_resources[0].resources])assert.ok(fs.existsSync(path.join(__dirname,'..',file)),file);
});
