# Migração da YouTube API Key para o Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover a `API_KEY` do YouTube Data API da extensão (hoje em texto puro em `config.js`) movendo a coleta de comentários para um novo endpoint `GET /api/comments` no backend Vercel, onde a chave fica como variável de ambiente segura.

**Architecture:** Novo módulo `lib/youtube.ts` no backend porta a lógica de paginação hoje em `service-worker.js` (`fetchComments`), mantendo os mesmos limites (`MAX_COMMENTS=500`, `MAX_PAGES=5`) e o mesmo shape de comentário (`id, author, text, textOriginal, likeCount, publishedAt, updatedAt`) para não exigir nenhuma mudança em `popup.js`. O CORS, hoje duplicável entre dois endpoints, é extraído para `lib/cors.ts` e reusado por `api/ask.ts` e pelo novo `api/comments.ts`. Na extensão, `service-worker.js` troca a chamada direta à YouTube Data API por `GET {BACKEND_URL}/api/comments?videoId=...`; `API_KEY` é removida de `config.js`/`config.example.js` e a permissão `googleapis.com` sai do `manifest.json`.

**Tech Stack:** TypeScript, Vercel Node functions, Vitest (backend); JavaScript vanilla ES modules, Chrome Extension MV3 (extensão). `fetch` global do Node ≥18 (já exigido em `package.json engines`) — nenhuma dependência nova.

**Spec de origem:** `docs/migracao-youtube-api-para-backend.md` (design já aprovado, agora formalizado em tasks TDD).

## Global Constraints

- CORS: apenas origens `chrome-extension://*` e `http://localhost` — mesma regra de `api/ask.ts`, não afrouxar.
- Limites de coleta inalterados: `MAX_COMMENTS = 500`, `MAX_PAGES = 5`, delay de 100ms entre páginas.
- Novo endpoint é `GET /api/comments?videoId=xxx` (não `POST`), conforme arquitetura alvo do doc de migração.
- Commits em português, sem trailer `Co-Authored-By` (ver `CLAUDE.md` de ambos os repos).
- Nenhuma mudança de comportamento em `popup.js` — o shape do comentário retornado por `/api/comments` deve ser idêntico ao que `fetchComments()` produz hoje.

---

## Estrutura de arquivos

| Arquivo | Repositório | Responsabilidade |
|---|---|---|
| `lib/cors.ts` (criar) | backend | Extrai `applyCORS` de `api/ask.ts` para reuso |
| `api/ask.ts` (editar) | backend | Passa a usar `lib/cors.ts` |
| `lib/youtube.ts` (criar) | backend | `fetchYouTubeComments(videoId, apiKey)` — paginação, mesmo shape de hoje |
| `tests/youtube.test.ts` (criar) | backend | Testes com `fetch` global mockado |
| `api/comments.ts` (criar) | backend | Handler `GET /api/comments?videoId=` |
| `vercel.json` (editar) | backend | Build + rota para `api/comments.ts` |
| `.env.example` (editar) | backend | Documenta `YOUTUBE_API_KEY` |
| `CLAUDE.md` (editar) | backend | Documenta o novo endpoint |
| `service-worker.js` (editar) | extension | Remove `fetchComments`/`API_KEY`, chama `/api/comments` |
| `config.example.js` (editar) | extension | Remove `API_KEY` |
| `config.js` (editar, gitignored) | extension | Remove `API_KEY` local |
| `manifest.json` (editar) | extension | Remove `host_permissions` de `googleapis.com` |
| `CLAUDE.md` (editar) | extension | Remove menção à chave hardcoded |
| `README.md` (editar) | extension | Atualiza diagrama, estrutura, tabela de permissões, seção de segurança |
| `docs/migracao-youtube-api-para-backend.md` (editar) | extension | Marca status como implementado |

---

## Task 1: Extrair `applyCORS` para `lib/cors.ts` (backend)

Refatoração sem mudança de comportamento — prepara o terreno para o novo endpoint reusar CORS sem duplicar código.

**Files:**
- Create: `youtube-comment-backend/lib/cors.ts`
- Modify: `youtube-comment-backend/api/ask.ts:1-21`

**Interfaces:**
- Produces: `applyCORS(req: VercelRequest, res: VercelResponse, methods: string): boolean` — `true` = preflight já respondido, handler deve retornar; `false` = seguir.

- [x] **Step 1: Criar `lib/cors.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'

export function applyCORS(req: VercelRequest, res: VercelResponse, methods: string): boolean {
  const origin = (req.headers['origin'] as string) ?? ''

  // Permite apenas extensões Chrome e localhost
  if (origin.startsWith('chrome-extension://') || origin === 'http://localhost') {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', methods)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true // preflight tratado, não continuar
  }
  return false
}
```

- [x] **Step 2: Atualizar `api/ask.ts` para usar o helper**

Substituir:
```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { selectRelevantComments } from '../lib/retrieval'
import { askGroq } from '../lib/llm'
import type { AskRequest } from '../types'

function applyCORS(req: VercelRequest, res: VercelResponse): boolean {
  const origin = (req.headers['origin'] as string) ?? ''

  // Permite apenas extensões Chrome e localhost
  if (origin.startsWith('chrome-extension://') || origin === 'http://localhost') {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true // preflight tratado, não continuar
  }
  return false
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCORS(req, res)) return
```
por:
```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCORS } from '../lib/cors'
import { selectRelevantComments } from '../lib/retrieval'
import { askGroq } from '../lib/llm'
import type { AskRequest } from '../types'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCORS(req, res, 'POST, OPTIONS')) return
```

- [x] **Step 3: Rodar a suíte completa e o lint**

Run: `npm test && npm run lint`
Expected: PASS — os 25 testes existentes continuam verdes (nenhum comportamento mudou).

- [x] **Step 4: Smoke test manual do CORS (preflight)**

Com o dev server rodando (`node --env-file=.env -r ts-node/register scripts/dev-server.ts`):
```bash
curl -s -i -X OPTIONS http://localhost:3000/api/ask \
  -H "Origin: chrome-extension://abcxyz" \
  -H "Access-Control-Request-Method: POST"
```
Expected: `HTTP/1.1 204`, header `Access-Control-Allow-Origin: chrome-extension://abcxyz` presente.

- [x] **Step 5: Commit**

```bash
git add lib/cors.ts api/ask.ts
git commit -m "refactor: extrai applyCORS para lib/cors.ts (reuso entre endpoints)"
```

---

## Task 2: `lib/youtube.ts` — paginação da YouTube Data API

**Files:**
- Create: `youtube-comment-backend/lib/youtube.ts`
- Test: `youtube-comment-backend/tests/youtube.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface YoutubeComment {
    id: string
    author: string
    text: string
    textOriginal: string
    likeCount: number
    publishedAt: string
    updatedAt: string
  }
  export interface FetchCommentsResult {
    comments: YoutubeComment[]
    totalComments: number
    pagesCollected: number
    limitReached: boolean
  }
  export async function fetchYouTubeComments(videoId: string, apiKey: string): Promise<FetchCommentsResult>
  ```
  Lança `Error` (não retorna `{success:false}`) quando a API do YouTube responde com erro — mesmo estilo de `askGroq` em `lib/llm.ts`, que também propaga exceções.

- [x] **Step 1: Escrever os testes que falham**

Criar `tests/youtube.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchYouTubeComments } from '../lib/youtube'

function makeItem(id: string, likeCount = 1) {
  return {
    id,
    snippet: {
      topLevelComment: {
        snippet: {
          authorDisplayName: 'Usuário',
          textDisplay: `texto ${id}`,
          textOriginal: `texto ${id}`,
          likeCount,
          publishedAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      },
    },
  }
}

function page(items: unknown[], nextPageToken: string | null = null) {
  return { ok: true, json: async () => ({ items, nextPageToken }) }
}

describe('fetchYouTubeComments', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('retorna comentários de uma única página', async () => {
    vi.mocked(fetch).mockResolvedValue(page([makeItem('c1', 5)]) as any)

    const result = await fetchYouTubeComments('abc123', 'fake-key')

    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]).toEqual({
      id: 'c1',
      author: 'Usuário',
      text: 'texto c1',
      textOriginal: 'texto c1',
      likeCount: 5,
      publishedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.totalComments).toBe(1)
    expect(result.pagesCollected).toBe(1)
    expect(result.limitReached).toBe(false)
  })

  it('pagina até esgotar nextPageToken', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([makeItem('a')], 'token2') as any)
      .mockResolvedValueOnce(page([makeItem('b')], null) as any)

    const result = await fetchYouTubeComments('abc123', 'fake-key')

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.comments.map(c => c.id)).toEqual(['a', 'b'])
    expect(result.pagesCollected).toBe(2)
  })

  it('para em MAX_PAGES mesmo com nextPageToken disponível', async () => {
    vi.mocked(fetch).mockImplementation(async () => page([], 'sempre-tem-mais') as any)

    const result = await fetchYouTubeComments('abc123', 'fake-key')

    expect(fetch).toHaveBeenCalledTimes(5)
    expect(result.pagesCollected).toBe(5)
    expect(result.limitReached).toBe(true)
  }, 10000)

  it('lança erro explícito quando a API do YouTube responde com erro', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'quota excedida' } }),
    } as any)

    await expect(fetchYouTubeComments('abc123', 'bad-key')).rejects.toThrow('quota excedida')
  })
})
```

- [x] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/youtube.test.ts`
Expected: FAIL — `Failed to resolve import '../lib/youtube'` (arquivo ainda não existe).

- [x] **Step 3: Implementar `fetchYouTubeComments`**

Criar `lib/youtube.ts`:
```ts
export interface YoutubeComment {
  id: string
  author: string
  text: string
  textOriginal: string
  likeCount: number
  publishedAt: string
  updatedAt: string
}

export interface FetchCommentsResult {
  comments: YoutubeComment[]
  totalComments: number
  pagesCollected: number
  limitReached: boolean
}

const MAX_COMMENTS = 500
const MAX_PAGES = 5

export async function fetchYouTubeComments(
  videoId: string,
  apiKey: string
): Promise<FetchCommentsResult> {
  const allComments: YoutubeComment[] = []
  let nextPageToken: string | null = null
  let pageCount = 0
  let totalCommentsCollected = 0

  do {
    pageCount++

    const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads')
    url.searchParams.append('part', 'snippet')
    url.searchParams.append('videoId', videoId)
    url.searchParams.append('key', apiKey)
    url.searchParams.append('maxResults', '100')
    url.searchParams.append('order', 'relevance')
    if (nextPageToken) url.searchParams.append('pageToken', nextPageToken)

    const response = await fetch(url.toString())

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        `Erro na API do YouTube: ${response.status} - ${errorData.error?.message || 'Erro desconhecido'}`
      )
    }

    const data = await response.json()

    if (data.items && data.items.length > 0) {
      const comments: YoutubeComment[] = data.items.map((item: any) => {
        const snippet = item.snippet.topLevelComment.snippet
        return {
          id: item.id,
          author: snippet.authorDisplayName,
          text: snippet.textDisplay,
          textOriginal: snippet.textOriginal,
          likeCount: snippet.likeCount,
          publishedAt: snippet.publishedAt,
          updatedAt: snippet.updatedAt,
        }
      })
      allComments.push(...comments)
      totalCommentsCollected += comments.length
    }

    nextPageToken = data.nextPageToken || null

    if (totalCommentsCollected >= MAX_COMMENTS) break
    if (pageCount >= MAX_PAGES) break

    if (nextPageToken) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } while (nextPageToken)

  return {
    comments: allComments,
    totalComments: totalCommentsCollected,
    pagesCollected: pageCount,
    limitReached: totalCommentsCollected >= MAX_COMMENTS || pageCount >= MAX_PAGES,
  }
}
```

- [x] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/youtube.test.ts`
Expected: PASS (4 testes). O teste de `MAX_PAGES` leva ~400ms de vida real por causa do delay entre páginas — normal.

- [x] **Step 5: Rodar lint**

Run: `npm run lint`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add lib/youtube.ts tests/youtube.test.ts
git commit -m "feat: adiciona fetchYouTubeComments (paginacao da YouTube Data API)"
```

---

## Task 3: Endpoint `GET /api/comments`

**Files:**
- Create: `youtube-comment-backend/api/comments.ts`
- Modify: `youtube-comment-backend/vercel.json`
- Modify: `youtube-comment-backend/.env.example`

- [x] **Step 1: Criar `api/comments.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCORS } from '../lib/cors'
import { fetchYouTubeComments } from '../lib/youtube'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCORS(req, res, 'GET, OPTIONS')) return

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  const { videoId } = req.query
  if (!videoId || typeof videoId !== 'string') {
    return res.status(400).json({ error: 'videoId é obrigatório' })
  }

  try {
    const resultado = await fetchYouTubeComments(videoId, process.env.YOUTUBE_API_KEY ?? '')
    return res.status(200).json(resultado)
  } catch (error: any) {
    return res.status(502).json({ error: `Falha ao buscar comentários do YouTube: ${error.message}` })
  }
}
```

- [x] **Step 2: Adicionar build e rota em `vercel.json`**

Substituir:
```json
{
  "builds": [
    {
      "src": "api/ask.ts",
      "use": "@vercel/node",
      "config": {
        "memory": 256,
        "maxDuration": 30
      }
    }
  ],
  "routes": [
    {
      "src": "/api/ask",
      "dest": "/api/ask.ts"
    }
  ]
}
```
por:
```json
{
  "builds": [
    {
      "src": "api/ask.ts",
      "use": "@vercel/node",
      "config": {
        "memory": 256,
        "maxDuration": 30
      }
    },
    {
      "src": "api/comments.ts",
      "use": "@vercel/node",
      "config": {
        "memory": 256,
        "maxDuration": 30
      }
    }
  ],
  "routes": [
    {
      "src": "/api/ask",
      "dest": "/api/ask.ts"
    },
    {
      "src": "/api/comments",
      "dest": "/api/comments.ts"
    }
  ]
}
```

- [x] **Step 3: Documentar `YOUTUBE_API_KEY` em `.env.example`**

Conteúdo final de `.env.example`:
```
GROQ_API_KEY=sua_chave_aqui
GEMINI_API_KEY=sua_chave_gemini_aqui
YOUTUBE_API_KEY=sua_chave_youtube_aqui
```

- [x] **Step 4: Rodar suíte completa e lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [x] **Step 5: Smoke test manual (requer `YOUTUBE_API_KEY` real no `.env` e um `videoId` válido)**

```bash
curl -s "http://localhost:3000/api/comments?videoId=SEU_VIDEO_ID_AQUI"
```
Expected: HTTP 200 com `{ comments: [...], totalComments, pagesCollected, limitReached }`. Se `YOUTUBE_API_KEY` não estiver configurada no `.env` local, pule este passo — a lógica já está coberta pelos testes determinísticos com mock.

- [x] **Step 6: Commit**

```bash
git add api/comments.ts vercel.json .env.example
git commit -m "feat: adiciona endpoint GET /api/comments (move a YouTube API key para o backend)"
```

---

## Task 4: `service-worker.js` — chamar o backend em vez da YouTube API diretamente

**Files:**
- Modify: `youtube-comment-extension/service-worker.js`

- [x] **Step 1: Remover o import de `API_KEY` e a função `fetchComments`**

Substituir a linha 1:
```js
import { API_KEY, BACKEND_URL } from './config.js';
```
por:
```js
import { BACKEND_URL } from './config.js';
```

Remover inteiramente a função `fetchComments` (linhas 8–106, do `async function fetchComments(videoId, apiKey, onProgress = null) {` até o `}` de fechamento antes de `async function callLLM`).

- [x] **Step 2: Adicionar `fetchCommentsFromBackend` no lugar**

Adicionar, no lugar onde estava `fetchComments` (acima de `callLLM`):
```js
async function fetchCommentsFromBackend(videoId, onProgress = null) {
    console.log(`Iniciando coleta de comentários para o vídeo: ${videoId}`);

    if (onProgress) {
        onProgress(1, 0);
    }

    try {
        const response = await fetch(`${BACKEND_URL}/api/comments?videoId=${encodeURIComponent(videoId)}`);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro HTTP ${response.status}`);
        }

        const data = await response.json();

        console.log(`Coleta finalizada: ${data.totalComments} comentários em ${data.pagesCollected} páginas`);

        return {
            success: true,
            videoId: videoId,
            comments: data.comments,
            totalComments: data.totalComments,
            pagesCollected: data.pagesCollected,
            limitReached: data.limitReached
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
```

> Nota: como a coleta agora é uma única chamada HTTP síncrona ao backend (sem streaming de progresso por página), `onProgress` é chamado uma única vez no início — o popup ainda mostra o estado "coletando", só não recebe mais atualizações incrementais por página. Isso é uma simplificação deliberada (ver `docs/migracao-youtube-api-para-backend.md`, seção Observações — SSE/WebSocket seria overkill para o TCC).

- [x] **Step 3: Trocar a chamada e remover a checagem de `API_KEY`**

No listener de `START_COMMENT_COLLECTION`, substituir:
```js
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
```
por:
```js
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
                
                const result = await fetchCommentsFromBackend(videoId, onProgress);
```

- [x] **Step 4: Remover o aviso de `API_KEY` no `onInstalled`**

Substituir:
```js
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('✅ Extensão YouTube Comment Q&A instalada com sucesso!');
        console.log('⚠️ Não esqueça de configurar a API_KEY no service-worker.js');
    } else if (details.reason === 'update') {
```
por:
```js
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('✅ Extensão YouTube Comment Q&A instalada com sucesso!');
    } else if (details.reason === 'update') {
```

- [ ] **Step 5: Verificação manual — carregar a extensão no Chrome**

Não há suíte de testes automatizados para a extensão (JavaScript puro, sem framework — ver `README.md` seção 15). Verificar manualmente:
1. `chrome://extensions/` → recarregar a extensão (ícone ↻).
2. Abrir um vídeo do YouTube, clicar em "Analisar Comentários".
3. Confirmar no console do service worker (`chrome://extensions/` → "Inspecionar visualizações: service worker") que a chamada vai para `{BACKEND_URL}/api/comments`, não mais para `googleapis.com`.
4. Confirmar que os comentários aparecem e que perguntar ao LLM continua funcionando.

- [x] **Step 6: Commit**

```bash
git add service-worker.js
git commit -m "feat: busca comentarios via backend (GET /api/comments) em vez da YouTube API direta"
```

---

## Task 5: Remover a chave do YouTube da configuração da extensão

**Files:**
- Modify: `youtube-comment-extension/config.example.js`
- Modify: `youtube-comment-extension/config.js` (gitignored — editar localmente, não gera commit)
- Modify: `youtube-comment-extension/manifest.json`

- [x] **Step 1: Atualizar `config.example.js`**

Substituir:
```js
export const API_KEY = '';
export const BACKEND_URL = '';
```
por:
```js
export const BACKEND_URL = '';
```

- [x] **Step 2: Atualizar `config.js` local (não commitar — arquivo gitignored)**

Substituir:
```js
export const API_KEY = 'AIzaSyAXW2IrV4EsHfoVSxTXLUDnJioUMdcUZ_w';
export const BACKEND_URL = 'http://localhost:3000';
```
por:
```js
export const BACKEND_URL = 'http://localhost:3000';
```

> A chave antiga do YouTube que estava neste arquivo deve ser considerada exposta (estava em texto puro no disco). Se ainda for válida, regenere-a no [Google Cloud Console](https://console.cloud.google.com/apis/credentials) e configure a nova como `YOUTUBE_API_KEY` nas env vars da Vercel — nunca de volta em `config.js`.

- [x] **Step 3: Remover a permissão `googleapis.com` do `manifest.json`**

Substituir:
```json
  "host_permissions": [
    "https://www.googleapis.com/*",
    "https://*.vercel.app/*"
  ],
```
por:
```json
  "host_permissions": [
    "https://*.vercel.app/*"
  ],
```

O service worker não faz mais chamadas diretas a `googleapis.com` — só ao backend.

- [ ] **Step 4: Verificação manual**

Recarregar a extensão em `chrome://extensions/` e repetir o fluxo do Task 4 Step 5. Confirmar que a extensão funciona sem a permissão de `googleapis.com`.

- [x] **Step 5: Commit**

```bash
git add config.example.js manifest.json
git commit -m "chore: remove API_KEY do YouTube da extensao e permissao googleapis.com"
```

(Note: `config.js` não entra no commit — está no `.gitignore`.)

---

## Task 6: Atualizar documentação

**Files:**
- Modify: `youtube-comment-backend/CLAUDE.md`
- Modify: `youtube-comment-extension/CLAUDE.md`
- Modify: `youtube-comment-extension/README.md`
- Modify: `youtube-comment-extension/docs/migracao-youtube-api-para-backend.md`

- [x] **Step 1: Backend `CLAUDE.md` — documentar o novo endpoint**

Adicionar ao final da seção `## Key Constraints` (ou criar se não existir mais no arquivo atual):
```markdown
## Endpoints

- `POST /api/ask` — pergunta + comentários → resposta da IA.
- `GET /api/comments?videoId=` — busca comentários de um vídeo do YouTube (a `YOUTUBE_API_KEY` fica só aqui, nunca na extensão).
```

- [x] **Step 2: Extensão `CLAUDE.md` — remover menção à chave hardcoded**

Substituir:
```markdown
- **`BACKEND_URL`**: Hardcoded in `service-worker.js` line 2. Must be updated after each new Vercel deployment URL.
- **YouTube API key**: Hardcoded in `service-worker.js` line 1 (`API_KEY`). Acceptable for TCC/academic use.
```
por:
```markdown
- **`BACKEND_URL`**: Hardcoded in `config.js` (gitignored). Must be updated after each new Vercel deployment URL.
- **YouTube API key**: Lives only in the backend as `YOUTUBE_API_KEY` (Vercel env var). The extension never sees it — comments are fetched via `GET {BACKEND_URL}/api/comments?videoId=`.
```

E na tabela de variáveis de ambiente, adicionar:
```markdown
| `YOUTUBE_API_KEY` | Vercel dashboard (never in code) | YouTube Data API authentication (used only by `/api/comments`) |
```

- [x] **Step 3: `README.md` — corrigir estrutura de repositórios (linhas 122–145)**

Substituir:
```
youtube-comment/                          ← raiz carregada no Chrome
│
├── manifest.json                         ← MV3: permissões, scripts, ícones
├── content.js                            ← injetado em *.youtube.com
├── service-worker.js                     ← background (ES module)
├── popup.html                            ← markup da UI do popup
├── popup.css                             ← estilos (preto/branco/cinza)
├── popup.js                              ← lógica do popup
│
└── youtube-comment-analysis-backend/    ← backend serverless (Vercel)
    ├── api/
    │   └── ask.ts                        ← endpoint POST /api/ask
    ├── lib/
    │   ├── retrieval.ts                  ← filtro de relevância (RAG)
    │   └── llm.ts                        ← integração Groq + parser
    ├── tests/
    │   ├── retrieval.test.ts             ← testes do filtro RAG
    │   └── llm.test.ts                   ← testes do parseResponse
    ├── types.ts                          ← interfaces TypeScript compartilhadas
    ├── package.json
    ├── tsconfig.json
    └── vercel.json                       ← configuração de deploy
```
por:
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

- [x] **Step 4: `README.md` — atualizar tabela de `host_permissions` (linha 160)**

Substituir:
```
| `host_permissions` | `googleapis.com`, `*.vercel.app` | Requisições externas no MV3 precisam de declaração |
```
por:
```
| `host_permissions` | `*.vercel.app` | Requisições externas no MV3 precisam de declaração (a extensão não fala mais direto com `googleapis.com`) |
```

- [x] **Step 5: `README.md` — atualizar descrição do `service-worker.js` (linhas 179–194)**

Substituir:
```
| `START_COMMENT_COLLECTION` | Chama YouTube Data API em loop paginado |
| `ASK_LLM` | Faz `POST /api/ask` no backend e repassa resposta |

**Coleta de comentários** (`fetchComments`):
- Endpoint: `GET /youtube/v3/commentThreads?part=snippet&order=relevance`
- Paginação de 100 em 100, máximo 5 páginas (500 comentários)
- Delay de 100 ms entre páginas para evitar rate limiting
- Emite `COLLECTING_STATUS` a cada página para atualizar o progresso no popup

**Chamada ao backend** (`callLLM`):
- Serializa a pergunta e os comentários em JSON
- `POST /api/ask` com `Content-Type: application/json`
- Retorna `{ resposta: string, comentarios_fonte: Comment[] }`

> **Atenção**: `BACKEND_URL` (linha 2) e `API_KEY` da YouTube (linha 1) são constantes hardcoded. Atualize `BACKEND_URL` após cada novo deploy na Vercel.
```
por:
```
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
```

- [x] **Step 6: `README.md` — atualizar seção de segurança (linhas 401, 409–411)**

Substituir:
```
A `GROQ_API_KEY` nunca aparece no código — existe apenas como variável de ambiente na Vercel (dashboard) e no arquivo `.env.local` local (gitignored). A chave da YouTube Data API fica em `config.js` (gitignored) e nunca é versionada.
```
por:
```
A `GROQ_API_KEY` e a `YOUTUBE_API_KEY` nunca aparecem no código — existem apenas como variáveis de ambiente na Vercel (dashboard) e no `.env` local do backend (gitignored). A extensão não guarda nenhuma chave de API.
```

Substituir:
```
| `GROQ_API_KEY` | Vercel dashboard → Environment Variables | Autenticação na API Groq |
| `GROQ_API_KEY` (local) | `youtube-comment-analysis-backend/.env.local` | Para desenvolvimento local |
| `API_KEY` | `config.js` (extensão) | Chave da YouTube Data API v3 |
```
por:
```
| `GROQ_API_KEY` | Vercel dashboard → Environment Variables | Autenticação na API Groq |
| `YOUTUBE_API_KEY` | Vercel dashboard → Environment Variables | Autenticação na YouTube Data API v3 (usada só por `/api/comments`) |
| `GROQ_API_KEY`, `YOUTUBE_API_KEY` (local) | `youtube-comment-backend/.env` | Para desenvolvimento local |
```

- [x] **Step 7: Marcar `docs/migracao-youtube-api-para-backend.md` como implementado**

Substituir a primeira linha:
```
**Status:** Pendente — não implementar ainda  
```
por:
```
**Status:** ✅ Implementado (2026-07-01) — ver `docs/superpowers/plans/2026-07-01-migracao-youtube-api-key.md`
```

- [x] **Step 8: Commit (um commit por repositório)**

```bash
# no youtube-comment-backend
git add CLAUDE.md
git commit -m "docs: documenta endpoint GET /api/comments no CLAUDE.md"

# no youtube-comment-extension
git add CLAUDE.md README.md docs/migracao-youtube-api-para-backend.md
git commit -m "docs: atualiza documentacao apos migracao da youtube api key"
```

---

## Verificação final (após todas as tasks)

- [x] Backend: `npm test` → toda a suíte verde (incluindo os 4 testes novos de `youtube.test.ts`).
- [x] Backend: `npm run lint` → sem erros de tipo.
- [ ] Extensão carregada em modo unpacked funciona ponta a ponta: coletar comentários → perguntar → ver resposta com fontes. **Não verificado — sem acesso a navegador neste ambiente.**
- [x] `config.js` local não contém mais `API_KEY` do YouTube.
- [x] `manifest.json` não declara mais `host_permissions` para `googleapis.com`.
- [x] Atualizar a memória do projeto sobre esta migração (estava marcada como "pendente, não implementar ainda").

**Ações manuais fora do escopo deste plano (requerem acesso ao dashboard da Vercel — não automatizadas aqui):**
- [ ] Adicionar `YOUTUBE_API_KEY` nas env vars do projeto na Vercel.
- [ ] Rodar `vercel --prod` para publicar `/api/comments` em produção.
- [ ] Confirmar que `BACKEND_URL` em `config.js` aponta para a URL de produção correta.
