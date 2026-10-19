const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, loadContent, state, videoState } = require('./helpers/browser.cjs');
const youtube = '<div class="html5-video-player"><video style="width:640px;height:360px"></video><div class="ytp-chrome-controls"><div class="ytp-right-controls"><button id="other">Other extension</button><button class="ytp-settings-button">Settings</button></div></div></div>';

test('Geno precedes every other button in the controls group',async t=>{
  const page=await openPage(t,{html:youtube});
  await loadContent(page);
  assert.equal(await page.locator('.ytp-right-controls > :first-child').getAttribute('class'),'geno-skip-button ytp-button');
  assert.equal(await page.locator('#other').count(),1);
});

test('face resources are painted on HTML outside SVG resource loading',async t=>{
  const page=await openPage(t,{html:youtube});
  await loadContent(page);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.geno-skip-face')).backgroundImage.startsWith('url("data:image/png;base64,'),null,{timeout:1500});
  const painting=await page.locator('.geno-skip-button').evaluate(button=>{
    const face=button.querySelector('.geno-skip-face');
    return {html:face.namespaceURI==='http://www.w3.org/1999/xhtml',outsideSvg:face.closest('svg')===null,
      source:getComputedStyle(face).backgroundImage,svgUsesImage:[...button.querySelectorAll('svg')].some(svg=>getComputedStyle(svg).backgroundImage!=='none' || svg.querySelector('image, use'))};
  });
  assert.equal(painting.html,true);
  assert.equal(painting.outsideSvg,true);
  assert.match(painting.source,/^url\("data:image\/png;base64,/);
  assert.equal(painting.svgUsesImage,false);
  const size=await page.locator('.geno-skip-face').evaluate(async face=>{
    const image=new Image();image.src=getComputedStyle(face).backgroundImage.slice(5,-2);await image.decode();
    return {width:image.naturalWidth,height:image.naturalHeight};
  });
  assert.equal(size.width,size.height);
  assert.ok(size.width>=512);
});

test('face remains centered when native player styles change the button display',async t=>{
  const page=await openPage(t,{html:youtube});
  await loadContent(page);
  await page.addStyleTag({content:'.ytp-right-controls .ytp-button { display:inline-block; text-align:left; }'});
  await page.emulateMedia({reducedMotion:'reduce'});
  const button=page.locator('.geno-skip-button');
  for(const active of [false,true]) {
    if(active) await button.click();
    const offset=await button.evaluate(button=>{
      const b=button.getBoundingClientRect(),f=button.querySelector('.geno-skip-face').getBoundingClientRect();
      return {x:Math.abs((b.left+b.right-f.left-f.right)/2),y:Math.abs((b.top+b.bottom-f.top-f.bottom)/2)};
    });
    assert.ok(offset.x<0.5 && offset.y<0.5,JSON.stringify(offset));
  }
});

test('face fits small native controls despite YouTube SVG styles, including while rotating',async t=>{
  const html=`<style>
    .html5-video-player .ytp-chrome-controls .ytp-button svg {width:100%;height:100%;}
    .ytp-right-controls{display:flex;height:32px;}
    .ytp-right-controls .ytp-button{box-sizing:border-box;width:36px;height:32px;padding:0;border:0;}
  </style><div class="html5-video-player"><video style="width:640px;height:360px"></video><div class="ytp-chrome-controls"><div class="ytp-right-controls"><button class="ytp-button ytp-settings-button"><svg viewBox="0 0 24 24"></svg></button></div></div></div>`;
  const page=await openPage(t,{html});
  await loadContent(page);
  const button=page.locator('.geno-skip-button');
  for(const active of [false,true]) {
    if(active) await button.click();
    if(active) await button.locator('.geno-skip-face').evaluate(face=>{const animation=face.getAnimations()[0];animation.pause();animation.currentTime=700/8;});
    const bounds=await button.evaluate(button=>{
      const b=button.getBoundingClientRect(),f=button.querySelector('.geno-skip-face').getBoundingClientRect();
      return {inside:f.left>=b.left && f.right<=b.right && f.top>=b.top && f.bottom<=b.bottom,centered:Math.abs((b.left+b.right-f.left-f.right)/2)<0.5 && Math.abs((b.top+b.bottom-f.top-f.bottom)/2)<0.5};
    });
    assert.deepEqual(bounds,{inside:true,centered:true});
  }
});

test('native SVG minimum sizes and margins cannot move the face outside its centered frame',async t=>{
  const html=`<style>
    .html5-video-player{position:relative;width:640px;}
    .ytp-chrome-controls{height:40px;}
    .ytp-right-controls{display:flex;justify-content:flex-end;}
    .html5-video-player .ytp-chrome-controls .ytp-button{position:relative;width:40px;height:40px;padding:0;border:0;}
    .html5-video-player .ytp-chrome-controls .geno-skip-button{position:static;}
    .html5-video-player .ytp-chrome-controls .ytp-button svg{position:absolute;top:50%;left:50%;min-width:100%;min-height:100%;margin:0;}
  </style><div class="html5-video-player"><video style="width:640px;height:360px"></video><div class="ytp-chrome-controls"><div class="ytp-right-controls"><button class="ytp-button ytp-settings-button"><svg viewBox="0 0 24 24"></svg></button></div></div></div>`;
  const page=await openPage(t,{html});
  await loadContent(page);
  const button=page.locator('.geno-skip-button');
  for(const zoom of [1,1.25,2]) {
    await page.evaluate(zoom=>{document.body.style.zoom=zoom;},zoom);
    for(const active of [false,true]) {
      if(active) await button.click();
      if(active) await button.locator('.geno-skip-face').evaluate(face=>{const animation=face.getAnimations()[0];animation.pause();animation.currentTime=700/8;});
      const bounds=await button.evaluate(button=>{
        const b=button.getBoundingClientRect(),f=button.querySelector('.geno-skip-face').getBoundingClientRect();
        return {inside:f.left>=b.left && f.right<=b.right && f.top>=b.top && f.bottom<=b.bottom,centered:Math.abs((b.left+b.right-f.left-f.right)/2)<.5 && Math.abs((b.top+b.bottom-f.top-f.bottom)/2)<.5,smaller:f.width<b.width && f.height<b.height};
      });
      assert.deepEqual(bounds,{inside:true,centered:true,smaller:true},`zoom=${zoom}, active=${active}`);
      if(active) await button.click();
    }
  }
});

test('YouTube button keeps the default face and spins throughout acceleration, restores on click', async t => {
  const page = await openPage(t,{html:youtube});
  await loadContent(page);
  assert.equal(await page.locator('.ytp-right-controls .geno-skip-button').count(),1);
  const button=page.locator('.geno-skip-button');
  const before=await button.locator('.geno-skip-face').evaluate(e=>getComputedStyle(e).backgroundPosition);
  await button.click();
  assert.equal((await videoState(page)).rate,16);
  assert.equal(await button.getAttribute('aria-pressed'),'true');
  assert.equal(await button.locator('.geno-skip-face').evaluate(e=>getComputedStyle(e).backgroundPosition),before);
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
  await page.evaluate(()=>{document.querySelector('.ytp-right-controls').innerHTML='<button class="ytp-settings-button">Settings</button>';});
  await page.waitForFunction(()=>document.querySelectorAll('.ytp-right-controls .geno-skip-button').length===1);
  await page.evaluate(()=>{for(let i=0;i<200;i++) document.body.append(document.createElement('span'));document.dispatchEvent(new Event('yt-navigate-finish'));});
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.geno-skip-button').count(),1);
});

test('positioned custom players keep their fallback control visible and clickable',async t=>{
  const page=await openPage(t,{hostname:'www.nicovideo.jp',html:'<div style="position:relative;width:640px;height:360px;overflow:hidden"><video style="position:absolute;inset:0;width:100%;height:100%;z-index:1;background:black"></video></div>'});
  await loadContent(page);
  const visible=await page.locator('.geno-skip-button').evaluate(button=>{
    const r=button.getBoundingClientRect();
    const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    const v=document.querySelector('video').getBoundingClientRect();
    return {clickable:button.contains(hit),nearBottom:r.bottom>=v.bottom-12};
  });
  assert.deepEqual(visible,{clickable:true,nearBottom:true});
  await page.locator('.geno-skip-button').click();
  assert.equal((await videoState(page)).rate,16);
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

test('native control stays in a fullscreen player and respects reduced motion',async t=>{
  const page=await openPage(t,{html:youtube});
  await loadContent(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.html5-video-player').evaluate(root=>{
    const trigger=document.createElement('button');trigger.id='fullscreen';trigger.textContent='Fullscreen';
    trigger.onclick=()=>root.requestFullscreen();root.append(trigger);
  });
  await page.locator('#fullscreen').click();
  await page.waitForFunction(()=>document.fullscreenElement);
  assert.equal(await page.locator(':fullscreen .geno-skip-button').count(),1);
  await page.locator('.geno-skip-button').click();
  assert.equal((await videoState(page)).rate,16);
  assert.equal(await page.locator('.geno-skip-face').evaluate(e=>getComputedStyle(e).animationName),'none');
  assert.equal(await page.locator('.geno-skip-button').getAttribute('aria-pressed'),'true');
});
