(() => {
  'use strict';
  function initialize() {
    const api = globalThis.GenoSkipSettings;
    const keyInput = document.getElementById('accelerationKey');
    const urlTextarea = document.getElementById('videoUrl');
    const goButton = document.getElementById('goButton');
    const status = document.getElementById('statusMessage');
    const debuggerInput = document.getElementById('debuggerSkip');
    const debuggerStatus = document.getElementById('debuggerStatus');
    const saveButton = document.getElementById('saveButton');
    let currentTabId = null;
    saveButton.disabled = true;

    function showStatus(text = '', error = false) {
      status.textContent = text;
      status.dataset.error = String(error);
    }
    function updateGoLabel(active) {
      goButton.textContent = active ? 'Stop!' : 'Go!';
      goButton.setAttribute('aria-pressed', String(active));
      document.getElementById('genoIcon').classList.toggle('is-active', active);
    }
    function requestState(type) {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (chrome.runtime.lastError || !tabs?.[0]?.id) {
          showStatus('まずは動画を開いてくれ！加速する相手がいない！', true);
          return;
        }
        currentTabId = tabs[0].id;
        chrome.tabs.sendMessage(currentTabId, { type }, response => {
          if (chrome.runtime.lastError || !response || typeof response.isActive !== 'boolean') {
            updateGoLabel(false);
            showStatus('動画ページを開いてくれ！拡張を更新したらタブも再読み込み！', true);
            return;
          }
          updateGoLabel(response.isActive);
          showStatus(response.reason || '', !!response.reason);
        });
      });
    }

    chrome.storage.sync.get(['accelerationKey', 'videoUrls'], result => {
      if (chrome.runtime.lastError) { showStatus('設定が読めなかった！いったん閉じて、もう一回開いてくれ！', true); return; }
      const settings = api.fromStorage(result);
      keyInput.value = settings.accelerationKey;
      urlTextarea.value = Array.isArray(result.videoUrls) ? result.videoUrls.filter(value => typeof value === 'string').join('\n') : settings.videoUrls.join('\n');
      chrome.storage.local.get(['debuggerSkip', 'debuggerSkipError'], local => {
        if (chrome.runtime.lastError) { showStatus('SKIPの設定が読めなかった！もう一回開いてくれ！', true); return; }
        debuggerInput.checked = local.debuggerSkip === true;
        debuggerStatus.textContent = local.debuggerSkipError || '';
        saveButton.disabled = false;
      });
    });
    saveButton.addEventListener('click', () => {
      const accelerationKey = api.normalizeKey(keyInput.value);
      if (!accelerationKey) { showStatus('加速キーは1文字で頼む！空白はナシ！', true); keyInput.focus(); return; }
      const parsed = api.parseSites(urlTextarea.value);
      if (parsed.invalidLines.length) { showStatus(`サイトの${parsed.invalidLines.join('・')}行目がおかしいぞ！「youtube.com」みたいなサイト名か、http://・https://で始まるURLで頼む！`, true); urlTextarea.focus(); return; }
      const debuggerSkip = debuggerInput.checked;
      saveButton.disabled = true;
      chrome.storage.sync.set({ accelerationKey, videoUrls: parsed.sites }, () => {
        if (chrome.runtime.lastError) { saveButton.disabled = false; showStatus('設定を保存できませんでした！ちょっと待って、もう一回頼む！', true); return; }
        chrome.storage.local.set({ debuggerSkip, debuggerSkipError: '' }, () => {
          saveButton.disabled = false;
          if (chrome.runtime.lastError) { showStatus('SKIPの設定を保存できませんでした！もう一回頼む！', true); return; }
          keyInput.value = accelerationKey;
          urlTextarea.value = parsed.sites.join('\n');
          debuggerStatus.textContent = '';
          showStatus('保存した！開いてるタブにも即反映！');
        });
      });
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.debuggerSkip) debuggerInput.checked = changes.debuggerSkip.newValue === true;
      if (changes.debuggerSkipError) debuggerStatus.textContent = changes.debuggerSkipError.newValue || '';
    });
    goButton.addEventListener('click', () => requestState('TOGGLE_ACCELERATION'));
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (sender.tab?.id === currentTabId && message?.type === 'ACCEL_STATE' && typeof message.isActive === 'boolean') {
        updateGoLabel(message.isActive);
        showStatus(message.reason || '', !!message.reason);
      }
    });
    requestState('REQUEST_STATE');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
