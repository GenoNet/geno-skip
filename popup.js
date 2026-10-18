(() => {
  'use strict';
  function initialize() {
    const api = globalThis.GenoSkipSettings;
    const keyInput = document.getElementById('accelerationKey');
    const urlTextarea = document.getElementById('videoUrl');
    const goButton = document.getElementById('goButton');
    const status = document.getElementById('statusMessage');
    let currentTabId = null;

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
          showStatus('操作する動画タブを開いてください。', true);
          return;
        }
        currentTabId = tabs[0].id;
        chrome.tabs.sendMessage(currentTabId, { type }, response => {
          if (chrome.runtime.lastError || !response || typeof response.isActive !== 'boolean') {
            updateGoLabel(false);
            showStatus('動画ページを開いてください。拡張を更新した後はタブを再読み込みしてください。', true);
            return;
          }
          updateGoLabel(response.isActive);
          showStatus(response.reason || '', !!response.reason);
        });
      });
    }

    chrome.storage.sync.get(['accelerationKey', 'videoUrls'], result => {
      if (chrome.runtime.lastError) { showStatus('設定を読み込めません。もう一度開いてください。', true); return; }
      const settings = api.fromStorage(result);
      keyInput.value = settings.accelerationKey;
      urlTextarea.value = Array.isArray(result.videoUrls) ? result.videoUrls.filter(value => typeof value === 'string').join('\n') : settings.videoUrls.join('\n');
    });
    document.getElementById('saveButton').addEventListener('click', () => {
      const accelerationKey = api.normalizeKey(keyInput.value);
      if (!accelerationKey) { showStatus('高速化キーは空白以外の1文字を入力してください。', true); keyInput.focus(); return; }
      const parsed = api.parseSites(urlTextarea.value);
      if (parsed.invalidLines.length) { showStatus(`サイトの${parsed.invalidLines.join('・')}行目を確認してください。ホスト名またはHTTP(S) URLを入力してください。`, true); urlTextarea.focus(); return; }
      chrome.storage.sync.set({ accelerationKey, videoUrls: parsed.sites }, () => {
        if (chrome.runtime.lastError) { showStatus('設定を保存できません。時間をおいて再度お試しください。', true); return; }
        keyInput.value = accelerationKey;
        urlTextarea.value = parsed.sites.join('\n');
        showStatus('保存しました。開いているタブにも反映されます。');
      });
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
