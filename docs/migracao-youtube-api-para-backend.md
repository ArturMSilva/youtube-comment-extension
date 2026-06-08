# Migração: YouTube API Key para o Backend

**Status:** Pendente — não implementar ainda  
**Motivação:** A `API_KEY` do YouTube atualmente fica exposta na extensão (`config.js`), visível para qualquer usuário que inspecione os arquivos locais ou o tráfego de rede. A solução é mover todas as chamadas à YouTube Data API para o backend Vercel, onde a chave fica como variável de ambiente segura.

---

## Arquitetura Atual

```
Extensão (config.js)
    └── API_KEY (exposta)
         └──► YouTube Data API /commentThreads
                    │
                    ▼
              comentários
                    │
                    ▼
         POST /api/ask (Vercel)
              └── GROQ_API_KEY (segura, env var)
```

A extensão chama o YouTube diretamente com a chave em texto puro.

---

## Arquitetura Alvo

```
Extensão (sem API_KEY)
    └──► POST /api/comments?videoId=xxx  (Vercel)
              └── YOUTUBE_API_KEY (segura, env var)
                       └──► YouTube Data API /commentThreads
                                   │
                                   ▼
                             comentários
                                   │
                                   ▼
         POST /api/ask (Vercel) ◄──┘
              └── GROQ_API_KEY (segura, env var)
```

A extensão nunca toca na chave do YouTube. Tudo passa pelo backend.

---

## O Que Muda

### Backend (`youtube-comment-analysis-backend/`)

**1. Novo endpoint: `api/comments.ts`**

Responsável por buscar os comentários do YouTube usando a chave guardada no servidor.

```typescript
// api/comments.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY!;
const MAX_COMMENTS = 500;
const MAX_PAGES = 5;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Mesma lógica CORS já usada em api/ask.ts
  const origin = req.headers.origin || '';
  const allowed = origin.startsWith('chrome-extension://') || origin.startsWith('http://localhost');
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { videoId } = req.query;
  if (!videoId || typeof videoId !== 'string') {
    return res.status(400).json({ error: 'videoId obrigatório' });
  }

  // Mover aqui a lógica de fetchComments() que hoje está em service-worker.js
  // ...
  
  res.setHeader('Access-Control-Allow-Origin', origin);
  return res.status(200).json({ comments, totalComments, pagesCollected, limitReached });
}
```

**2. Nova variável de ambiente em `vercel.json` (documentar, não commitar o valor)**

```json
{
  "env": {
    "YOUTUBE_API_KEY": "@youtube-api-key"
  }
}
```

Adicionar `YOUTUBE_API_KEY` no dashboard da Vercel (Settings → Environment Variables).

**3. Atualizar `.env.local` de desenvolvimento**

```
GROQ_API_KEY=...
YOUTUBE_API_KEY=...   ← nova linha
```

### Extensão (`youtube-comment/`)

**1. `service-worker.js` — remover `fetchComments()` e substituir por chamada ao backend**

Antes:
```js
import { API_KEY, BACKEND_URL } from './config.js';
// ...
const result = await fetchComments(videoId, API_KEY, onProgress);
```

Depois:
```js
import { BACKEND_URL } from './config.js';  // API_KEY removida
// ...
const response = await fetch(`${BACKEND_URL}/api/comments?videoId=${videoId}`);
const result = await response.json();
```

A função `fetchComments()` inteira (linhas 8–106 de `service-worker.js`) pode ser removida.

**2. `config.example.js` — remover `API_KEY`**

Antes:
```js
export const API_KEY = '';
export const BACKEND_URL = '';
```

Depois:
```js
export const BACKEND_URL = '';
```

**3. `config.js` local (gitignored) — idem**

Remover a linha `API_KEY` do arquivo local de quem desenvolve.

---

## Checklist de Implementação

Quando chegar a hora:

- [ ] Criar `api/comments.ts` no backend com a lógica de paginação migrada de `service-worker.js`
- [ ] Adicionar `YOUTUBE_API_KEY` nas env vars da Vercel (dashboard)
- [ ] Adicionar `YOUTUBE_API_KEY` no `.env.local` para dev local
- [ ] Escrever testes em `tests/comments.test.ts` (seguir padrão de `retrieval.test.ts`)
- [ ] Atualizar `service-worker.js`: remover `API_KEY` import e função `fetchComments()`
- [ ] Atualizar `config.example.js` e `config.js` local: remover `API_KEY`
- [ ] Fazer deploy no Vercel e atualizar `BACKEND_URL` em `config.js`
- [ ] Testar na extensão carregada em modo unpacked
- [ ] Atualizar `CLAUDE.md`: remover menção à YouTube API key hardcoded

---

## Observações

- O endpoint `/api/comments` deve reusar exatamente a mesma lógica de paginação, limites (`MAX_COMMENTS = 500`, `MAX_PAGES = 5`) e mapeamento de campos que hoje está em `fetchComments()` no service worker.
- O progresso de coleta (mensagens `COLLECTING_STATUS`) pode ser simplificado para retornar tudo de uma vez, já que a extensão não poderá mais receber atualizações incrementais de um fetch síncrono. Alternativa: usar Server-Sent Events ou WebSocket, mas isso é overkill para um TCC.
- Manter CORS restrito a `chrome-extension://` e `http://localhost`, igual ao endpoint `/api/ask`.
