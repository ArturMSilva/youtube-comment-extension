# Design Spec — YouTube Comment Q&A (TCC)
**Data:** 2026-05-27  
**Status:** Aprovado

---

## 1. Visão Geral

Extensão de navegador Chrome que permite ao usuário fazer perguntas em linguagem natural sobre os comentários de um vídeo do YouTube e receber:
- Uma resposta gerada por LLM (Groq)
- 2–3 comentários reais que embasaram a resposta

**Público-alvo:** consumidores que querem extrair insights de reviews de produtos sem ler centenas de comentários.

---

## 2. Arquitetura

```
[Chrome Extension]
  content.js        → extrai videoId da URL, monitora navegação
  service-worker.js → coleta comentários via YouTube Data API v3
  popup.js          → orquestra UI e comunicação
  popup.html/css    → interface do usuário
        │
        │  POST /ask  { pergunta, comentarios[] }
        ▼
[Backend — Hono (TypeScript) na Vercel]
  api/ask.ts        → endpoint /ask, CORS, orquestração
  lib/retrieval.ts  → filtro de comentários relevantes (RAG simples)
  lib/llm.ts        → integração Groq (llama-3.3-70b-versatile)
  types.ts          → contratos compartilhados (AskRequest, AskResponse, Comment)
        │
        │  Groq API (GROQ_API_KEY — só no servidor)
        ▼
[Resposta]  { resposta: string, comentarios_fonte: Comment[] }
```

### Componentes e responsabilidades

| Componente | Responsabilidade |
|---|---|
| `content.js` | Extrai `videoId` da URL; monitora SPA navigation do YouTube |
| `service-worker.js` | Coleta comentários paginados via YouTube Data API (até 500); repassa pergunta+comentários ao backend |
| `popup.html/css` | UI em dois estados: pré-análise e pós-análise com resposta+fontes |
| `popup.js` | Gerencia estado da UI, lê storage local, exibe resposta e comentários-fonte |
| `backend/api/ask.ts` | Recebe requisição, aplica CORS, orquestra retrieval + LLM, retorna JSON |
| `backend/lib/retrieval.ts` | Filtra os comentários mais relevantes para a pergunta (busca por keywords) |
| `backend/lib/llm.ts` | Monta prompt e chama Groq; parseia resposta + índices das fontes |
| `backend/types.ts` | Tipos TypeScript compartilhados: `Comment`, `AskRequest`, `AskResponse` |

---

## 3. Fluxo de Dados Detalhado

### 3.1 Coleta de comentários (já implementado, ajustes menores)
1. Usuário abre popup → `popup.js` pergunta ao `content.js` o `videoId`
2. `popup.js` envia `START_COMMENT_COLLECTION` ao `service-worker.js`
3. `service-worker.js` chama YouTube Data API v3 (paginado, até 500 comentários)
4. Comentários armazenados em `chrome.storage.local` e em memória no popup

### 3.2 Pergunta e resposta (a ser implementado)
1. Usuário digita pergunta e clica "Perguntar" (ou `Ctrl+Enter`)
2. `popup.js` envia `ASK_LLM` ao `service-worker.js` com `{ pergunta, comentarios[] }`
3. `service-worker.js` faz `POST https://<vercel-url>/ask` com o payload
4. Backend executa:
   - `lib/retrieval.ts`: filtra os 30 comentários mais relevantes por score de keywords
   - `lib/llm.ts`: monta prompt → chama Groq → parseia resposta + fontes
5. Backend retorna `{ resposta, comentarios_fonte[] }`
6. `service-worker.js` envia `LLM_RESPONSE` ao popup
7. `popup.js` renderiza resposta + seção "Comentários que confirmam"

---

## 4. Interface do Usuário

### Estado 1 — Pré-análise
- Header com gradiente roxo/azul e ícone de chat
- Botão "Analisar Comentários"
- Área de status (mensagem de progresso durante coleta)

### Estado 2 — Pronto para perguntas
- Header mostra contador de comentários coletados (ex: "487 comentários")
- Textarea para a pergunta
- Botão "Perguntar" + atalho `Ctrl+Enter`
- **Seção de resposta:** caixa branca com texto do LLM
- **Seção "Comentários que confirmam":** 2–3 cards com borda azul lateral, texto do comentário e contagem de likes

### Mudanças no código de UI
| Arquivo | Mudança |
|---|---|
| `manifest.json` | Adicionar permissões `tabs` e `storage` |
| `popup.html` | Adicionar seção `#source-comments` após `#llm-response` |
| `popup.css` | Adicionar estilo `.comment-source` (card com borda azul) |
| `popup.js` | Renderizar `comentarios_fonte[]` na seção nova; adicionar `Ctrl+Enter` |
| `service-worker.js` | Substituir `callLLM()` simulado por `fetch()` real ao backend |

---

## 5. Backend TypeScript (Hono + Vercel)

### Estrutura de arquivos
```
backend/
  api/
    ask.ts         # Hono app exportado como handler Vercel — endpoint POST /ask
  lib/
    retrieval.ts   # Filtro de comentários relevantes por keywords
    llm.ts         # Integração Groq: monta prompt, parseia resposta e fontes
  types.ts         # Tipos compartilhados: Comment, AskRequest, AskResponse
  vercel.json      # { "rewrites": [{ "source": "/ask", "destination": "/api/ask" }] }
  package.json     # hono, groq-sdk, @vercel/node
  tsconfig.json
  .env.local       # GROQ_API_KEY (nunca commitar)
```

### Tipos compartilhados (`types.ts`)
```typescript
export interface Comment {
  id: string
  text: string
  likeCount: number
}

export interface AskRequest {
  pergunta: string
  comentarios: Comment[]
}

export interface AskResponse {
  resposta: string
  comentarios_fonte: Comment[]
}
```

### Endpoint `POST /ask` (`api/ask.ts`)
```typescript
import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import { cors } from 'hono/cors'
import { filterRelevantComments } from '../lib/retrieval'
import { askGroq } from '../lib/llm'
import type { AskRequest, AskResponse } from '../types'

const app = new Hono().basePath('/')

app.use('*', cors({ origin: ['chrome-extension://*', 'http://localhost'] }))

app.post('/ask', async (c) => {
  const { pergunta, comentarios } = await c.req.json<AskRequest>()
  const relevantes = filterRelevantComments(pergunta, comentarios, 30)
  const resultado = await askGroq(pergunta, relevantes)
  return c.json<AskResponse>(resultado)
})

export default handle(app)
```

### Estratégia RAG simples (`lib/retrieval.ts`)
1. Tokenizar a pergunta em keywords (palavras com > 3 chars, lowercase)
2. Pontuar cada comentário: `score = Σ ocorrências de keyword no texto`
3. Selecionar os top-N por score (fallback: top-N por `likeCount` se nenhum match)
4. Retornar array ordenado para o LLM

### Prompt ao Groq (`lib/llm.ts`)
```
Você é um assistente que analisa comentários de vídeos do YouTube sobre reviews de produtos.

Comentários dos usuários:
[1] "texto do comentário" (X likes)
[2] "texto do comentário" (X likes)
...

Pergunta: {pergunta}

Responda em português de forma concisa (2-4 frases).
Ao final, indique os números dos comentários que embasaram sua resposta no formato:
FONTES: [1, 3, 7]
```

O parser em `lib/llm.ts` extrai `FONTES: [...]` da resposta para montar `comentarios_fonte[]`.

### Modelo Groq
- Primário: `llama-3.3-70b-versatile` (128k contexto, alta qualidade)
- Fallback: `mixtral-8x7b-32768` (se rate limit)

---

## 6. Segurança

| Risco | Solução |
|---|---|
| Chave Groq exposta | Fica apenas em variável de ambiente na Vercel (`GROQ_API_KEY`), nunca no código da extensão |
| Chave YouTube exposta | Permanece no `service-worker.js` (API pública, quota limitada — risco aceitável para TCC) |
| CORS aberto demais | Backend configura `hono/cors` aceitando apenas origens `chrome-extension://` e `localhost` |
| Injeção de prompt | Sanitizar pergunta do usuário (truncar em 500 chars, remover quebras excessivas) antes de montar o prompt |

---

## 7. Tratamento de Erros

| Cenário | Comportamento |
|---|---|
| Não está em vídeo do YouTube | Popup mostra "Navegue até um vídeo do YouTube" |
| YouTube API sem quota | Mensagem: "Limite de comentários atingido" |
| Backend inacessível | Mensagem: "Serviço temporariamente indisponível, tente novamente" |
| Groq rate limit | Retry automático com `mixtral-8x7b-32768`; se falhar, mensagem ao usuário |
| Pergunta vazia | Botão desabilitado até ter texto |
| Nenhum comentário coletado | "Analise um vídeo primeiro" |

---

## 8. Deploy

### Backend — Vercel (free tier)
1. Criar repositório GitHub para o `backend/`
2. Importar o projeto na Vercel (zero-config para projetos TypeScript/Node.js)
3. Definir variável de ambiente `GROQ_API_KEY` no painel da Vercel
4. URL gerada (ex: `https://youtube-qa-backend.vercel.app`) vai para `BACKEND_URL` no `service-worker.js`

> **Vantagem sobre Render:** Vercel não hiberna Serverless Functions — a primeira requisição responde em < 1s mesmo após período de inatividade.

### Extensão — instalação local (para TCC)
- Carregar como extensão não-empacotada no Chrome (modo desenvolvedor)
- Não requer publicação na Chrome Web Store para fins de TCC

---

## 9. Testes

| Tipo | O que testar |
|---|---|
| Integração E2E | Abrir vídeo → analisar → fazer pergunta → ver resposta + fontes |
| Modelos diferentes | Trocar modelo Groq e comparar qualidade da resposta |
| Vídeos variados | Reviews de diferentes produtos (celular, headphone, notebook) |
| Casos extremos | Vídeo sem comentários, pergunta sem relação com o conteúdo, comentários em inglês |
| Tempo de resposta | Medir latência do backend (objetivo: < 5s) |

---

## 10. O que NÃO está no escopo

- Publicação na Chrome Web Store
- Suporte a outros idiomas além do português
- Análise de respostas a comentários (apenas top-level)
- Modo offline / sem backend
- Histórico de sessões persistente entre fechamentos do popup
- Dark mode
- Estatísticas visuais de sentimento
