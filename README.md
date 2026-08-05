# CommentLens — YouTube Comment Q&A

Extensão para Google Chrome que coleta os comentários de um vídeo do YouTube e permite fazer perguntas sobre eles em linguagem natural, recebendo uma resposta gerada por LLM junto com os comentários que embasaram aquela resposta.

**Arquitetura de execução:** o **backend roda em produção na Vercel**; a **extensão roda localmente**, carregada no Chrome em modo desenvolvedor. Ela não está publicada na Chrome Web Store — para testá-la basta carregar esta pasta no navegador, como explicado na [Seção 2](#2-como-rodar-a-extensão-guia-de-instalação).

---

## Sumário

1. [O que o projeto faz](#1-o-que-o-projeto-faz)
2. [Como rodar a extensão (guia de instalação)](#2-como-rodar-a-extensão-guia-de-instalação)
3. [Solução de problemas](#3-solução-de-problemas)
4. [Visão geral da arquitetura](#4-visão-geral-da-arquitetura)
5. [Fluxo de dados passo a passo](#5-fluxo-de-dados-passo-a-passo)
6. [Estrutura do repositório](#6-estrutura-do-repositório)
7. [Extensão Chrome — componentes](#7-extensão-chrome--componentes)
8. [Backend Vercel — componentes](#8-backend-vercel--componentes)
9. [Recuperação de comentários (RAG) e modo de comparação](#9-recuperação-de-comentários-rag-e-modo-de-comparação)
10. [Integração com o LLM](#10-integração-com-o-llm)
11. [Segurança](#11-segurança)
12. [Variáveis de ambiente e configuração](#12-variáveis-de-ambiente-e-configuração)
13. [Desenvolvimento com backend local](#13-desenvolvimento-com-backend-local)
14. [Testes](#14-testes)
15. [Deploy do backend](#15-deploy-do-backend)

---

## 1. O que o projeto faz

O usuário abre qualquer vídeo do YouTube, clica no ícone da extensão e pressiona **Analisar comentários**. A extensão pede ao backend que colete até **500 comentários** pela YouTube Data API e os guarda localmente. Em seguida, o usuário digita uma pergunta em português (ex: *"A bateria dura o dia todo?"*) e a extensão envia a pergunta junto com os comentários para o backend serverless na Vercel. O backend seleciona os **30 comentários mais relevantes** — por palavra-chave e por similaridade semântica — envia-os ao modelo **Llama 3.3-70B** (via Groq) e devolve a resposta formatada. A extensão exibe o texto da resposta e os cards dos comentários que serviram de fonte.

---

## 2. Como rodar a extensão (guia de instalação)

A extensão é carregada **sem compactação** ("unpacked"), direto desta pasta. Não é preciso instalar nada além do Chrome — não há build, npm install nem compilação nesta parte do projeto.

### Pré-requisitos

- **Google Chrome** (ou outro navegador Chromium: Edge, Brave)
- A pasta `youtube-comment-extension/` deste repositório
- A **URL do backend em produção** (ex.: `https://seu-projeto.vercel.app`) — o backend já está publicado na Vercel; nada precisa ser rodado na máquina de quem testa

### Passo 1 — Criar o arquivo de configuração

O único arquivo que precisa ser criado é o `config.js`, que guarda a URL do backend. Ele **não vem no repositório** (está no `.gitignore`), então copie o modelo:

```powershell
# PowerShell, dentro de youtube-comment-extension/
Copy-Item config.example.js config.js
```

```bash
# Bash / macOS / Linux
cp config.example.js config.js
```

Abra o `config.js` e preencha com a URL de produção:

```javascript
export const BACKEND_URL = 'https://seu-projeto.vercel.app';
```

> ⚠️ **Sem barra no final** e **sem `/api`** — o código já acrescenta `/api/ask` e `/api/comments`.
> Se este arquivo não existir, o service worker falha logo no `import` e a extensão não responde a nada.

### Passo 2 — Carregar a extensão no Chrome

1. Abra `chrome://extensions/`
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `youtube-comment-extension/` (a pasta que contém o `manifest.json`)
5. O card **CommentLens** aparece na lista. Fixe o ícone na barra de ferramentas pelo botão de extensões (🧩) para facilitar o acesso

### Passo 3 — Usar

1. Abra qualquer vídeo do YouTube (URL no formato `youtube.com/watch?v=...`)
2. **Se a aba do YouTube já estava aberta antes de instalar a extensão, recarregue-a** (F5) — o script de conteúdo só é injetado quando a página carrega
3. Clique no ícone da extensão. O popup deve mostrar **"Pronto para analisar"**
4. Clique em **Analisar comentários** e aguarde a coleta (mensagem "Coleta concluída · N comentários")
5. Digite a pergunta no campo de texto e clique em **Perguntar** (ou `Ctrl+Enter`)
6. A resposta aparece abaixo, seguida dos cards **"Comentários que confirmam"** — os comentários que o modelo citou como fonte

> A coleta fica salva por vídeo. Ao reabrir o popup no mesmo vídeo, os comentários são restaurados do `chrome.storage.local` e o status mostra há quantos minutos foram coletados — não é preciso coletar de novo para fazer outra pergunta.

### Depois de alterar arquivos da extensão

Clique no ícone ↻ (recarregar) no card da extensão em `chrome://extensions/`. Mudanças no `content.js` também exigem recarregar a aba do YouTube.

---

## 3. Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Popup não reage a nada / erro "service worker (inativo)" com erro vermelho | `config.js` não existe ou tem sintaxe inválida | Refaça o Passo 1. Veja o erro em `chrome://extensions/` → **Erros** no card da extensão |
| "Erro: recarregue a página do YouTube" | O `content.js` não está injetado na aba (ela foi aberta antes da instalação) | Recarregue a aba do YouTube (F5) |
| "Navegue até um vídeo do YouTube" | A URL atual não é `/watch?v=...` (home, canal, Shorts) | Abra um vídeo comum |
| Erro na coleta mencionando a API do YouTube | Quota da YouTube Data API esgotada, vídeo com comentários desativados ou id inválido | Tente outro vídeo; se persistir, é a quota diária do backend |
| Resposta demora ou falha com erro 502 | Cada pergunta roda os dois métodos de recuperação (ver [Seção 9](#9-recuperação-de-comentários-rag-e-modo-de-comparação)); vídeos com 500 comentários custam mais | Aguarde; o limite da função é 30 s. Se o Gemini estiver com rate limit, a resposta ainda vem, com um aviso |
| Falha de rede / CORS no console | `BACKEND_URL` errada (barra no final, `http` em vez de `https`, projeto pausado) | Confira o `config.js` e teste a URL direto no navegador: `https://seu-projeto.vercel.app/api/comments?videoId=dQw4w9WgXcQ` |

**Onde ver os logs:** `chrome://extensions/` → card da extensão → **service worker** abre o DevTools do background (logs da coleta e das chamadas ao backend). Para o popup, clique com o botão direito dentro dele → **Inspecionar**.

---

## 4. Visão geral da arquitetura

O sistema é dividido em dois blocos independentes — dois repositórios git irmãos:

```
┌─────────────────────────────────────────────────────────┐
│         CHROME EXTENSION  (local, modo desenvolvedor)    │
│                                                          │
│  ┌──────────────┐   mensagens    ┌──────────────────┐   │
│  │  content.js  │ ────────────▶  │ service-worker.js│   │
│  │ (YouTube tab)│                │  (background)    │   │
│  └──────────────┘                └────────┬─────────┘   │
│                                           │             │
│  ┌──────────────┐   mensagens             │             │
│  │   popup.js   │ ◀───────────────────────┘             │
│  │   (UI)       │ ─────────────────────────────────────▶│
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
         │ GET /api/comments   POST /api/ask
         ▼
┌─────────────────────────────────────────────────────────┐
│      VERCEL SERVERLESS  (produção, https://…vercel.app)  │
│                                                          │
│  api/comments.ts ──▶ lib/youtube.ts ──▶ YouTube Data API │
│  api/ask.ts      ──▶ lib/retrieval.ts ─▶ lib/llm.ts      │
│                          │                               │
│                          └──▶ lib/persistence.ts ──▶ Neon│
└─────────────────────────────────────────────────────────┘
         │
         ▼
  Groq Cloud (llama-3.3-70b-versatile) · Gemini (embeddings)
```

A extensão **nunca** chama a Groq, o Gemini ou a YouTube Data API diretamente: toda chamada externa passa pelo backend, que é onde as chaves de API ficam armazenadas com segurança.

---

## 5. Fluxo de dados passo a passo

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
Usuário clica "Analisar comentários"
    └─▶ popup.js → START_COMMENT_COLLECTION {videoId}
            └─▶ service-worker.js
                    └─▶ GET {BACKEND_URL}/api/comments?videoId=
                            └─▶ api/comments.ts (Vercel)
                                    └─▶ YouTube Data API /commentThreads
                                            paginação: 100 comentários/página
                                            até 5 páginas (máx. 500 comentários)
                                            delay de 100 ms entre páginas
                                    └─▶ { comments[], totalComments,
                                          pagesCollected, limitReached }
                    └─▶ COMMENTS_COLLECTED {comments[], totalComments}
                            └─▶ popup.js salva em chrome.storage.local
                                popup revela a interface de perguntas
```

### Fase 3 — Pergunta ao LLM

```
Usuário digita a pergunta e clica "Perguntar" (ou Ctrl+Enter)
    └─▶ popup.js → ASK_LLM {question, comments[], videoId}
            └─▶ service-worker.js
                    └─▶ POST {BACKEND_URL}/api/ask
                            body: { pergunta, comentarios[], videoId,
                                    compare: true }
                    └─▶ api/ask.ts (Vercel)
                            ├─ CORS + validação de input
                            ├─ trunca a pergunta em 500 chars
                            ├─ roda os DOIS métodos em paralelo:
                            │     keyword  → filterRelevantComments (top-30)
                            │     semantic → semanticFilterComments (top-30)
                            ├─ askGroq(pergunta, top-30) para cada método
                            ├─ persiste as duas interações (mesmo par_id)
                            └─ responde com o resultado semântico
                    └─▶ LLM_RESPONSE {resposta, comentarios_fonte[]}
                            └─▶ popup.js
                                    exibe a resposta em #llm-response
                                    renderiza os cards em #source-list
```

---

## 6. Estrutura do repositório

```
TCC/
├── youtube-comment-extension/            ← este repo (raiz carregada no Chrome)
│   ├── manifest.json                     ← MV3: permissões, scripts, popup
│   ├── content.js                        ← injetado em *.youtube.com
│   ├── service-worker.js                 ← background (ES module)
│   ├── popup.html                        ← markup da UI do popup
│   ├── popup.css                         ← estilos
│   ├── popup.js                          ← lógica do popup
│   ├── config.example.js                 ← modelo de configuração (versionado)
│   └── config.js                         ← BACKEND_URL (gitignored — você cria)
│
└── youtube-comment-backend/              ← repo irmão — backend serverless (Vercel)
    ├── api/
    │   ├── ask.ts                        ← POST /api/ask
    │   └── comments.ts                   ← GET /api/comments
    ├── lib/
    │   ├── retrieval.ts                  ← filtro de relevância (keyword + semantic)
    │   ├── embeddings.ts                 ← embeddings Gemini + cosseno
    │   ├── youtube.ts                    ← paginação da YouTube Data API
    │   ├── llm.ts                        ← integração Groq + parser
    │   ├── cors.ts                       ← CORS compartilhado
    │   ├── db.ts                         ← client Neon HTTP + Drizzle
    │   └── persistence.ts                ← gravação das interações
    ├── db/schema.ts                      ← schema Drizzle (base de pesquisa)
    ├── scripts/dev-server.ts             ← servidor local sem `vercel dev`
    ├── tests/                            ← Vitest (51 testes)
    ├── docs/                             ← documentação de apoio do TCC
    ├── types.ts
    └── vercel.json
```

---

## 7. Extensão Chrome — componentes

### `manifest.json`

Declara a extensão no formato **Manifest V3**. Pontos relevantes:

| Campo | Valor | Motivo |
|---|---|---|
| `manifest_version` | `3` | Obrigatório no Chrome desde 2023 |
| `background.type` | `"module"` | Permite `import`/`export` no service worker (é assim que ele lê o `config.js`) |
| `permissions` | `activeTab`, `scripting`, `tabs`, `storage` | Acesso à aba atual e armazenamento local |
| `host_permissions` | `https://*.vercel.app/*` | Cobre o backend em produção; a extensão não fala com `googleapis.com` |
| `content_scripts.matches` | `*://*.youtube.com/*` | Injeta `content.js` apenas no YouTube |

### `content.js`

Script injetado em todas as páginas do YouTube. Responsabilidades:

- **Detectar se a página é um vídeo**: verifica `pathname === '/watch'` e presença de `?v=`
- **Extrair o `videoId`**: lê o parâmetro `v` da URL
- **Notificar o service worker** via `chrome.runtime.sendMessage`
- **Observar navegação SPA**: o YouTube é uma Single Page Application — a URL muda sem recarregar a página. Um `MutationObserver` sobre `document.body` reexecuta `sendPageInfo()` sempre que a URL muda
- **Responder ao popup**: o popup pode pedir o `videoId` diretamente via `REQUEST_VIDEO_ID`

### `service-worker.js`

Background script (ES module, MV3). É o único componente que faz chamadas de rede. Escuta:

| Mensagem recebida | Ação |
|---|---|
| `VIDEO_ID_FOUND` | Registra o videoId e confirma ao remetente |
| `NOT_A_VIDEO` | Repassa o status ao popup |
| `START_COMMENT_COLLECTION` | Chama `GET {BACKEND_URL}/api/comments?videoId=` |
| `ASK_LLM` | Faz `POST {BACKEND_URL}/api/ask` e repassa a resposta |

**Coleta de comentários** (`fetchCommentsFromBackend`): o backend faz toda a paginação na YouTube Data API e devolve os comentários de uma vez. A `YOUTUBE_API_KEY` nunca chega à extensão.

**Chamada ao backend** (`callLLM`): monta `{ pergunta, comentarios, videoId, compare: true }`, normalizando cada comentário para `{ id, text, likeCount }` (usa `textOriginal` quando disponível, evitando o HTML de `textDisplay`). O `compare: true` é o que alimenta a comparação keyword × semântico do TCC.

> **Atenção**: `BACKEND_URL` vem de `config.js` (gitignored). Se você trocar o projeto da Vercel ou alternar entre produção e local, é este arquivo que muda.

### `popup.html` / `popup.css` / `popup.js`

A interface (**CommentLens**) tem dois estados:

**Estado inicial**
```
[ ⬇ Analisar comentários ]
  Pronto para analisar
```

**Após a coleta** (revela `#qa-interface`)
```
[ ↻ Analisar novamente ]
  ✓ Coleta concluída · 347 comentários

  ┌─ Perguntar sobre os comentários ─────────────┐
  │ Digite sua pergunta sobre os comentários…    │
  │                                              │
  │                            [ ➤ Perguntar ]   │
  └──────────────────────────────────────────────┘

  [resposta do modelo]

  Comentários que confirmam
  ┌─────────────────────────────┐
  │ "texto do comentário…"      │
  │ ♥ 42 curtidas               │
  └─────────────────────────────┘
```

`popup.js` gerencia:

- **Persistência via `chrome.storage.local`**: ao reabrir o popup no mesmo vídeo, os comentários coletados são restaurados (mostrando há quantos minutos)
- **Estados de status**: `neutral`, `loading`, `success`, `error`, cada um com seu ícone
- **Renderização segura**: o texto dos comentários é sempre inserido via `textContent`, nunca `innerHTML` (ver [Segurança](#11-segurança))
- **Atalho de teclado**: `Ctrl+Enter` (ou `Cmd+Enter`) envia a pergunta

---

## 8. Backend Vercel — componentes

Detalhamento completo em `youtube-comment-backend/README.md`. Resumo do que a extensão consome:

### `GET /api/comments?videoId=`

Coleta os comentários na YouTube Data API (100 por página, até 5 páginas / 500 comentários, ordenados por relevância) e devolve `{ comments[], totalComments, pagesCollected, limitReached }`.

### `POST /api/ask`

```
Request
  │
  ├─ applyCORS()     → só chrome-extension:// e http://localhost
  ├─ validação       → pergunta obrigatória, comentarios não-vazios
  ├─ sanitização     → trunca a pergunta em 500 chars
  │
  ├─ compare: true   → roda keyword E semantic em paralelo
  │     └─ selectRelevantComments(metodo, pergunta, comentarios, 30)
  │     └─ askGroq(pergunta, relevantes)
  │     └─ salvarInteracao(...)  (best-effort, mesmo par_id)
  │
  └─▶ { resposta, comentarios_fonte[] }   ← resultado semântico
```

Campos aceitos no corpo: `pergunta` e `comentarios` (obrigatórios), `method` (`'keyword' | 'semantic'`, padrão `keyword`), `compare` (boolean) e `videoId` (usado só na persistência).

### Persistência (base de pesquisa do TCC)

Cada interação grava no Neon (Postgres, via Drizzle) uma linha em `interacoes` — pergunta, resposta, método, modelo, latência do filtro — e até 30 em `interacao_comentarios`, marcando com `foi_fonte = true` os que o modelo citou. A gravação é **best-effort**: se o banco falhar, a resposta ao usuário continua normal.

---

## 9. Recuperação de comentários (RAG) e modo de comparação

RAG (*Retrieval-Augmented Generation*) é a técnica de selecionar os documentos relevantes antes de enviá-los ao LLM, em vez de mandar tudo.

**Por que isso importa aqui**: um vídeo popular tem 500+ comentários. Enviar todos ao LLM estouraria o contexto, encareceria a requisição e diluiria a relevância da resposta. O backend reduz para **30 comentários** por dois caminhos:

| | **Keyword** | **Semântico** |
|---|---|---|
| Natureza | Léxica (texto literal) | Significado (embeddings) |
| Como pontua | Contagem de ocorrências das palavras da pergunta (>3 letras) | Similaridade de cosseno com o embedding da pergunta |
| Sinônimos e paráfrases | Não captura | Captura |
| Dependência externa | Nenhuma | API do Gemini (`gemini-embedding-001`) |
| Latência | Baixa | Maior (chamadas HTTP) |
| Em caso de falha | Não falha (cai para os 30 mais curtidos) | Erro explícito `502`, sem fallback silencioso |

**Modo de comparação:** a extensão envia `compare: true` em toda pergunta, então **os dois métodos rodam para a mesma entrada** e as duas interações são gravadas com o mesmo `par_id`. Isso produz um experimento controlado — mesma pergunta, mesmos comentários, mesmo LLM, variando só a recuperação — que é o núcleo experimental do TCC. O usuário vê a resposta do método semântico; se o Gemini falhar, vê a de keyword acompanhada de um `aviso`.

Fundamentação completa: `youtube-comment-backend/docs/comparacao-keyword-vs-semantica.md`.

---

## 10. Integração com o LLM

### Modelo e parâmetros

| Parâmetro | Valor | Justificativa |
|---|---|---|
| Modelo primário | `llama-3.3-70b-versatile` | Boa compreensão de português |
| Modelo fallback | `mixtral-8x7b-32768` | Ativado em rate limit (HTTP 429) |
| Temperatura | `0.3` | Respostas mais determinísticas e factuais |
| Max tokens | `1024` | Suficiente para 2–4 frases + linha FONTES |

### Formato da resposta

O prompt instrui o modelo a tratar os comentários **apenas como dados** — ignorando instruções embutidas neles — e a terminar a resposta com uma linha especial:

```
A bateria do produto tem boa durabilidade segundo os comentários.
Vários usuários relataram que ela dura o dia todo com uso moderado.
FONTES: [1, 3, 7]
```

`parseResponse` separa o texto dos índices (1-based → 0-based), descarta índices fora do intervalo, remove a linha `FONTES` do texto exibido e mapeia os índices de volta aos objetos `Comment`, que chegam ao popup como `comentarios_fonte`.

---

## 11. Segurança

### CORS restrito

O backend só devolve os headers de CORS para origens conhecidas:

```typescript
if (origin.startsWith('chrome-extension://') || origin === 'http://localhost') {
  res.setHeader('Access-Control-Allow-Origin', origin)
}
```

Qualquer outra origem (incluindo uma aba comum do navegador) não recebe os headers e é bloqueada pelo browser.

### Prevenção de XSS

Comentários do YouTube podem conter HTML arbitrário. O popup nunca usa `innerHTML` para renderizá-los — sempre `createElement` + `textContent`:

```javascript
const textDiv = document.createElement('div')
textDiv.textContent = c.text || ''  // nunca innerHTML
```

(O `innerHTML` só aparece com conteúdo estático definido no próprio código: os ícones SVG de status e dos botões.)

### Mitigação de prompt injection

Duas camadas: a pergunta do usuário é truncada em **500 caracteres** antes de chegar ao LLM, e o prompt instrui explicitamente o modelo a tratar os comentários como dados, ignorando instruções que apareçam dentro deles.

### Chaves de API

`GROQ_API_KEY`, `GEMINI_API_KEY`, `YOUTUBE_API_KEY` e `DATABASE_URL` nunca aparecem no código — existem apenas como variáveis de ambiente na Vercel e no `.env` local do backend (gitignored). **A extensão não guarda nenhuma chave**: seu `config.js` contém só a `BACKEND_URL`.

---

## 12. Variáveis de ambiente e configuração

| Variável | Onde configurar | Descrição |
|---|---|---|
| `BACKEND_URL` | `config.js` da extensão (gitignored) | URL do backend na Vercel |
| `GROQ_API_KEY` | Vercel → Environment Variables | Autenticação na API da Groq |
| `GEMINI_API_KEY` | Vercel → Environment Variables | Embeddings da busca semântica — obrigatória, já que a extensão usa `compare: true` |
| `YOUTUBE_API_KEY` | Vercel → Environment Variables | YouTube Data API v3 (usada só por `/api/comments`) |
| `DATABASE_URL` | Vercel → Environment Variables | Postgres no Neon — persistência das interações |

Para desenvolvimento local do backend, as quatro chaves vão em `youtube-comment-backend/.env` (gitignored; modelo em `.env.example`).

O arquivo `config.example.js` é o modelo da configuração da extensão. **Nunca faça commit do `config.js`.**

---

## 13. Desenvolvimento com backend local

Só é necessário para **desenvolver o backend** — para apenas testar a extensão, use a produção ([Seção 2](#2-como-rodar-a-extensão-guia-de-instalação)).

```bash
cd ../youtube-comment-backend
npm install
cp .env.example .env     # preencha GROQ_API_KEY, GEMINI_API_KEY, YOUTUBE_API_KEY, DATABASE_URL

npm run dev:local        # servidor local sem `vercel dev` (não exige login na Vercel)
# ou
npm run dev:vercel       # `vercel dev` — mais fiel ao ambiente serverless
```

Depois aponte a extensão para o servidor local, em `config.js`:

```javascript
export const BACKEND_URL = 'http://localhost:3000';
```

e recarregue a extensão em `chrome://extensions/`. Lembre de voltar a URL de produção quando terminar.

### Teste rápido do endpoint (PowerShell)

```powershell
$body = '{"pergunta":"A bateria e boa?","comentarios":[{"id":"1","text":"Bateria dura o dia todo","likeCount":50}]}'
Invoke-RestMethod -Uri "http://localhost:3000/api/ask" -Method Post -ContentType "application/json" -Body $body
```

---

## 14. Testes

Os testes automatizados ficam no backend (`youtube-comment-backend/tests/`) e usam **Vitest**. A extensão não tem suíte automatizada — é validada manualmente pelo fluxo da [Seção 2](#2-como-rodar-a-extensão-guia-de-instalação).

```bash
cd ../youtube-comment-backend
npm test              # executa todos os testes uma vez
npm run test:watch    # modo watch
```

### Cobertura atual — 51 testes em 6 arquivos

- **`ask.test.ts`** — validação de input, escolha do método, modo `compare`, persistência best-effort
- **`retrieval.test.ts`** — filtro por keyword, fallback por likes, `topN`, filtro semântico e o dispatcher `selectRelevantComments`
- **`embeddings.test.ts`** — `cosineSimilarity`, `chunk`, `embedQuery`/`embedDocuments` com o cliente Gemini mockado
- **`youtube.test.ts`** — paginação, limites `MAX_PAGES`/`MAX_COMMENTS`, erro explícito em falha da API
- **`llm.test.ts`** — parsing do formato `FONTES: [...]` da resposta da Groq
- **`persistence.test.ts`** — `montarLinhas` (posições, `foi_fonte`) e `salvarInteracao` via `db.batch`

Nenhum teste faz rede: Groq, Gemini, YouTube e Neon são mockados.

---

## 15. Deploy do backend

Passo a passo completo em `youtube-comment-backend/README.md`. Resumo:

```bash
cd ../youtube-comment-backend
vercel login
vercel link
vercel --prod
```

Depois do deploy:

1. Confirme que `GROQ_API_KEY`, `GEMINI_API_KEY`, `YOUTUBE_API_KEY` e `DATABASE_URL` estão configuradas no ambiente **Production** (variáveis novas só valem para deploys novos)
2. Aplique as migrations no Neon: `npm run db:migrate`
3. Use o **domínio de produção do projeto** (`https://<projeto>.vercel.app`) em `config.js` — ele sempre aponta para o deploy promovido, então não é preciso mexer na extensão a cada deploy
4. Recarregue a extensão em `chrome://extensions/`
