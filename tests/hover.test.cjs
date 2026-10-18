const {test}=require('node:test');
const assert=require('node:assert/strict');
const {openPage,loadContent,state}=require('./helpers/browser.cjs');

// Model native control styles, including the newer 24px SVG hover selector.
const player=`<style>
 .html5-video-player{position:relative;width:640px;height:408px;background:#111;}
 video{display:block;width:100%;height:360px;}
 .ytp-chrome-controls{height:48px;display:flex;justify-content:flex-end;}
 .ytp-right-controls{height:48px;display:flex;align-items:center;overflow:hidden;gap:4px;}
 .ytp-button{box-sizing:border-box;width:40px;height:40px;padding:0;margin:0;border:0;background:transparent;color:white;border-radius:50%;}
 .ytp-button:has(svg[viewBox="0 0 24 24"]):hover{background:rgba(255,255,255,.12);}
 .ytp-button:focus-visible{outline:2px solid white;}
 .html5-video-player .ytp-tooltip{opacity:0;transform:translateY(10px);transition:opacity 150ms;pointer-events:auto;}
 .ytp-tooltip-bottom-text{display:block;padding:8px 10px;border-radius:6px;background:rgb(28,28,28);color:white;font:500 12px/18px Arial;}
</style><div class="html5-video-player"><video></video><div class="ytp-chrome-controls"><div class="ytp-right-controls"><button class="ytp-button ytp-settings-button" aria-label="Settings"><svg viewBox="0 0 24 24"></svg></button></div></div></div>`;

async function setup(t,html=player) {
  const page=await openPage(t,{html});
  await page.clock.install();
  await loadContent(page);
  return page;
}
async function hover(page) {
  await page.locator('.geno-skip-button').hover();
  await page.clock.fastForward(350);
}

test('native tooltip appears above controls without a browser title popup or clipping',async t=>{
  const page=await setup(t);
  const button=page.locator('.geno-skip-button'),tip=page.locator('.geno-skip-tooltip');
  assert.equal(await tip.count(),1);
  assert.equal(await button.getAttribute('title'),null);
  assert.equal(await tip.isHidden(),true);
  await hover(page);
  assert.equal(await tip.isVisible(),true);
  assert.equal(await tip.evaluate(el=>getComputedStyle(el).opacity),'1');
  assert.equal(await tip.evaluate(el=>getComputedStyle(el).transform),'none');
  assert.equal((await tip.textContent()).trim(),'じーのスキップ (S)');
  assert.equal(await button.getAttribute('aria-describedby'),await tip.getAttribute('id'));
  const geometry=await tip.evaluate(tip=>{
    const r=tip.getBoundingClientRect(),b=document.querySelector('.geno-skip-button').getBoundingClientRect(),p=document.querySelector('.html5-video-player').getBoundingClientRect();
    return {above:r.bottom<b.top,inside:r.left>=p.left && r.right<=p.right,hit:tip.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
  });
  assert.deepEqual(geometry,{above:true,inside:true,hit:false});
});

test('native hover background and dimensions match neighboring YouTube buttons',async t=>{
  const page=await setup(t);
  const reference=page.locator('.ytp-settings-button'),button=page.locator('.geno-skip-button');
  const appearance=locator=>locator.evaluate(el=>{
    const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    return {width:r.width,height:r.height,background:s.backgroundColor,radius:s.borderRadius};
  });
  await reference.hover();const expected=await appearance(reference);
  await hover(page);
  assert.deepEqual(await appearance(button),expected);
  const box=await page.locator('.geno-skip-tooltip').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  assert.equal(await page.locator('.geno-skip-tooltip').isHidden(),true);
  assert.equal((await appearance(button)).background,'rgba(0, 0, 0, 0)');
});

test('hidden native controls do not determine the button dimensions or hover style',async t=>{
  const html=player.replace('<button class="ytp-button ytp-settings-button"','<button class="ytp-button ytp-subtitles-button" hidden><svg viewBox="0 0 36 36"></svg></button><button class="ytp-button ytp-settings-button"');
  const page=await setup(t,html);
  await hover(page);
  const result=await page.locator('.geno-skip-button').evaluate(button=>{
    const reference=document.querySelector('.ytp-settings-button'),bounds=button.getBoundingClientRect(),expected=reference.getBoundingClientRect();
    return {sameSize:bounds.width===expected.width && bounds.height===expected.height,viewBox:button.querySelector('svg').getAttribute('viewBox'),background:getComputedStyle(button).backgroundColor};
  });
  assert.deepEqual(result,{sameSize:true,viewBox:'0 0 24 24',background:'rgba(255, 255, 255, 0.12)'});
});

test('brief hover is cancelled and Escape or click dismisses the tooltip',async t=>{
  const page=await setup(t),button=page.locator('.geno-skip-button'),tip=page.locator('.geno-skip-tooltip');
  assert.equal(await tip.count(),1);
  await button.hover();await page.clock.fastForward(100);
  await page.evaluate(()=>window.updateSettings({accelerationKey:'A'}));
  assert.equal(await tip.isHidden(),true);
  await page.mouse.move(1,1);await page.clock.fastForward(500);
  assert.equal(await tip.isHidden(),true);
  await hover(page);assert.equal(await tip.isVisible(),true);
  await page.keyboard.press('Escape');await page.clock.fastForward(500);
  assert.equal(await tip.isHidden(),true);
  await page.mouse.move(1,1);await hover(page);assert.equal(await tip.isVisible(),true);
  await button.click();assert.equal(await tip.isHidden(),true);
  assert.equal((await state(page)).isActive,true);
});

test('keyboard focus shows the tooltip and moving focus closes it',async t=>{
  const page=await setup(t),tip=page.locator('.geno-skip-tooltip');
  assert.equal(await tip.count(),1);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.geno-skip-button').evaluate(el=>el===document.activeElement),true);
  assert.equal(await tip.isVisible(),true);
  await page.keyboard.press('Tab');assert.equal(await tip.isHidden(),true);
});

test('keyboard focus shows the tooltip after YouTube reveals hidden controls',async t=>{
  const page=await openPage(t,{html:player});
  await page.clock.install();
  await page.addStyleTag({content:'.ytp-autohide .ytp-chrome-controls{opacity:0}'});
  await page.locator('.html5-video-player').evaluate(root=>{
    root.classList.add('ytp-autohide');
    root.addEventListener('focusin',()=>requestAnimationFrame(()=>root.classList.remove('ytp-autohide')),{once:true});
  });
  await loadContent(page);
  await page.keyboard.press('Tab');await page.clock.runFor(100);
  const tip=page.locator('.geno-skip-tooltip');
  assert.equal(await page.locator('.geno-skip-button').evaluate(el=>el===document.activeElement),true);
  assert.equal(await tip.isVisible(),true);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.updateSettings({accelerationKey:'A'}));
  assert.equal(await tip.isHidden(),true);
});

test('tooltip tracks shortcut settings, acceleration and automatic restoration',async t=>{
  const page=await setup(t),tip=page.locator('.geno-skip-tooltip');
  assert.equal(await tip.count(),1);
  await hover(page);
  await page.evaluate(()=>window.updateSettings({accelerationKey:'A'}));
  assert.equal((await tip.textContent()).trim(),'じーのスキップ (A)');
  assert.equal(await page.locator('.geno-skip-button').getAttribute('aria-keyshortcuts'),'A');
  await page.keyboard.press('a');assert.equal((await tip.textContent()).trim(),'加速を解除 (A)');
  await page.clock.fastForward(3000);assert.equal((await tip.textContent()).trim(),'じーのスキップ (A)');
});

test('replacing controls or disabling the site removes old tooltip nodes',async t=>{
  const page=await setup(t);
  assert.equal(await page.locator('.geno-skip-tooltip').count(),1);
  await hover(page);
  await page.locator('.ytp-right-controls').evaluate(el=>{el.innerHTML='<button class="ytp-button ytp-settings-button"><svg viewBox="0 0 24 24"></svg></button>';});
  await page.clock.runFor(50);
  assert.equal(await page.locator('.geno-skip-tooltip').count(),1);
  assert.equal(await page.locator('.geno-skip-button').count(),1);
  await page.evaluate(()=>window.updateSettings({videoUrls:[]}));
  assert.equal(await page.locator('.geno-skip-tooltip').count(),0);
  await page.keyboard.press('Escape');await page.clock.fastForward(500);
  assert.equal(await page.locator('.geno-skip-tooltip').count(),0);
});

test('tooltip stays inside a narrow player and follows fullscreen resizing',async t=>{
  const page=await setup(t);
  assert.equal(await page.locator('.geno-skip-tooltip').count(),1);
  await page.locator('.html5-video-player').evaluate(root=>{root.style.width='240px';});
  await hover(page);
  const inside=()=>page.locator('.geno-skip-tooltip').evaluate(tip=>{
    const t=tip.getBoundingClientRect(),p=tip.closest('.html5-video-player').getBoundingClientRect();
    return t.left>=p.left && t.right<=p.right && t.top>=p.top;
  });
  assert.equal(await inside(),true);
  await page.locator('.ytp-settings-button').evaluate(button=>{button.onclick=()=>button.closest('.html5-video-player').requestFullscreen();});
  await page.locator('.ytp-settings-button').click();
  await page.waitForFunction(()=>document.fullscreenElement);
  await hover(page);
  assert.equal(await inside(),true);
});

test('generic tooltip appears above the dock without covering its button',async t=>{
  const page=await setup(t,'<video style="width:640px;height:360px"></video>');
  await hover(page);
  const bounds=await page.locator('.geno-skip-tooltip').boundingBox(),button=await page.locator('.geno-skip-button').boundingBox();
  assert.ok(bounds.y+bounds.height<button.y);
  assert.ok(bounds.x>=0);
});

test('generic tooltip moves below its button when there is no room above',async t=>{
  const page=await setup(t,'<video style="width:640px;height:32px"></video>');
  await hover(page);
  const bounds=await page.locator('.geno-skip-tooltip').boundingBox(),button=await page.locator('.geno-skip-button').boundingBox();
  assert.ok(bounds.y>button.y+button.height);
});
