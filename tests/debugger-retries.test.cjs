const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openPage, root } = require('./helpers/browser.cjs');

test('late no-input replies return reserved clicks to the current button record', async t => {
  const page = await openPage(t, { html: '<div class="html5-video-player ad-showing"><video style="width:640px;height:360px"></video><button class="ytp-skip-ad-button">SKIP</button></div>' });
  await page.clock.install();
  await page.addScriptTag({ path: path.join(root, 'ad-skip.js') });
  await page.evaluate(() => {
    window.requests = [];
    window.replies = [];
    window.watcher = GenoAdSkip.watch(document.querySelector('.html5-video-player'), {
      getVideo: () => document.querySelector('video'),
      useDebugger: () => true,
      requestSkip: token => {
        window.requests.push(token);
        return new Promise(resolve => window.replies.push(resolve));
      }
    });
    watcher.check();
  });
  await page.waitForFunction(() => window.requests.length === 1);
  await page.evaluate(() => {
    watcher.prepareSkip(window.requests[0]);
    const video = document.querySelector('video');
    video.replaceWith(video.cloneNode());
    watcher.check();
  });
  await page.clock.runFor(2100);
  await page.waitForFunction(() => window.requests.length === 2);
  await page.evaluate(() => { window.replies[0]({ sent: false }); window.replies[1]({ sent: false }); });
  await page.waitForFunction(() => !document.querySelector('[data-geno-debugger-skip]'));
  await page.clock.runFor(2100);
  await page.waitForFunction(() => window.requests.length === 3);
  await page.evaluate(() => window.replies[2]({ sent: true }));
  await page.waitForFunction(() => !document.querySelector('[data-geno-debugger-skip]'));
  await page.clock.runFor(2100);
  assert.equal(await page.evaluate(() => window.requests.length), 4);
  await page.evaluate(() => window.replies[3]({ sent: true }));
  await page.waitForFunction(() => !document.querySelector('[data-geno-debugger-skip]'));
  await page.clock.runFor(5000);
  assert.equal(await page.evaluate(() => window.requests.length), 4);
  await page.evaluate(() => watcher.destroy());
});

test('a late reply cannot replace the status of newer browser input', async t => {
  const page = await openPage(t, { html: '<div class="html5-video-player ad-showing"><video style="width:640px;height:360px"></video><button class="ytp-skip-ad-button">SKIP</button></div>' });
  await page.clock.install();
  await page.addScriptTag({ path: path.join(root, 'ad-skip.js') });
  await page.evaluate(() => {
    window.requests = [];
    window.replies = [];
    window.watcher = GenoAdSkip.watch(document.querySelector('.html5-video-player'), {
      getVideo: () => document.querySelector('video'), useDebugger: () => true,
      requestSkip: token => { window.requests.push(token); return new Promise(resolve => window.replies.push(resolve)); }
    });
    watcher.check();
  });
  await page.waitForFunction(() => window.requests.length === 1);
  await page.evaluate(() => {
    watcher.prepareSkip(window.requests[0]);
    const video = document.querySelector('video'); video.replaceWith(video.cloneNode()); watcher.check();
  });
  await page.clock.runFor(2100);
  await page.waitForFunction(() => window.requests.length === 2);
  await page.evaluate(() => window.replies[1]({ sent: true, status: 'input-sent' }));
  await page.waitForFunction(() => !document.querySelector('[data-geno-debugger-skip]'));
  await page.evaluate(() => window.replies[0]({ sent: false, status: 'preparation-refused' }));
  assert.match(await page.evaluate(() => watcher.getStatus()), /送信済み/);
  await page.evaluate(() => watcher.destroy());
});
