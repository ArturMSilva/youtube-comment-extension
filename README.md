# YouTube Comment Q&A

Extensão para Google Chrome que coleta os comentários de um vídeo do YouTube e permite fazer perguntas sobre eles em linguagem natural, recebendo uma resposta gerada por LLM junto com os comentários que embasaram aquela resposta.

---

## Sumário

1. [O que o projeto faz](#1-o-que-o-projeto-faz)
2. [Visão geral da arquitetura](#2-visão-geral-da-arquitetura)
3. [Fluxo de dados passo a passo](#3-fluxo-de-dados-passo-a-passo)
4. [Estrutura do repositório](#4-estrutura-do-repositório)
5. [Extensão Chrome — componentes](#5-extensão-chrome--componentes)
6. [Backend Vercel — componentes](#6-backend-vercel--componentes)
7. [Pipeline RAG](#7-pipeline-rag)
8. [Integração com o LLM](#8-integração-com-o-llm)
9. [Segurança](#9-segurança)
10. [Variáveis de ambiente](#10-variáveis-de-ambiente)
11. [Como executar localmente](#11-como-executar-localmente)
12. [Testes](#12-testes)
13. [Deploy em produção](#13-deploy-em-produção)

---

## 1. O que o projeto faz

O usuário abre qualquer vídeo do YouTube, clica no ícone da extensão e pressiona **Analisar Comentários**. A extensão busca até **500 comentários** pela YouTube Data API e os armazena localmente. Em seguida, o usuário digita uma pergunta em português (ex: *"A bateria dura o dia todo?"*) e a extensão envia essa pergunta junto com os comentários para um backend serverless hospedado na Vercel. O backend aplica um filtro de relevância por palavras-chave (**RAG**), envia os 30 comentários mais pertinentes para o modelo de linguagem **Llama 3.3-70B** (via Groq) e retorna a resposta já formatada. A extensão exibe o texto da resposta e os cards dos comentários que serviram de fonte.

---

## 2. Visão geral da arquitetura

O sistema é dividido em dois blocos independentes:

```
┌─────────────────────────────────────────────────────────┐
│                    CHROME EXTENSION                      │
│                                                          │
│  ┌──────────────┐   mensagens    ┌──────────────────┐   │
│  │  content.js  │ ────────────▶  │ service-worker.js│   │
│  │ (YouTube tab)│                │  (background)    │   │
│  └──────────────┘                └────────┬─────────┘   │
│                                           │             │
│  ┌──────────────┐   mensagens             │             │
│  │   popup.js   │ ◀───────────────────────┘             │
│  │   (UI)       │ ─────────────────────────────────────▶│
│  └──────────────┘                                        │
└─────────────────────────────────────────────────────────┘
         │ POST /api/ask
         ▼
┌─────────────────────────────────────────────────────────┐
│                  VERCEL SERVERLESS                        │
│                                                          │
│  api/ask.ts  ──▶  retrieval.ts  ──▶  llm.ts             │
│  (endpoint)       (filtro RAG)       (Groq API)          │
└─────────────────────────────────────────────────────────┘
         │
         ▼
    Groq Cloud (llama-3.3-70b-versatile)
```

A extensão **nunca** chama a Groq diretamente: toda chamada ao LLM passa pelo backend, que é onde a chave de API fica armazenada com segurança.

---

## 3. Fluxo de dados passo a passo

### Fase 1 — Detecção do vídeo

```
YouTube tab carrega
    └─▶ content.js injeta e lê window.location
            ├─ se /watch?v=XXX  →  envia VIDEO_ID_FOUND {videoId}
            └─ caso contrário  →  envia NOT_A_VIDEO

        MutationObserver re-executa se a URL mudar
        (SPA navigation do YouTube)
```

### Fase 2 — Coleta de comentários

```
Usuário clica "Analisar Comentários"
    └─▶ popup.js → START_COMMENT_COLLECTION {videoId}
            └─▶ service-worker.js
                    └─▶ GET /api/comments?videoId= (Vercel)
                            └─▶ api/comments.ts
                                    └─▶ YouTube Data API /commentThreads
                                            paginação: 100 comentários/página
                                            até 5 páginas (max 500 comentários)
                                            delay de 100ms entre páginas
                                    └─▶ { comments[], totalComments, pagesCollected, limitReached }
                    └─▶ COMMENTS_COLLECTED {comments[], totalComments}
                            └─▶ popup.js salva em chrome.storage.local
                                popup exibe interface de perguntas
```

### Fase 3 — Pergunta ao LLM

```
Usuário digita pergunta e pressiona "Perguntar"
    └─▶ popup.js → ASK_LLM {question, comments[], videoId}
            └─▶ service-worker.js
                    └─▶ POST /api/ask
                            body: { pergunta, comentarios[] }
                    └─▶ api/ask.ts (Vercel)
                            ├─ valida input
                            ├─ filterRelevantComments (RAG, top-30)
                            └─ askGroq(pergunta, comentarios)
                                    └─▶ Groq API
                                    └─▶ parseResponse
                                            extrai texto + FONTES: [1,3,7]
                                    └─▶ { resposta, comentarios_fonte[] }
                    └─▶ LLM_RESPONSE {resposta, comentarios_fonte[]}
                            └─▶ popup.js
                                    exibe resposta em #llm-response
                                    renderiza cards em #source-list
```

---

## 4. Estrutura do repositório

```
TCC/
├── youtube-comment-extension/            ← este repo (raiz carregada no Chrome)
│   ├── manifest.json                     ← MV3: permissões, scripts, ícones
│   ├── content.js                        ← injetado em *.youtube.com
│   ├── service-worker.js                 ← background (ES module)
│   ├── popup.html                        ← markup da UI do popup
│   ├── popup.css                         ← estilos (preto/branco/cinza)
│   └── popup.js                          ← lógica do popup
│
└── youtube-comment-backend/              ← repo irmão — backend serverless (Vercel)
    ├── api/
    │   ├── ask.ts                        ← endpoint POST /api/ask
    │   └── comments.ts                   ← endpoint GET /api/comments
    ├── lib/
    │   ├── retrieval.ts                  ← filtro de relevância (RAG, keyword + semantic)
    │   ├── embeddings.ts                 ← embeddings Gemini (busca semântica)
    │   ├── youtube.ts                    ← paginação da YouTube Data API
    │   ├── llm.ts                        ← integração Groq + parser
    │   └── cors.ts                       ← CORS compartilhado entre endpoints
    ├── tests/
    ├── types.ts                          ← interfaces TypeScript compartilhadas
    ├── package.json
    ├── tsconfig.json
    └── vercel.json                       ← configuração de deploy
```

---

## 5. Extensão Chrome — componentes

### `manifest.json`

Declara a extensão no formato **Manifest V3**. Pontos relevantes:

| Campo | Valor | Motivo |
|---|---|---|
| `manifest_version` | `3` | Obrigatório no Chrome desde 2023 |
| `background.type` | `"module"` | Permite `import`/`export` no service worker |
| `permissions` | `activeTab`, `scripting`, `tabs`, `storage` | Acesso à aba atual e armazenamento local |
| `host_permissions` | `*.vercel.app` | Requisições externas no MV3 precisam de declaração (a extensão não fala mais direto com `googleapis.com`) |
| `content_scripts.matches` | `*://*.youtube.com/*` | Injeta `content.js` apenas no YouTube |

### `content.js`

Script injetado em todas as páginas do YouTube. Responsabilidades:

- **Detectar se a página é um vídeo**: verifica `pathname === '/watch'` e presença de `?v=`.
- **Extrair o `videoId`**: lê o parâmetro `v` da URL.
- **Notificar o service worker** via `chrome.runtime.sendMessage`.
- **Observar navegação SPA**: o YouTube é uma Single Page Application — a URL muda sem recarregar a página. Um `MutationObserver` sobre `document.body` reexecuta `sendPageInfo()` sempre que a URL muda.
- **Responder a requisições do popup**: o popup pode solicitar o `videoId` diretamente via `REQUEST_VIDEO_ID`.

### `service-worker.js`

Background script persistente (ES module, MV3). É o único componente que faz chamadas de rede externas. Escuta três tipos de mensagem:

| Mensagem recebida | Ação |
|---|---|
| `VIDEO_ID_FOUND` | Registra o videoId, repassa ao popup |
| `START_COMMENT_COLLECTION` | Chama `GET /api/comments?videoId=` no backend |
| `ASK_LLM` | Faz `POST /api/ask` no backend e repassa resposta |

**Coleta de comentários** (`fetchCommentsFromBackend`):
- `GET {BACKEND_URL}/api/comments?videoId=...` — o backend faz a paginação na YouTube Data API (100 por página, máximo 5 páginas / 500 comentários) e devolve tudo de uma vez
- A `YOUTUBE_API_KEY` nunca chega à extensão — fica só como env var no backend

**Chamada ao backend** (`callLLM`):
- Serializa a pergunta e os comentários em JSON
- `POST /api/ask` com `Content-Type: application/json`
- Retorna `{ resposta: string, comentarios_fonte: Comment[] }`

> **Atenção**: `BACKEND_URL` é uma constante em `config.js` (gitignored). Atualize-a após cada novo deploy na Vercel.

### `popup.html` / `popup.css` / `popup.js`

A interface do popup tem dois estados:

**Estado inicial**
```
[ Analisar Comentários ]
  Clique em Analisar Comentários
```

**Estado após coleta bem-sucedida** (revela `#qa-interface`)
```
[ Analisar Comentários ]
  ✅ Coleta concluída! Total: 347 comentários

  ┌─ Perguntar sobre Comentários ────────────────┐
  │ Digite sua pergunta sobre os comentários...  │
  │                                              │
  │                              [ Perguntar ]   │
  └──────────────────────────────────────────────┘

  [resposta do LLM]

  Comentários que confirmam
  ┌─────────────────────────────┐
  │ "texto do comentário..."    │
  │ ❤ 42 likes                 │
  └─────────────────────────────┘
```

`popup.js` gerencia:
- **Persistência via `chrome.storage.local`**: ao reabrir o popup no mesmo vídeo, os comentários já coletados são restaurados (exibe há quantos minutos foram coletados).
- **Renderização segura**: comentários sempre inseridos via `textContent`, nunca `innerHTML`, para prevenir XSS.
- **Atalho de teclado**: `Ctrl+Enter` (ou `Cmd+Enter`) envia a pergunta.

---

## 6. Backend Vercel — componentes

### `types.ts`

Define as interfaces TypeScript compartilhadas entre os módulos:

```typescript
// Comentário individual (YouTube → backend)
interface Comment {
  id: string
  text: string
  likeCount: number
}

// Body do POST /api/ask
interface AskRequest {
  pergunta: string
  comentarios: Comment[]
}

// Resposta do endpoint
interface AskResponse {
  resposta: string
  comentarios_fonte: Comment[]
}
```

### `api/ask.ts` — endpoint principal

Handler Vercel que orquestra o pipeline completo:

```
Request
  │
  ├─ applyCORS()     → só permite chrome-extension:// e http://localhost
  ├─ validação       → pergunta obrigatória, comentarios não-vazios
  ├─ sanitização     → trunca pergunta em 500 chars (anti prompt-injection)
  │
  ├─ filterRelevantComments(pergunta, comentarios, 30)
  │
  └─ askGroq(pergunta, relevantes)
       └─▶ { resposta, comentarios_fonte[] }
```

### `lib/retrieval.ts` — filtro RAG

`filterRelevantComments(pergunta, comentarios, topN)`:

1. Extrai **palavras-chave** da pergunta: tokens com mais de 3 caracteres, normalizados para minúsculas.
2. **Pontua** cada comentário: contagem de ocorrências de cada keyword no texto do comentário.
3. Ordena por score decrescente e retorna os `topN` primeiros.
4. **Fallback**: se nenhum comentário obtiver score > 0 (nenhuma keyword bateu), retorna os `topN` com maior `likeCount`.

Isso garante que o LLM nunca receba mais de 30 comentários, reduzindo custo de tokens e melhorando a precisão da resposta.

### `lib/llm.ts` — integração Groq

**`buildPrompt(pergunta, comentarios)`**: monta o prompt numerando os comentários com seus likes:

```
[1] "texto do comentário" (42 likes)
[2] "outro comentário" (10 likes)
...

Pergunta: como está a bateria?

Responda em português de forma concisa (2-4 frases).
Ao final, indique os números dos comentários que embasaram
sua resposta no formato: FONTES: [1, 3, 7]
```

**`askGroq(pergunta, comentarios)`**:
- Modelo primário: `llama-3.3-70b-versatile` (temperatura 0.3, max 1024 tokens)
- Fallback automático para `mixtral-8x7b-32768` em caso de HTTP 429 (rate limit)

**`parseResponse(raw, comentarios)`**:
- Extrai a linha `FONTES: [1, 3, 7]` via regex
- Converte índices 1-based → 0-based e mapeia para os objetos `Comment`
- Remove a linha de FONTES do texto exibido ao usuário

---

## 7. Pipeline RAG

RAG (*Retrieval-Augmented Generation*) é a técnica de filtrar os documentos relevantes antes de enviá-los ao LLM, em vez de enviar tudo de uma vez.

**Por que isso importa aqui**: um vídeo popular pode ter 500+ comentários. Enviar todos ao LLM:
- Ultrapassaria o limite de tokens do contexto
- Aumentaria o custo por requisição
- Diluiria a relevância da resposta

**Como funciona**:

```
500 comentários coletados
        │
        ▼
  filterRelevantComments("bateria", comentarios, 30)
        │
        ├─ keyword: "bater" (>3 chars)
        │
        ├─ score comentário A: "bateria dura o dia" → 1 ponto
        ├─ score comentário B: "tela linda"         → 0 pontos
        ├─ score comentário C: "bateria fraca"      → 1 ponto
        │
        └─ retorna top-30 com score > 0
                │
                ▼
        LLM recebe 30 comentários
        em vez de 500
```

---

## 8. Integração com o LLM

### Modelo e parâmetros

| Parâmetro | Valor | Justificativa |
|---|---|---|
| Modelo primário | `llama-3.3-70b-versatile` | Alta capacidade de compreensão em português |
| Modelo fallback | `mixtral-8x7b-32768` | Ativado em caso de rate limit (HTTP 429) |
| Temperatura | `0.3` | Respostas mais determinísticas e factuais |
| Max tokens | `1024` | Suficiente para 2–4 frases + linha FONTES |

### Formato da resposta

O LLM é instruído a terminar sua resposta com uma linha especial:

```
A bateria do produto tem boa durabilidade segundo os comentários.
Vários usuários relataram que ela dura o dia todo com uso moderado.
FONTES: [1, 3, 7]
```

`parseResponse` separa o texto da resposta dos índices, mapeia os índices de volta aos objetos `Comment` originais e os envia ao popup como `comentarios_fonte`.

---

## 9. Segurança

### CORS restrito

O backend só aceita requisições de origens conhecidas:

```typescript
if (origin.startsWith('chrome-extension://') || origin === 'http://localhost') {
  res.setHeader('Access-Control-Allow-Origin', origin)
}
```

Qualquer outra origem (incluindo navegadores comuns) não recebe os headers CORS e é bloqueada pelo browser.

### Prevenção de XSS

Comentários do YouTube podem conter HTML arbitrário. O popup nunca usa `innerHTML` para renderizá-los — sempre `createElement` + `textContent`:

```javascript
const textDiv = document.createElement('div')
textDiv.textContent = c.text || ''  // nunca innerHTML
```

### Sanitização de prompt injection

A pergunta do usuário é truncada em 500 caracteres antes de chegar ao LLM, limitando tentativas de injeção de instruções maliciosas via prompt.

### Chave de API

A `GROQ_API_KEY`, a `GEMINI_API_KEY` e a `YOUTUBE_API_KEY` nunca aparecem no código — existem apenas como variáveis de ambiente na Vercel (dashboard) e no `.env` local do backend (gitignored). A extensão não guarda nenhuma chave de API; `config.js` só tem `BACKEND_URL`.

---

## 10. Variáveis de ambiente

| Variável | Onde configurar | Descrição |
|---|---|---|
| `GROQ_API_KEY` | Vercel dashboard → Environment Variables | Autenticação na API Groq |
| `GEMINI_API_KEY` | Vercel dashboard → Environment Variables | Embeddings para busca semântica (`method: 'semantic'`) |
| `YOUTUBE_API_KEY` | Vercel dashboard → Environment Variables | Autenticação na YouTube Data API v3 (usada só por `/api/comments`) |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `YOUTUBE_API_KEY` (local) | `youtube-comment-backend/.env` | Para desenvolvimento local |
| `BACKEND_URL` | `config.js` (extensão) | URL do backend Vercel |

O arquivo `config.example.js` serve de referência. Nunca faça commit do `config.js`.

---

## 11. Como executar localmente

### Backend

```bash
cd ../youtube-comment-backend
npm install
npx vercel dev        # servidor em http://localhost:3000
```

### Extensão

1. Copie o arquivo de configuração e preencha com suas credenciais:
   ```bash
   cp config.example.js config.js
   ```
2. Abra `chrome://extensions/`
3. Ative **Modo do desenvolvedor**
4. **Carregar sem compactação** → selecione a pasta raiz `youtube-comment-extension/`
5. Após alterar qualquer arquivo da extensão, clique no ícone ↻ na página de extensões

### Teste rápido do endpoint (PowerShell)

```powershell
$body = '{"pergunta":"A bateria é boa?","comentarios":[{"id":"1","text":"Bateria dura o dia todo","likeCount":50}]}'
Invoke-RestMethod -Uri "http://localhost:3000/api/ask" -Method Post -ContentType "application/json" -Body $body
```

---

## 12. Testes

Os testes ficam em `youtube-comment-backend/tests/` e usam **Vitest**.

```bash
cd ../youtube-comment-backend
npm test              # executa todos os testes uma vez
npm run test:watch    # modo watch (re-executa ao salvar)
```

### Cobertura atual (29 testes)

- **`retrieval.test.ts`** — filtro por keyword, filtro semântico (cosine sobre embeddings mockados) e o dispatcher `selectRelevantComments`
- **`embeddings.test.ts`** — `cosineSimilarity`, `chunk`, `embedQuery`/`embedDocuments` com cliente Gemini mockado
- **`youtube.test.ts`** — paginação de `fetchYouTubeComments`, limites de `MAX_PAGES`/`MAX_COMMENTS`, erro explícito em falha da API
- **`llm.test.ts`** — parsing do formato `FONTES: [...]` da resposta do Groq

---

## 13. Deploy em produção

```bash
cd ../youtube-comment-backend
npx vercel --prod
```

Após o deploy:
1. Copie a URL gerada (ex: `https://youtube-comment-analysis-xxx.vercel.app`)
2. Atualize `BACKEND_URL` em `config.js`
3. Recarregue a extensão em `chrome://extensions/`
4. Confirme que `GROQ_API_KEY` está configurada no dashboard da Vercel

> A URL do backend muda a cada novo deploy se você não tiver um domínio fixo configurado. Para evitar precisar atualizar o `service-worker.js` constantemente, configure um **alias** no `vercel.json` ou use um domínio customizado.
