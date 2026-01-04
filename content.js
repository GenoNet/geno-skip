let isActive = false;
let accelerationKey = 'S';
let skipKey = 'D';
let videoUrls = ['youtube.com', 'nicovideo.jp'];
let skipButtonSelectors = ['.ytp-skip-ad-button', '.skip-button'];

// 設定を読み込む
chrome.storage.sync.get(['accelerationKey', 'skipKey', 'videoUrls', 'skipButtonSelectors'], function(result) {
    if (result.accelerationKey) {
        accelerationKey = result.accelerationKey.toUpperCase();
    }
    if (result.skipKey) {
        skipKey = result.skipKey.toUpperCase();
    }
    if (result.videoUrls && result.videoUrls.length > 0) {
        videoUrls = result.videoUrls;
    }
    if (result.skipButtonSelectors && result.skipButtonSelectors.length > 0) {
        skipButtonSelectors = result.skipButtonSelectors;
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

    // スキップキー処理
    if (event.key.toUpperCase() === skipKey) {
        event.preventDefault();
        skipAd();
    }
});

function toggleAdAcceleration() {
    isActive = !isActive;
    
    if (isActive) {
        accelerateVideos();
    } else {
        normalizeVideos();
    }
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

function skipAd() {
    // 設定されたセレクタから最初にマッチするボタンを検索
    let skipButton = null;
    for (let selector of skipButtonSelectors) {
        skipButton = document.querySelector(selector);
        if (skipButton) {
            console.log('スキップボタン検出:', selector, skipButton);
            break;
        }
    }
    
    if (skipButton) {
        // マウスイベントをシミュレート
        const mouseDownEvent = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window
        });
        const mouseUpEvent = new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            view: window
        });
        const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        });
        
        skipButton.dispatchEvent(mouseDownEvent);
        skipButton.dispatchEvent(mouseUpEvent);
        skipButton.dispatchEvent(clickEvent);
        
        // スキップボタンをクリックしたら即座に加速を解除
        if (isActive) {
            normalizeVideos();
            isActive = false;
        }
    } else {
        console.log('スキップボタンが見つかりません');
    }
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