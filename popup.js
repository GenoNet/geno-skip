document.addEventListener('DOMContentLoaded', function() {
    const keyInput = document.getElementById('accelerationKey');
    const skipKeyInput = document.getElementById('skipKey');
    const urlTextarea = document.getElementById('videoUrl');
    const selectorsTextarea = document.getElementById('skipButtonSelectors');
    const saveButton = document.getElementById('saveButton');
    const saveMessage = document.getElementById('saveMessage');
    const genoIcon = document.getElementById('genoIcon');

    // ジーノくんアイコンをクリック
    genoIcon.addEventListener('click', function() {
        chrome.tabs.create({
            url: 'https://youtu.be/4-UbHw8eDzM?si=t8Kg0D0C2ZGCjKXW&t=0s'
        });
    });

    // 設定を読み込む
    chrome.storage.sync.get(['accelerationKey', 'skipKey', 'videoUrls', 'skipButtonSelectors'], function(result) {
        if (result.accelerationKey) {
            keyInput.value = result.accelerationKey;
        } else {
            keyInput.value = 'S';
        }

        if (result.skipKey) {
            skipKeyInput.value = result.skipKey;
        } else {
            skipKeyInput.value = 'D';
        }

        if (result.videoUrls && result.videoUrls.length > 0) {
            urlTextarea.value = result.videoUrls.join('\n');
        } else {
            urlTextarea.value = 'youtube.com\nnicovideo.jp';
        }

        if (result.skipButtonSelectors && result.skipButtonSelectors.length > 0) {
            selectorsTextarea.value = result.skipButtonSelectors.join('\n');
        } else {
            selectorsTextarea.value = '.ytp-skip-ad-button\n.skip-button';
        }
    });

    // 保存ボタン
    saveButton.addEventListener('click', function() {
        const key = keyInput.value.toUpperCase() || 'S';
        const skipKey = skipKeyInput.value.toUpperCase() || 'D';
        const urls = urlTextarea.value
            .split('\n')
            .map(url => url.trim())
            .filter(url => url.length > 0);
        const selectors = selectorsTextarea.value
            .split('\n')
            .map(selector => selector.trim())
            .filter(selector => selector.length > 0);

        chrome.storage.sync.set({
            accelerationKey: key,
            skipKey: skipKey,
            videoUrls: urls,
            skipButtonSelectors: selectors
        }, function() {
            saveMessage.style.display = 'block';
            setTimeout(() => {
                saveMessage.style.display = 'none';
            }, 2000);
        });
    });
});