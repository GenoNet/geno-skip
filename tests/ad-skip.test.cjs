const {test}=require('node:test');
const assert=require('node:assert/strict');
const {openPage,loadContent,state,videoState}=require('./helpers/browser.cjs');
function fixture({ad=true,button='<button class="ytp-ad-skip-button-modern">SKIP</button>'}={}) {
  return `<div class="html5-video-player${ad?' ad-showing':''}"><video style="width:640px;height:360px"></video><div class="ytp-right-controls"></div><div id="ad-controls">${button}</div></div>`;
}
async function setup(t,{html=fixture(),...options}={}) {
  const page=await openPage(t,{html,...options});
  await page.evaluate(()=>{
    window.skipClicks=0;
    document.querySelectorAll('#ad-controls button, #outside').forEach(button=>button.addEventListener('click',event=>{window.skipClicks++;event.stopPropagation();}));
  });
  return page;
}
const clicks=page=>page.evaluate(()=>window.skipClicks);

for(const selector of ['ytp-ad-skip-button-modern','ytp-ad-skip-button','ytp-skip-ad-button']) {
  test(`automatically clicks a visible YouTube ad skip control: ${selector}`,async t=>{
    const page=await setup(t,{html:fixture({button:`<button class="${selector}">スキップ</button>`})});
    await loadContent(page);
    await page.waitForTimeout(40);
    assert.equal(await clicks(page),1);
  });
}

test('waits for a hidden disabled skip control to become available',async t=>{
  const page=await setup(t,{html:fixture({button:'<button class="ytp-ad-skip-button-modern" hidden disabled aria-disabled="true">SKIP</button>'})});
  await loadContent(page);
  assert.equal(await clicks(page),0);
  await page.locator('.ytp-ad-skip-button-modern').evaluate(button=>{button.hidden=false;button.disabled=false;});
  await page.waitForTimeout(30);
  assert.equal(await clicks(page),0);
  await page.locator('.ytp-ad-skip-button-modern').evaluate(button=>button.setAttribute('aria-disabled','false'));
  await page.waitForFunction(()=>window.skipClicks===1,null,{timeout:1500});
});

test('clicks a control that appears after the ad starts',async t=>{
  const page=await setup(t,{html:fixture({ad:false,button:''})});
  await loadContent(page);
  await page.evaluate(()=>{
    document.querySelector('.html5-video-player').classList.add('ad-showing');
    const button=document.createElement('button');button.className='ytp-ad-skip-button-modern';button.textContent='SKIP';
    button.onclick=()=>window.skipClicks++;document.querySelector('#ad-controls').append(button);
  });
  await page.waitForFunction(()=>window.skipClicks===1,null,{timeout:1500});
});

test('does not click unrelated skip labels, non-ad controls, or controls outside the player',async t=>{
  const page=await setup(t,{html:fixture({ad:false})+'<button id="outside" class="ytp-ad-skip-button-modern">SKIP</button>'});
  await loadContent(page);
  assert.equal(await clicks(page),0);
  await page.evaluate(()=>{
    document.querySelector('#ad-controls').innerHTML='<button id="unrelated">Skip intro</button>';
    document.querySelector('#unrelated').onclick=()=>window.skipClicks++;
    document.querySelector('.html5-video-player').classList.add('ad-showing');
  });
  await page.waitForTimeout(50);
  assert.equal(await clicks(page),0);
});

test('does not retry a clicked control on every mutation, but handles the next ad',async t=>{
  const page=await setup(t);
  await loadContent(page);
  assert.equal(await clicks(page),1);
  await page.evaluate(()=>{for(let i=0;i<20;i++)document.querySelector('#ad-controls').append(document.createElement('span'));});
  await page.waitForTimeout(40);
  assert.equal(await clicks(page),1);
  await page.locator('.html5-video-player').evaluate(root=>root.classList.remove('ad-showing'));
  await page.locator('.html5-video-player').evaluate(root=>root.classList.add('ad-showing'));
  await page.waitForFunction(()=>window.skipClicks===2,null,{timeout:1500});
});

test('restores accelerated video before skip even when the site stops click propagation',async t=>{
  const page=await setup(t,{html:fixture({ad:false})});
  await page.locator('video').evaluate(v=>{v.playbackRate=1.5;v.volume=0;v.muted=true;});
  await loadContent(page);
  await page.keyboard.press('s');
  assert.equal((await state(page)).isActive,true);
  await page.locator('.html5-video-player').evaluate(root=>root.classList.add('ad-showing'));
  await page.waitForFunction(()=>window.skipClicks===1,null,{timeout:1500});
  assert.equal((await state(page)).isActive,false);
  assert.deepEqual(await videoState(page),{rate:1.5,volume:0,muted:true});
});

test('honors site disable and restarts after enabling it again',async t=>{
  const page=await setup(t,{html:fixture({ad:false})});
  await loadContent(page);
  await page.evaluate(()=>window.updateSettings({videoUrls:[]}));
  await page.locator('.html5-video-player').evaluate(root=>root.classList.add('ad-showing'));
  await page.waitForTimeout(40);
  assert.equal(await clicks(page),0);
  await page.evaluate(()=>window.updateSettings({videoUrls:['youtube.com']}));
  await page.waitForFunction(()=>window.skipClicks===1,null,{timeout:1500});
});

test('YouTube-looking buttons on other registered sites are not auto-clicked',async t=>{
  const page=await setup(t,{hostname:'youtube.com.evil.test',storage:{videoUrls:['evil.test']}});
  await loadContent(page);
  await page.waitForTimeout(40);
  assert.equal(await clicks(page),0);
});

test('an ad player does not click a skip control owned by a nested non-ad player',async t=>{
  const page=await setup(t,{html:fixture({button:'<div class="html5-video-player"><button class="ytp-ad-skip-button-modern">SKIP</button></div>'})});
  await loadContent(page);
  await page.waitForTimeout(40);
  assert.equal(await clicks(page),0);
});

test('auto-skipping another player does not cancel the currently accelerated video',async t=>{
  const page=await setup(t,{html:fixture({ad:false})});
  await page.locator('video').evaluate(video=>{video.id='main-video';});
  await loadContent(page);
  await page.keyboard.press('s');
  assert.equal((await state(page)).isActive,true);
  await page.evaluate(()=>{
    const root=document.createElement('div');root.className='html5-video-player ad-showing';
    root.innerHTML='<video style="width:100px;height:60px"></video><button class="ytp-ad-skip-button-modern">SKIP</button>';
    root.querySelector('button').onclick=()=>window.skipClicks++;
    document.body.append(root);
  });
  await page.waitForFunction(()=>window.skipClicks===1,null,{timeout:1500});
  assert.equal((await state(page)).isActive,true);
  assert.equal((await videoState(page,'#main-video')).rate,16);
});

test('waits until an aria-disabled ancestor permits interaction',async t=>{
  const page=await setup(t,{html:fixture({button:'<div id="disabled-group" aria-disabled="true"><button class="ytp-ad-skip-button-modern">SKIP</button></div>'})});
  await loadContent(page);
  assert.equal(await clicks(page),0);
  await page.locator('#disabled-group').evaluate(group=>group.setAttribute('aria-disabled','false'));
  await page.waitForFunction(()=>window.skipClicks===1,null,{timeout:1500});
});

test('reuses a detached skip control for the next ad without a player class change',async t=>{
  const page=await setup(t);
  await loadContent(page);
  assert.equal(await clicks(page),1);
  await page.evaluate(()=>{window.savedSkip=document.querySelector('.ytp-ad-skip-button-modern');window.savedSkip.remove();});
  await page.evaluate(()=>document.querySelector('#ad-controls').append(window.savedSkip));
  await page.waitForFunction(()=>window.skipClicks===2,null,{timeout:1500});
});

test('detects an ad boundary even when its class changes are batched',async t=>{
  const page=await setup(t);
  await loadContent(page);
  assert.equal(await clicks(page),1);
  await page.evaluate(()=>{const root=document.querySelector('.html5-video-player');root.classList.remove('ad-showing');root.classList.add('ad-showing');});
  await page.waitForFunction(()=>window.skipClicks===2,null,{timeout:1500});
});

test('clicks after a CSS transition makes the skip control visible',async t=>{
  const page=await setup(t,{html:fixture({button:'<button class="ytp-ad-skip-button-modern" style="opacity:0">SKIP</button>'})});
  await page.addStyleTag({content:'.ytp-ad-skip-button-modern { transition: opacity 150ms linear; }'});
  await loadContent(page);
  assert.equal(await clicks(page),0);
  await page.locator('.ytp-ad-skip-button-modern').evaluate(button=>{button.style.opacity='1';});
  await page.waitForFunction(()=>window.skipClicks===1,null,{timeout:1500});
});

test('click handler class changes do not cause repeated automatic clicks',async t=>{
  const page=await setup(t);
  await page.locator('.ytp-ad-skip-button-modern').evaluate(button=>{
    button.addEventListener('click',()=>{
      if(window.skipClicks>4)return;
      const root=button.closest('.html5-video-player');root.classList.remove('ad-showing');root.classList.add('ad-showing');
    });
  });
  await loadContent(page);
  await page.waitForTimeout(80);
  assert.equal(await clicks(page),1);
});

test('disabling the site also removes CSS transition availability listeners',async t=>{
  const page=await setup(t,{html:fixture({button:'<button class="ytp-ad-skip-button-modern" style="opacity:0">SKIP</button>'})});
  await page.addStyleTag({content:'.ytp-ad-skip-button-modern { transition: opacity 150ms linear; }'});
  await loadContent(page);
  await page.evaluate(()=>window.updateSettings({videoUrls:[]}));
  await page.locator('.ytp-ad-skip-button-modern').evaluate(button=>new Promise(resolve=>{
    void getComputedStyle(button).opacity;
    button.addEventListener('transitionend',resolve,{once:true});button.style.opacity='1';
  }));
  assert.equal(await clicks(page),0);
});
