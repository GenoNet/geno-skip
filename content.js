let isActive = false;
let accelerationKey = 'S';
let videoUrls = ['youtube.com', 'nicovideo.jp'];
let autoRevertTimer = null;

function broadcastAccelerationState() {
    try {
        chrome.runtime.sendMessage({ type: 'ACCEL_STATE', isActive });
    } catch (e) {
        // ignore
    }
}

// 設定を読み込む
chrome.storage.sync.get(['accelerationKey', 'videoUrls'], function(result) {
    if (result.accelerationKey) {
        accelerationKey = result.accelerationKey.toUpperCase();
    }
    if (result.videoUrls && result.videoUrls.length > 0) {
        videoUrls = result.videoUrls;
    }
});

// 動画サイトかどうか確認
function isVideoSite() {
    const currentUrl = window.location.hostname;
    return videoUrls.some(pattern => currentUrl.includes(pattern));
}

document.addEventListener('keydown', function(event) {
    // 対応するサイトでない場合は何もしない
    if (!isVideoSite()) {
        return;
    }

    const activeElement = document.activeElement;
    const isInputField = activeElement.tagName === 'INPUT' || 
                        activeElement.tagName === 'TEXTAREA' || 
                        activeElement.contentEditable === 'true';
    
    if (isInputField) {
        return;
    }

    // 加速キー処理
    if (event.key.toUpperCase() === accelerationKey) {
        event.preventDefault();
        toggleAdAcceleration();
    }
});

function toggleAdAcceleration() {
    isActive = !isActive;
    
    if (isActive) {
        accelerateVideos();
        // 3秒後に自動で元速へ戻す
        if (autoRevertTimer) {
            clearTimeout(autoRevertTimer);
        }
        autoRevertTimer = setTimeout(() => {
            normalizeVideos();
            isActive = false;
            autoRevertTimer = null;
            broadcastAccelerationState();
        }, 3000);
    } else {
        normalizeVideos();
        if (autoRevertTimer) {
            clearTimeout(autoRevertTimer);
            autoRevertTimer = null;
        }
    }
    broadcastAccelerationState();
}

function accelerateVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(function(video) {
        // 元の音量を保存
        if (!video.dataset.originalVolume) {
            video.dataset.originalVolume = video.volume;
        }
        video.playbackRate = 16;
        video.volume = 0;
        video.muted = true;
        video.dataset.accelerated = 'true';
    });
}

function normalizeVideos() {
    const videos = document.querySelectorAll('video[data-accelerated="true"]');
    videos.forEach(function(video) {
        video.playbackRate = 1;
        // 保存した元の音量を復元
        const originalVolume = parseFloat(video.dataset.originalVolume) || 1;
        video.volume = originalVolume;
        video.muted = false;
        video.dataset.accelerated = 'false';
    });
}

const observer = new MutationObserver(function(mutations) {
    if (isActive) {
        accelerateVideos();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// マウスクリック検出時に加速を解除
document.addEventListener('click', function() {
    if (isActive) {
        normalizeVideos();
        isActive = false;
    }
});

// ポップアップからのメッセージで加速をトグル
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'TOGGLE_ACCELERATION') {
        toggleAdAcceleration();
        sendResponse({ isActive });
    } else if (message && message.type === 'REQUEST_STATE') {
        sendResponse({ isActive });
    }
});