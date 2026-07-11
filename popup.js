// Ícones dos estados da mensagem de status (conteúdo estático — seguro via innerHTML)
const STATUS_ICONS = {
  loading: '<svg class="status-icon spin" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 3a9 9 0 1 0 9 9" stroke="#2BE07C" stroke-width="2.4" stroke-linecap="round"/></svg>',
  success: '<svg class="status-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#2BE07C" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  error: '<svg class="status-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#EF4444" stroke-width="2"/><path d="M12 8v5M12 16.5v.01" stroke="#EF4444" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

const START_ICON_INITIAL = '<svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const START_ICON_AGAIN = '<svg class="btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderSourceComments(comentarios) {
  const container = document.getElementById('source-comments');
  const list = document.getElementById('source-list');

  if (!container || !list) return;

  if (!comentarios || comentarios.length === 0) {
    container.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  list.innerHTML = '';
  comentarios.forEach(c => {
    const card = document.createElement('div');
    card.className = 'comment-source';

    const textDiv = document.createElement('div');
    textDiv.textContent = c.text || '';

    const likesDiv = document.createElement('div');
    likesDiv.className = 'comment-source-likes';
    likesDiv.textContent = `♥ ${c.likeCount || 0} curtidas`;

    card.appendChild(textDiv);
    card.appendChild(likesDiv);
    list.appendChild(card);
  });

  container.classList.remove('hidden');
}

let collectedComments = [];
let currentVideoId = null;

if (typeof chrome === 'undefined' || !chrome.runtime) {
    console.error('Chrome extensions API não está disponível');
}

window.addEventListener('unhandledrejection', (event) => {
    console.error('Promise rejeitada não tratada no popup:', event.reason);
    event.preventDefault();
});

document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('start-analysis');
    const statusMessage = document.getElementById('status-message');
    const qaInterface = document.getElementById('qa-interface');
    const questionInput = document.getElementById('question-input');
    const askButton = document.getElementById('ask-llm');
    const llmResponse = document.getElementById('llm-response');

    // Atualiza a mensagem de status aplicando o estilo do estado (neutral | loading | success | error)
    function updateStatus(message, state = 'neutral') {
        statusMessage.className = 'status-message' + (state !== 'neutral' ? ' ' + state : '');
        statusMessage.innerHTML = STATUS_ICONS[state] || '';
        const span = document.createElement('span');
        span.textContent = message;
        statusMessage.appendChild(span);
    }

    // Alterna o botão principal entre "Analisar comentários" (verde cheio) e "Analisar novamente" (outline)
    function setStartMode(mode) {
        if (mode === 'again') {
            startButton.classList.add('again');
            startButton.innerHTML = START_ICON_AGAIN + 'Analisar novamente';
        } else {
            startButton.classList.remove('again');
            startButton.innerHTML = START_ICON_INITIAL + 'Analisar comentários';
        }
    }

    async function getVideoId() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.url) {
                updateStatus('Erro: Não foi possível acessar a aba atual', 'error');
                return null;
            }

            if (!tab.url.includes('youtube.com')) {
                updateStatus('Por favor, abra um vídeo do YouTube');
                return null;
            }

            const response = await chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_VIDEO_ID' }).catch(error => {
                console.error('Erro ao enviar mensagem para content script:', error);
                return null;
            });

            if (response && response.success) {
                if (response.isVideoPage && response.videoId) {
                    return response.videoId;
                } else {
                    updateStatus('Navegue até um vídeo do YouTube');
                    return null;
                }
            } else {
                updateStatus('Erro ao comunicar com a página', 'error');
                return null;
            }
        } catch (error) {
            console.error('Erro ao obter ID do vídeo:', error);
            updateStatus('Erro: recarregue a página do YouTube', 'error');
            return null;
        }
    }

    async function handleStartAnalysis() {
        updateStatus('Buscando ID do vídeo…', 'loading');
        startButton.disabled = true;

        const videoId = await getVideoId();

        if (videoId) {
            currentVideoId = videoId;
            updateStatus('Iniciando coleta de comentários…', 'loading');
            console.log('Iniciando análise para o vídeo:', videoId);

            chrome.runtime.sendMessage({
                type: 'START_COMMENT_COLLECTION',
                videoId: videoId
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('Erro ao comunicar com Service Worker:', chrome.runtime.lastError);
                    updateStatus('Erro ao iniciar coleta', 'error');
                    startButton.disabled = false;
                } else if (response) {
                    console.log('Service Worker respondeu:', response);
                }
            });
        } else {
            startButton.disabled = false;
        }
    }

    function showQAInterface() {
        qaInterface.classList.remove('hidden');
    }

    function hideQAInterface() {
        qaInterface.classList.add('hidden');
        questionInput.value = '';
        llmResponse.textContent = '';
        llmResponse.classList.remove('loading');
        renderSourceComments([]); // limpa os cards de fonte
        setStartMode('initial');
    }

    async function handleAskLLM() {
        const question = questionInput.value.trim();

        if (!question) {
            llmResponse.textContent = 'Por favor, digite uma pergunta.';
            llmResponse.classList.remove('loading');
            return;
        }

        if (collectedComments.length === 0) {
            llmResponse.textContent = 'Nenhum comentário coletado. Analise um vídeo primeiro.';
            llmResponse.classList.remove('loading');
            return;
        }

        // Atualizar UI
        askButton.disabled = true;
        llmResponse.textContent = 'Analisando os comentários…';
        llmResponse.classList.add('loading');
        renderSourceComments([]); // limpa fontes da pergunta anterior

        console.log('Enviando pergunta para o modelo:', question);

        chrome.runtime.sendMessage({
            type: 'ASK_LLM',
            question: question,
            comments: collectedComments,
            videoId: currentVideoId
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Erro ao comunicar com Service Worker:', chrome.runtime.lastError);
                llmResponse.textContent = 'Erro ao comunicar com o Service Worker';
                llmResponse.classList.remove('loading');
                askButton.disabled = false;
            } else if (response) {
                console.log('Service Worker respondeu:', response);
            }
        });
    }

    startButton.addEventListener('click', handleStartAnalysis);
    askButton.addEventListener('click', handleAskLLM);
    questionInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleAskLLM();
      }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('Mensagem recebida no popup:', message);

        try {
            switch (message.type) {
                case 'VIDEO_ID_FOUND':
                    console.log('Video ID encontrado:', message.videoId);
                    currentVideoId = message.videoId;
                    updateStatus('Vídeo detectado. Pronto para analisar.');
                    break;

            case 'NOT_A_VIDEO_STATUS':
                updateStatus('Erro: não é uma página de vídeo do YouTube.', 'error');
                startButton.disabled = false;
                break;

            case 'COLLECTING_STATUS':
                const { currentPage, totalCollected } = message;
                updateStatus(`Coletando página ${currentPage}… (${totalCollected} comentários)`, 'loading');
                break;

            case 'COMMENTS_COLLECTED':
                const { comments, totalComments, pagesCollected, limitReached } = message;
                collectedComments = comments;

                let statusText = `Coleta concluída · ${totalComments} comentários`;
                if (limitReached) {
                    statusText += ' (limite atingido)';
                }

                updateStatus(statusText, 'success');
                console.log('Comentários coletados:', collectedComments);

                if (chrome.storage && chrome.storage.local) {
                    chrome.storage.local.set({
                        videoId: message.videoId,
                        comments: comments,
                        totalComments: totalComments,
                        pagesCollected: pagesCollected,
                        collectedAt: new Date().toISOString()
                    }, () => {
                        if (chrome.runtime.lastError) {
                            console.error('Erro ao salvar no storage:', chrome.runtime.lastError);
                        } else {
                            console.log('Comentários salvos no storage');
                        }
                    });
                }

                showQAInterface();
                setStartMode('again');

                startButton.disabled = false;
                break;

            case 'COMMENTS_ERROR':
                updateStatus(`Erro: ${message.error}`, 'error');
                console.error('Erro na coleta:', message.error);
                startButton.disabled = false;
                hideQAInterface();
                break;

            case 'LLM_RESPONSE':
                llmResponse.textContent = message.resposta;
                llmResponse.classList.remove('loading');
                askButton.disabled = false;
                renderSourceComments(message.comentarios_fonte);
                console.log('Resposta do LLM recebida:', message.resposta);
                break;

            case 'LLM_ERROR':
                llmResponse.textContent = `Erro: ${message.error}`;
                llmResponse.classList.remove('loading');
                askButton.disabled = false;
                console.error('Erro do LLM:', message.error);
                break;

            default:
                console.log('Tipo de mensagem desconhecido:', message.type);
        }

        sendResponse({ received: true });
        return true;
        } catch (error) {
            console.error('Erro ao processar mensagem:', error);
            sendResponse({ error: error.message });
            return true;
        }
    });

    getVideoId().then(videoId => {
        if (videoId) {
            currentVideoId = videoId;

            if (chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['videoId', 'comments', 'totalComments', 'collectedAt'], (data) => {
                    if (chrome.runtime.lastError) {
                        console.error('Erro ao acessar storage:', chrome.runtime.lastError);
                        updateStatus('Pronto para analisar');
                        return;
                    }

                    if (data.videoId === videoId && data.totalComments) {
                        const collectedDate = new Date(data.collectedAt);
                        const timeAgo = Math.floor((Date.now() - collectedDate.getTime()) / 1000 / 60);
                        updateStatus(`Pronto · ${data.totalComments} comentários salvos há ${timeAgo}min`, 'success');

                        if (data.comments) {
                            collectedComments = data.comments;
                            showQAInterface();
                            setStartMode('again');
                            console.log('Comentários restaurados do storage');
                        }
                    } else {
                        updateStatus('Pronto para analisar');
                    }
                });
            } else {
                updateStatus('Pronto para analisar');
            }
        }
    }).catch(error => {
        console.error('Erro ao verificar vídeo:', error);
    });
});
