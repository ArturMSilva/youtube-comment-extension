function extractVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
}

function isVideoPage() {
    return window.location.pathname === '/watch' && window.location.search.includes('v=');
}

function sendPageInfo() {
    if (isVideoPage()) {
        const videoId = extractVideoId();
        
        if (videoId) {
            chrome.runtime.sendMessage({
                type: 'VIDEO_ID_FOUND',
                videoId: videoId,
                url: window.location.href
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('Erro ao enviar mensagem:', chrome.runtime.lastError);
                } else {
                    console.log('ID do vídeo enviado:', videoId);
                }
            });
        }
    } else {
        chrome.runtime.sendMessage({
            type: 'NOT_A_VIDEO',
            url: window.location.href
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Erro ao enviar mensagem:', chrome.runtime.lastError);
            } else {
                console.log('Não é uma página de vídeo');
            }
        });
    }
}

// Executa quando o script é carregado
sendPageInfo();

let lastUrl = window.location.href;

const observer = new MutationObserver(() => {
    if (lastUrl !== window.location.href) {
        lastUrl = window.location.href;
        console.log('URL mudou:', lastUrl);
        sendPageInfo();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_VIDEO_ID' || message.type === 'REQUEST_VIDEO_ID') {
        const videoId = extractVideoId();
        sendResponse({
            success: true,
            isVideoPage: isVideoPage(),
            videoId: videoId
        });
    }
    return true;
});

console.log('Content script do YouTube Comment Q&A carregado');
