const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, loadContent, videoState } = require('./helpers/browser.cjs');

const html = `<style>
.html5-video-player {position:relative;width:640px;height:400px;background:#151515;}
video {position:absolute;left:20px;top:15px;width:calc(100% - 40px);height:calc(100% - 55px);background:#333;}
.ytp-right-controls {position:absolute;bottom:0;right:0;}
</style><div class="html5-video-player"><video></video><div class="ytp-right-controls"></div></div>`;

async function setup(t, { showSkipEffect = true, ...options } = {}) {
  const page = await openPage(t, { html, local: { debuggerSkip: false, showSkipEffect }, ...options });
  await loadContent(page);
  return page;
}
async function setAd(page, active) {
  await page.locator('.html5-video-player').evaluate((root, active) => root.classList.toggle('ad-showing', active), active);
}
async function centered(page) {
  return page.locator('.geno-skip-effect').evaluate(effect => {
    const e = effect.querySelector('.geno-skip-effect-face').getBoundingClientRect(), v = document.querySelector('video').getBoundingClientRect();
    return { x: Math.abs((e.left + e.right - v.left - v.right) / 2), y: Math.abs((e.top + e.bottom - v.top - v.bottom) / 2), faceSize: effect.querySelector('.geno-skip-effect-face').offsetWidth };
  });
}

test('the central effect stays off for ads and manual acceleration until enabled', async t => {
  const page = await setup(t, { local: { debuggerSkip: false } });
  await setAd(page, true);
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.geno-skip-effect').count(), 0);
  await setAd(page, false);
  await page.keyboard.press('s');
  assert.equal((await videoState(page)).rate, 16);
  assert.equal(await page.locator('.geno-skip-effect').count(), 0);
  await page.evaluate(() => window.updateLocalSettings({ showSkipEffect: true }));
  assert.equal(await page.locator('.geno-skip-effect').count(), 1);
});

test('enabled ad effect is large, rotating, embedded and centered on the video', async t => {
  const page = await setup(t);
  await page.locator('video').evaluate(video => { video.style.filter = 'brightness(0.8)'; });
  await setAd(page, true);
  await page.waitForFunction(() => document.querySelector('.geno-skip-effect-face')?.style.backgroundImage.startsWith('url("data:image/png;base64,'));
  const bounds = await centered(page);
  assert.ok(bounds.faceSize >= 430 && bounds.faceSize <= 432, JSON.stringify(bounds));
  assert.ok(bounds.x < 1 && bounds.y < 1, JSON.stringify(bounds));
  const effect = page.locator('.geno-skip-effect');
  assert.equal(await effect.getAttribute('aria-hidden'), 'true');
  assert.equal(await effect.evaluate(element => {
    const e = element.getBoundingClientRect(), v = document.querySelector('video').getBoundingClientRect();
    return Math.abs(e.width - v.width) < 1 && Math.abs(e.height - v.height) < 1 && getComputedStyle(element).overflow === 'hidden';
  }), true);
  assert.equal(await effect.locator('.geno-skip-effect-face').evaluate(face => getComputedStyle(face).animationName), 'geno-skip-spin');
  assert.equal(await effect.locator('.geno-skip-effect-face').evaluate(face => getComputedStyle(face).animationDuration), '1s');
  assert.equal(await page.locator('video').evaluate(video => getComputedStyle(video).filter), 'blur(10px)');
  assert.equal(await effect.locator('.geno-skip-effect-face').evaluate(face => getComputedStyle(face).filter), 'none');
  assert.equal(await effect.evaluate(element => {
    const r = element.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2).matches('video');
  }), true);
  await setAd(page, false);
  await page.waitForFunction(() => !document.querySelector('.geno-skip-effect'));
  assert.equal(await page.locator('video').evaluate(video => getComputedStyle(video).filter), 'brightness(0.8)');
});

test('keyboard and popup acceleration show the effect and remove it when stopped or timed out', async t => {
  const page = await setup(t);
  await page.clock.install();
  await page.keyboard.press('s');
  assert.equal(await page.locator('.geno-skip-effect').count(), 1);
  assert.equal((await videoState(page)).muted, true);
  assert.equal(await page.locator('video').evaluate(video => getComputedStyle(video).filter), 'blur(10px)');
  await page.keyboard.press('s');
  assert.equal(await page.locator('.geno-skip-effect').count(), 0);
  assert.equal(await page.locator('video').evaluate(video => getComputedStyle(video).filter), 'none');
  await page.evaluate(() => window.toggleMessage());
  assert.equal(await page.locator('.geno-skip-effect').count(), 1);
  await page.clock.runFor(3100);
  assert.equal(await page.locator('.geno-skip-effect').count(), 0);
  assert.equal(await page.locator('video').evaluate(video => getComputedStyle(video).filter), 'none');
  assert.deepEqual(await videoState(page), { rate: 1, volume: 1, muted: false });
});

test('keyboard, popup and ad effects always use the default face', async t => {
  const page = await setup(t);
  await page.keyboard.press('s');
  const face = page.locator('.geno-skip-effect-face');
  assert.equal(await face.evaluate(element => getComputedStyle(element).backgroundPosition), '50% 50%');
  await page.keyboard.press('s');
  await page.evaluate(() => window.toggleMessage());
  assert.equal(await face.evaluate(element => getComputedStyle(element).backgroundPosition), '50% 50%');
  await page.evaluate(() => window.toggleMessage());
  await setAd(page, true);
  assert.equal(await face.evaluate(element => getComputedStyle(element).backgroundPosition), '50% 50%');
});

test('manual effects preserve an absolute video inside a static wrapper', async t => {
  const page = await openPage(t, { hostname: 'www.nicovideo.jp', html: '<div style="position:relative;width:640px;height:360px"><div id="inner"><video style="position:absolute;inset:0;width:100%;height:100%"></video></div></div>', local: { debuggerSkip: false, showSkipEffect: true } });
  await loadContent(page);
  const before = await page.locator('video').boundingBox();
  await page.evaluate(() => window.toggleMessage());
  await page.waitForTimeout(100);
  assert.deepEqual(await videoState(page), { rate: 16, volume: 1, muted: true });
  assert.deepEqual(await page.locator('video').boundingBox(), before);
  assert.equal(await page.locator('.geno-skip-effect').count(), 1);
  const bounds = await centered(page);
  assert.ok(bounds.x < 1 && bounds.y < 1, JSON.stringify(bounds));
});

test('effect settings apply immediately and leave one overlay after repeated updates', async t => {
  const page = await setup(t);
  await setAd(page, true);
  await page.waitForSelector('.geno-skip-effect');
  await page.evaluate(() => window.updateLocalSettings({ showSkipEffect: false }));
  assert.equal(await page.locator('.geno-skip-effect').count(), 0);
  assert.equal((await videoState(page)).rate, 16);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) window.updateLocalSettings({ showSkipEffect: true });
  });
  assert.equal(await page.locator('.geno-skip-effect').count(), 1);
  await page.evaluate(() => window.updateSettings({ videoUrls: [] }));
  assert.equal(await page.locator('.geno-skip-effect').count(), 0);
});

test('effect follows resizing and scaled players', async t => {
  const page = await setup(t);
  await setAd(page, true);
  await page.waitForSelector('.geno-skip-effect');
  await page.locator('.html5-video-player').evaluate(root => { root.style.width = '400px'; root.style.height = '250px'; root.style.transform = 'scale(1.25)'; root.style.transformOrigin = 'top left'; });
  await page.waitForFunction(() => {
    const e = document.querySelector('.geno-skip-effect').getBoundingClientRect(), v = document.querySelector('video').getBoundingClientRect();
    return Math.abs(e.x + e.width / 2 - v.x - v.width / 2) < 1 && Math.abs(e.y + e.height / 2 - v.y - v.height / 2) < 1;
  });
  const bounds = await centered(page);
  assert.ok(bounds.x < 1 && bounds.y < 1);
});

test('effect stays inside the fullscreen player and follows the video center', async t => {
  const page = await setup(t);
  await setAd(page, true);
  await page.waitForSelector('.geno-skip-effect');
  await page.locator('.html5-video-player').evaluate(root => {
    const button = document.createElement('button');
    button.id = 'fullscreen'; button.textContent = 'Fullscreen';
    button.onclick = () => root.requestFullscreen();
    root.append(button);
  });
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => document.fullscreenElement && document.querySelector(':fullscreen .geno-skip-effect'));
  await page.waitForFunction(() => {
    const e = document.querySelector('.geno-skip-effect').getBoundingClientRect(), v = document.querySelector('video').getBoundingClientRect();
    return Math.abs(e.x + e.width / 2 - v.x - v.width / 2) < 1 && Math.abs(e.y + e.height / 2 - v.y - v.height / 2) < 1;
  });
  assert.equal(await page.locator(':fullscreen .geno-skip-effect').count(), 1);
});

test('pagehide and SPA navigation remove the effect and reduced motion stops its animation', async t => {
  const page = await setup(t);
  await setAd(page, true);
  await page.waitForSelector('.geno-skip-effect');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.geno-skip-effect-face').evaluate(face => getComputedStyle(face).animationName), 'none');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.locator('.geno-skip-effect').count(), 0);
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await page.waitForSelector('.geno-skip-effect');
  await setAd(page, false);
  await page.evaluate(() => document.dispatchEvent(new Event('yt-navigate-finish')));
  assert.equal(await page.locator('.geno-skip-effect').count(), 0);
});
