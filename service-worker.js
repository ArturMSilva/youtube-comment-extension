import { API_KEY, BACKEND_URL } from './config.js';

const MAX_COMMENTS = 500;
const MAX_PAGES = 5;

console.log('Service Worker do YouTube Comment Q&A iniciado');

async function fetchComments(videoId, apiKey, onProgress = null) {
    console.log(`Iniciando coleta de comentários para o vídeo: ${videoId}`);
    
    const allComments = [];
    let nextPageToken = null;
    let pageCount = 0;
    let totalCommentsCollected = 0;
    
    try {
        do {
            pageCount++;
            console.log(`Buscando página ${pageCount}...`);
            
            if (onProgress) {
                onProgress(pageCount, totalCommentsCollected);
            }
            
            const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
            url.searchParams.append('part', 'snippet');
            url.searchParams.append('videoId', videoId);
            url.searchParams.append('key', apiKey);
            url.searchParams.append('maxResults', '100');
            url.searchParams.append('order', 'relevance');
            
            if (nextPageToken) {
                url.searchParams.append('pageToken', nextPageToken);
            }
            
            const response = await fetch(url.toString());
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Erro na API: ${response.status} - ${errorData.error?.message || 'Erro desconhecido'}`);
            }
            
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                const comments = data.items.map(item => {
                    const snippet = item.snippet.topLevelComment.snippet;
                    return {
                        id: item.id,
                        author: snippet.authorDisplayName,
                        text: snippet.textDisplay,
                        textOriginal: snippet.textOriginal,
                        likeCount: snippet.likeCount,
                        publishedAt: snippet.publishedAt,
                        updatedAt: snippet.updatedAt
                    };
                });
                
                allComments.push(...comments);
                totalCommentsCollected += comments.length;
                
                console.log(`Página ${pageCount}: ${comments.length} comentários coletados (Total: ${totalCommentsCollected})`);
            }
            
            // Verificar próxima página
            nextPageToken = data.nextPageToken || null;
            
            // Verificar limites de segurança
            if (totalCommentsCollected >= MAX_COMMENTS) {
                console.warn(`Limite de ${MAX_COMMENTS} comentários atingido. Parando coleta.`);
                break;
            }
            
            if (pageCount >= MAX_PAGES) {
                console.warn(`Limite de ${MAX_PAGES} páginas atingido. Parando coleta.`);
                break;
            }
            
            // Pequeno delay entre requisições para evitar rate limiting
            if (nextPageToken) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
        } while (nextPageToken);
        
        console.log(`Coleta finalizada: ${totalCommentsCollected} comentários em ${pageCount} páginas`);
        
        return {
            success: true,
            videoId: videoId,
            comments: allComments,
            totalComments: totalCommentsCollected,
            pagesCollected: pageCount,
            limitReached: totalCommentsCollected >= MAX_COMMENTS || pageCount >= MAX_PAGES
        };
        
    } catch (error) {
        console.error('Erro ao buscar comentários:', error);
        return {
            success: false,
            error: error.message,
            videoId: videoId,
            comments: [],
            totalComments: 0
        };
    }
}

async function callLLM(question, comments) {
  console.log(`Chamando backend para ${comments.length} comentários`);

  const payload = {
    pergunta: question,
    comentarios: comments.map(c => ({
      id: c.id,
      text: c.textOriginal || c.text,
      likeCount: c.likeCount || 0
    }))
  };

  const response = await fetch(`${BACKEND_URL}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP ${response.status}`);
  }

  // Retorna { resposta: string, comentarios_fonte: Comment[] }
  return await response.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Mensagem recebida no Service Worker:', message);
    
    if (message.type === 'START_COMMENT_COLLECTION') {
        const videoId = message.videoId;
        console.log(`Iniciando coleta de comentários para: ${videoId}`);
        
        (async () => {
            try {
                if (API_KEY === 'SUA_CHAVE_API_AQUI') {
                    console.warn('⚠️ API Key não configurada! Configure a API_KEY no service-worker.js');
                    chrome.runtime.sendMessage({
                        type: 'COMMENTS_ERROR',
                        error: 'API Key não configurada. Edite o arquivo service-worker.js',
                        videoId: videoId
                    }, () => {
                        if (chrome.runtime.lastError) {
                            console.log('Popup não está aberto:', chrome.runtime.lastError.message);
                        }
                    });
                    
                    sendResponse({ success: false, error: 'API Key não configurada' });
                    return;
                }
                
                console.log('Iniciando busca de comentários...');
                
                const onProgress = (currentPage, totalCollected) => {
                    chrome.runtime.sendMessage({
                        type: 'COLLECTING_STATUS',
                        currentPage: currentPage,
                        totalCollected: totalCollected,
                        videoId: videoId
                    }, () => {
                        if (chrome.runtime.lastError) {
                            console.log('Popup não está aberto:', chrome.runtime.lastError.message);
                        }
                    });
                };
                
                const result = await fetchComments(videoId, API_KEY, onProgress);
                
                if (result.success) {
                    console.log('✅ Comentários coletados com sucesso:', result);
                    console.log('Amostra dos primeiros comentários:', result.comments.slice(0, 3));
                    chrome.runtime.sendMessage({
                        type: 'COMMENTS_COLLECTED',
                        videoId: result.videoId,
                        comments: result.comments,
                        totalComments: result.totalComments,
                        pagesCollected: result.pagesCollected,
                        limitReached: result.limitReached
                    }, () => {
                        if (chrome.runtime.lastError) {
                            console.log('Popup não está aberto:', chrome.runtime.lastError.message);
                        }
                    });
                    
                    sendResponse({ success: true, totalComments: result.totalComments });
                } else {
                    console.error('❌ Erro ao coletar comentários:', result.error);
                    
                    chrome.runtime.sendMessage({
                        type: 'COMMENTS_ERROR',
                        error: result.error,
                        videoId: videoId
                    }, () => {
                        if (chrome.runtime.lastError) {
                            console.log('Popup não está aberto:', chrome.runtime.lastError.message);
                        }
                    });
                    
                    sendResponse({ success: false, error: result.error });
                }
            } catch (error) {
                console.error('Erro inesperado:', error);
                
                chrome.runtime.sendMessage({
                    type: 'COMMENTS_ERROR',
                    error: error.message,
                    videoId: videoId
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.log('Popup não está aberto:', chrome.runtime.lastError.message);
                    }
                });
                
                sendResponse({ success: false, error: error.message });
            }
        })();
        
        return true;
    }
    
    if (message.type === 'VIDEO_ID_FOUND') {
        const videoId = message.videoId;
        console.log(`Video ID encontrado: ${videoId}`);
        
        sendResponse({ success: true, videoId: videoId });
        return true;
    }
    
    if (message.type === 'NOT_A_VIDEO') {
        console.log('Página atual não é um vídeo:', message.url);
        
        chrome.runtime.sendMessage({
            type: 'NOT_A_VIDEO_STATUS',
            url: message.url
        }, () => {
            if (chrome.runtime.lastError) {
                console.log('Popup não está aberto:', chrome.runtime.lastError.message);
            }
        });
        
        sendResponse({ success: true, message: 'Não é uma página de vídeo' });
        return true;
    }
    
    if (message.type === 'ASK_LLM') {
        const { question, comments, videoId } = message;
        console.log(`Pergunta recebida: "${question}" sobre ${comments?.length || 0} comentários`);
        
        (async () => {
            try {
                if (!question || question.trim().length === 0) {
                    throw new Error('Pergunta vazia');
                }
                
                if (!comments || comments.length === 0) {
                    throw new Error('Nenhum comentário disponível');
                }
                
                console.log('Chamando LLM...');
                const response = await callLLM(question, comments);
                
                console.log('✅ Resposta do LLM gerada com sucesso');
                chrome.runtime.sendMessage({
                    type: 'LLM_RESPONSE',
                    resposta: response.resposta,
                    comentarios_fonte: response.comentarios_fonte || [],
                    question: question,
                    videoId: videoId
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.log('Popup não está aberto:', chrome.runtime.lastError.message);
                    }
                });
                
                sendResponse({ success: true, resposta: response.resposta });
                
            } catch (error) {
                console.error('❌ Erro ao processar pergunta:', error);
                
                chrome.runtime.sendMessage({
                    type: 'LLM_ERROR',
                    error: error.message,
                    question: question
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.log('Popup não está aberto:', chrome.runtime.lastError.message);
                    }
                });
                
                sendResponse({ success: false, error: error.message });
            }
        })();
        
        return true;
    }
    
    return false;
});

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('✅ Extensão YouTube Comment Q&A instalada com sucesso!');
        console.log('⚠️ Não esqueça de configurar a API_KEY no service-worker.js');
    } else if (details.reason === 'update') {
        console.log('🔄 Extensão YouTube Comment Q&A atualizada!');
    }
});

self.addEventListener('error', (event) => {
    console.error('Erro no Service Worker:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('Promise rejeitada não tratada:', event.reason);
});
