const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const manifest=require('../manifest.json');
test('manifest wires classic scripts, settings page, CSS and only the face asset',()=>{
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.permissions,['activeTab','storage']);
  assert.deepEqual(manifest.content_scripts[0].js,['settings.js','player-button.js','content.js']);
  assert.equal(manifest.options_ui.page,'popup.html');
  assert.deepEqual(manifest.web_accessible_resources[0].resources,['assets/geno-faces.png']);
  for(const file of [...manifest.content_scripts[0].js,...manifest.content_scripts[0].css,manifest.action.default_popup,...Object.values(manifest.icons),...manifest.web_accessible_resources[0].resources])assert.ok(fs.existsSync(path.join(__dirname,'..',file)),file);
});
