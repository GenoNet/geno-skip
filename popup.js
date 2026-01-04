document.addEventListener('DOMContentLoaded', function() {
    const keyInput = document.getElementById('accelerationKey');
    const urlTextarea = document.getElementById('videoUrl');
    const saveButton = document.getElementById('saveButton');
    const saveMessage = document.getElementById('saveMessage');
    const genoIcon = document.getElementById('genoIcon');
    const goButton = document.getElementById('goButton');

    // ジーノくんアイコンをクリック
    genoIcon.addEventListener('click', function() {
        chrome.tabs.create({
            url: 'https://youtu.be/4-UbHw8eDzM?si=t8Kg0D0C2ZGCjKXW&t=0s'
        });
    });

    // 設定を読み込む
    chrome.storage.sync.get(['accelerationKey', 'videoUrls'], function(result) {
        if (result.accelerationKey) {
            keyInput.value = result.accelerationKey;
        } else {
            keyInput.value = 'S';
        }

        if (result.videoUrls && result.videoUrls.length > 0) {
            urlTextarea.value = result.videoUrls.join('\n');
        } else {
            urlTextarea.value = 'youtube.com\nnicovideo.jp';
        }
    });

    // 保存ボタン
    saveButton.addEventListener('click', function() {
        const key = keyInput.value.toUpperCase() || 'S';
        const urls = urlTextarea.value
            .split('\n')
            .map(url => url.trim())
            .filter(url => url.length > 0);

        chrome.storage.sync.set({
            accelerationKey: key,
            videoUrls: urls
        }, function() {
            saveMessage.style.display = 'block';
            setTimeout(() => {
                saveMessage.style.display = 'none';
            }, 2000);
        });
    });

    // Go/Stop ボタンで加速トグル
    function updateGoLabel(active) {
        goButton.textContent = active ? 'Stop!' : 'Go!';
        goButton.style.background = active ? '#e53935' : '#4CAF50';
    }

    goButton.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || !tabs.length) return;
            chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_ACCELERATION' }, (response) => {
                if (response && typeof response.isActive === 'boolean') {
                    updateGoLabel(response.isActive);
                }
            });
        });
    });

    // コンテンツ側からの状態通知を反映
    chrome.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'ACCEL_STATE' && typeof message.isActive === 'boolean') {
            updateGoLabel(message.isActive);
        }
    });

    // ポップアップ表示時に現在状態を問い合わせ
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs.length) return;
        chrome.tabs.sendMessage(tabs[0].id, { type: 'REQUEST_STATE' }, (response) => {
            if (response && typeof response.isActive === 'boolean') {
                updateGoLabel(response.isActive);
            }
        });
    });
});