const {test}=require('node:test');
const assert=require('node:assert/strict');
const {openPage,loadContent,state,videoState}=require('./helpers/browser.cjs');
const player=(ad=false)=>`<div class="html5-video-player${ad?' ad-showing':''}"><video style="width:640px;height:360px"></video><div class="ytp-right-controls"></div></div>`;
async function setup(t,{ad=false,hostname='www.youtube.com',storage={},muted=false,volume=.4}={}) {
  const page=await openPage(t,{html:player(ad),hostname,storage});
  await page.clock.install();
  await page.locator('video').evaluate((video,audio)=>{video.playbackRate=1.5;video.volume=audio.volume;video.muted=audio.muted;},{muted,volume});
  await loadContent(page);
  return page;
}
async function setAd(page,active) {
  await page.locator('.html5-video-player').first().evaluate((root,active)=>root.classList.toggle('ad-showing',active),active);
  await page.clock.runFor(50);
}

test('automatically accelerates and mutes the whole ad, then restores speed and audio',async t=>{
  const page=await setup(t);
  await setAd(page,true);
  assert.deepEqual(await videoState(page),{rate:16,volume:.4,muted:true});
  assert.equal((await state(page)).isActive,true);
  assert.equal(await page.locator('.geno-skip-button').getAttribute('aria-pressed'),'true');
  await page.clock.runFor(4500);
  assert.equal((await videoState(page)).rate,16);
  await setAd(page,false);
  assert.deepEqual(await videoState(page),{rate:1.5,volume:.4,muted:false});
  assert.equal((await state(page)).isActive,false);
});

test('accelerates an already running ad and restores it when the site is disabled',async t=>{
  const page=await setup(t,{ad:true});
  assert.equal((await videoState(page)).rate,16);
  await page.evaluate(()=>window.updateSettings({videoUrls:[]}));
  await page.clock.runFor(1500);
  assert.deepEqual(await videoState(page),{rate:1.5,volume:.4,muted:false});
  assert.equal((await state(page)).isActive,false);
});

test('restores the original speed before clicking skip and leaves the main video at that speed',async t=>{
  const page=await setup(t,{ad:true});
  assert.equal((await videoState(page)).rate,16);
  await page.evaluate(()=>{
    const root=document.querySelector('.html5-video-player'),button=document.createElement('button');
    button.className='ytp-skip-ad-button';button.textContent='スキップ';
    button.onclick=()=>{window.rateAtSkip=root.querySelector('video').playbackRate;root.classList.remove('ad-showing');};
    root.append(button);
  });
  await page.clock.runFor(1000);
  assert.equal(await page.evaluate(()=>window.rateAtSkip),1.5);
  assert.equal((await videoState(page)).rate,1.5);
  assert.equal((await state(page)).isActive,false);
});

test('restores the manual session before automatically accelerating an ad',async t=>{
  const page=await setup(t);
  await page.keyboard.press('s');
  assert.equal((await videoState(page)).muted,true);
  await setAd(page,true);
  assert.deepEqual(await videoState(page),{rate:16,volume:.4,muted:true});
  await page.clock.runFor(3500);
  assert.equal((await videoState(page)).rate,16);
  await setAd(page,false);
  assert.deepEqual(await videoState(page),{rate:1.5,volume:.4,muted:false});
});

test('a replaced ad video is restored before accelerating its replacement',async t=>{
  const page=await setup(t,{ad:true});
  await page.locator('video').evaluate(video=>{window.oldVideo=video;video.replaceWith(video.cloneNode());});
  await page.clock.runFor(100);
  assert.equal(await page.evaluate(()=>window.oldVideo.playbackRate),1.5);
  assert.equal((await videoState(page)).rate,16);
  await setAd(page,false);
  assert.equal((await videoState(page)).rate,1);
});

test('clicking Geno cancels automatic acceleration for the rest of the current ad',async t=>{
  const page=await setup(t,{ad:true});
  assert.equal((await videoState(page)).rate,16);
  await page.locator('.geno-skip-button').click();
  await page.clock.runFor(1500);
  assert.equal((await videoState(page)).rate,1.5);
  assert.equal((await state(page)).isActive,false);
  await setAd(page,false);await setAd(page,true);
  assert.equal((await videoState(page)).rate,16);
});

test('a new ad media load can reset the rate without losing the original restoration speed',async t=>{
  const page=await setup(t,{ad:true});
  assert.equal((await videoState(page)).rate,16);
  await page.locator('video').evaluate(video=>{video.playbackRate=1;video.muted=false;video.dispatchEvent(new Event('loadedmetadata'));});
  await page.clock.runFor(100);
  assert.deepEqual(await videoState(page),{rate:16,volume:.4,muted:true});
  await setAd(page,false);
  assert.equal((await videoState(page)).rate,1.5);
});

for(const audio of [{muted:false,volume:0},{muted:true,volume:.4},{muted:true,volume:0}]) {
  test(`automatic ad mute restores existing mute=${audio.muted} and volume=${audio.volume}`,async t=>{
    const page=await setup(t,{ad:true,...audio});
    assert.deepEqual(await videoState(page),{rate:16,volume:audio.volume,muted:true});
    await setAd(page,false);
    assert.deepEqual(await videoState(page),{rate:1.5,...audio});
  });
}

test('automatic acceleration remutes an ad even when the speed stays at 16x',async t=>{
  const page=await setup(t,{ad:true});
  await page.locator('video').evaluate(video=>{video.muted=false;video.dispatchEvent(new Event('loadedmetadata'));});
  await page.clock.runFor(50);
  assert.deepEqual(await videoState(page),{rate:16,volume:.4,muted:true});
  await setAd(page,false);
  assert.deepEqual(await videoState(page),{rate:1.5,volume:.4,muted:false});
});

test('an ad volumechange restores mute before the next polling interval',async t=>{
  const page=await setup(t,{ad:true});
  const result=await page.locator('video').evaluate(video=>{
    video.muted=false;
    video.dispatchEvent(new Event('volumechange'));
    return {rate:video.playbackRate,muted:video.muted};
  });
  assert.deepEqual(result,{rate:16,muted:true});
  await setAd(page,false);
  assert.deepEqual(await videoState(page),{rate:1.5,volume:.4,muted:false});
});

test('a refused skip keeps the ad muted during and after its click handler',async t=>{
  const page=await setup(t,{ad:true});
  await page.evaluate(()=>{
    const button=document.createElement('button');
    button.className='ytp-skip-ad-button';button.textContent='スキップ';
    button.onclick=()=>{const v=document.querySelector('video');window.audioAtSkip={rate:v.playbackRate,muted:v.muted};};
    document.querySelector('.html5-video-player').append(button);
  });
  await page.clock.runFor(50);
  assert.deepEqual(await page.evaluate(()=>window.audioAtSkip),{rate:1.5,muted:true});
  assert.deepEqual(await videoState(page),{rate:16,volume:.4,muted:true});
  await setAd(page,false);
  assert.deepEqual(await videoState(page),{rate:1.5,volume:.4,muted:false});
});

test('failed skip attempts do not exhaust the rate override budget',async t=>{
  const page=await setup(t,{ad:true});
  await page.evaluate(()=>{
    const button=document.createElement('button');button.className='ytp-skip-ad-button';button.textContent='スキップ';
    window.failedSkips=0;button.onclick=()=>{window.failedSkips++;};
    document.querySelector('.html5-video-player').append(button);
  });
  await page.clock.runFor(7000);
  assert.ok(await page.evaluate(()=>window.failedSkips>3));
  assert.deepEqual(await videoState(page),{rate:16,volume:.4,muted:true});
  await setAd(page,false);
  assert.deepEqual(await videoState(page),{rate:1.5,volume:.4,muted:false});
});

test('repeated mute resets stop acceleration instead of causing a volumechange loop',async t=>{
  const page=await setup(t,{ad:true});
  await page.locator('video').evaluate(video=>{
    for(let i=0;i<4;i++){video.muted=false;video.dispatchEvent(new Event('volumechange'));}
  });
  await page.clock.runFor(1500);
  assert.deepEqual(await videoState(page),{rate:1.5,volume:.4,muted:false});
  assert.equal((await state(page)).isActive,false);
  await setAd(page,false);await setAd(page,true);
  assert.deepEqual(await videoState(page),{rate:16,volume:.4,muted:true});
});

test('automatic ad acceleration on another player does not cancel the manual session',async t=>{
  const page=await setup(t);
  await page.locator('video').evaluate(video=>{video.id='main';});
  await page.keyboard.press('s');
  await page.evaluate(html=>{const container=document.createElement('section');container.innerHTML=html;container.querySelector('video').id='ad';document.body.append(container);},player(true));
  await page.clock.runFor(100);
  assert.equal((await videoState(page,'#main')).rate,16);
  assert.equal((await videoState(page,'#ad')).rate,16);
  await page.clock.runFor(3100);
  assert.equal((await videoState(page,'#main')).rate,1.5);
  assert.equal((await videoState(page,'#ad')).rate,16);
  await page.locator('.html5-video-player').last().evaluate(root=>root.classList.remove('ad-showing'));
  await page.clock.runFor(50);
  assert.equal((await videoState(page,'#ad')).rate,1);
});

test('pagehide restores automatic acceleration and cancels pending work',async t=>{
  const page=await setup(t,{ad:true});
  assert.equal((await videoState(page)).rate,16);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await page.clock.runFor(2000);
  assert.equal((await videoState(page)).rate,1.5);
  assert.equal((await state(page)).isActive,false);
});

test('does not automatically accelerate YouTube-looking ads on another registered site',async t=>{
  const page=await setup(t,{ad:true,hostname:'video.example',storage:{videoUrls:['video.example']}});
  assert.deepEqual(await videoState(page),{rate:1.5,volume:.4,muted:false});
});

test('does not repeatedly force a playback rate the player rejects',async t=>{
  const page=await setup(t);
  await page.locator('video').evaluate(video=>{
    window.rateAttempts=0;
    Object.defineProperty(video,'playbackRate',{get:()=>1.5,set:value=>{if(value===16){window.rateAttempts++;throw new Error('Unsupported rate');}}});
  });
  await setAd(page,true);
  await page.clock.runFor(3000);
  assert.equal(await page.evaluate(()=>window.rateAttempts),1);
  assert.equal((await state(page)).isActive,false);
  assert.deepEqual(await videoState(page),{rate:1.5,volume:.4,muted:false});
});

test('stops after three attempts when the site keeps resetting an accepted playback rate',async t=>{
  const page=await setup(t);
  await page.locator('video').evaluate(video=>{
    window.rateResets=0;
    video.addEventListener('ratechange',()=>{if(video.playbackRate===16){window.rateResets++;video.playbackRate=1;}});
  });
  await setAd(page,true);
  await page.clock.runFor(5000);
  assert.equal(await page.evaluate(()=>window.rateResets),3);
  assert.equal((await state(page)).isActive,false);
  assert.equal(await page.locator('.geno-skip-button').getAttribute('aria-pressed'),'false');
  assert.deepEqual(await videoState(page),{rate:1.5,volume:.4,muted:false});
});

test('the face can cancel automatic ownership immediately after the site resets the rate',async t=>{
  const page=await setup(t,{ad:true});
  await page.locator('video').evaluate(video=>{video.playbackRate=1;});
  await page.locator('.geno-skip-button').click();
  await page.clock.runFor(1500);
  assert.deepEqual(await videoState(page),{rate:1.5,volume:.4,muted:false});
  assert.equal((await state(page)).isActive,false);
  assert.equal(await page.locator('.geno-skip-button').getAttribute('aria-pressed'),'false');
});

test('restores an ad when its player is removed and resumes after returning from pagehide',async t=>{
  const page=await setup(t,{ad:true});
  await page.locator('video').evaluate(video=>{window.detachedVideo=video;});
  await page.locator('.html5-video-player').evaluate(root=>root.remove());
  await page.clock.runFor(100);
  assert.equal(await page.evaluate(()=>window.detachedVideo.playbackRate),1.5);
  assert.equal((await state(page)).isActive,false);
  await page.evaluate(html=>document.body.insertAdjacentHTML('beforeend',html),player(true));
  await page.clock.runFor(100);
  assert.equal((await videoState(page)).rate,16);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  assert.equal((await videoState(page)).rate,1);
  await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  assert.equal((await videoState(page)).rate,16);
  await setAd(page,false);
  assert.equal((await videoState(page)).rate,1);
});
