# YouTube Comment Q&A — Plano de Implementação

> **Para agentes:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar este plano task por task. Steps usam sintaxe checkbox (`- [ ]`) para rastreamento.

**Goal:** Completar o YouTube Comment Q&A com um backend TypeScript na Vercel que chama o Groq (LLM real), e atualizar a extensão Chrome para exibir resposta gerada + comentários-fonte que a embasam.

**Architecture:** A extensão coleta comentários via YouTube Data API e os envia ao backend. O backend filtra os mais relevantes por keyword matching (RAG simples), monta um prompt estruturado e chama o Groq (llama-3.3-70b-versatile). A resposta retorna como `{ resposta, comentarios_fonte[] }` e é exibida na popup com cards estilizados.

**Tech Stack:** TypeScript 5, `@vercel/node`, `groq-sdk`, Vitest — backend. Chrome Extension Manifest V3, HTML/CSS/JS vanilla — frontend.

---

## Mapa de Arquivos

**Criar (backend):**
```
backend/
  api/ask.ts          ← endpoint POST /ask (handler Vercel)
  lib/retrieval.ts    ← filtro de comentários por keyword
  lib/llm.ts          ← integração Groq + parser de resposta
  tests/retrieval.test.ts
  tests/llm.test.ts
  types.ts            ← Comment, AskRequest, AskResponse
  package.json
  tsconfig.json
  vercel.json
  .gitignore
  .env.local          ← GROQ_API_KEY (nunca commitar)
```

**Modificar (extensão):**
```
manifest.json         ← adicionar permissões tabs, storage e host vercel
service-worker.js     ← substituir callLLM() simulado por fetch real
popup.html            ← adicionar seção #source-comments
popup.css             ← adicionar estilos .comment-source
popup.js              ← renderizar fontes, Ctrl+Enter, limpar estado
```

---

## Task 1: Criar estrutura do backend

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/vercel.json`
- Create: `backend/.gitignore`
- Create: `backend/.env.local`

- [ ] **Criar as pastas necessárias:**

```bash
mkdir -p backend/api backend/lib backend/tests
```

- [ ] **Criar `backend/package.json`:**

```json
{
  "name": "youtube-qa-backend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "groq-sdk": "^0.7.0"
  },
  "devDependencies": {
    "@vercel/node": "^3.2.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Criar `backend/tsconfig.json`:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Criar `backend/vercel.json`:**

```json
{
  "functions": {
    "api/ask.ts": {
      "memory": 256,
      "maxDuration": 30
    }
  }
}
```

- [ ] **Criar `backend/.gitignore`:**

```
node_modules/
dist/
.env.local
.env
.vercel/
```

- [ ] **Criar `backend/.env.local`** (substitua com sua chave real):

```
GROQ_API_KEY=sua_chave_aqui
```

> Obter a chave em: https://console.groq.com/keys — o plano gratuito oferece 14.400 requisições/dia.

---

## Task 2: Definir tipos compartilhados

**Files:**
- Create: `backend/types.ts`

- [ ] **Criar `backend/types.ts`:**

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

---

## Task 3: Implementar retrieval.ts com testes (TDD)

**Files:**
- Create: `backend/tests/retrieval.test.ts`
- Create: `backend/lib/retrieval.ts`

- [ ] **Escrever o teste primeiro em `backend/tests/retrieval.test.ts`:**

```typescript
import { describe, it, expect } from 'vitest'
import { filterRelevantComments } from '../lib/retrieval'
import type { Comment } from '../types'

const mockComments: Comment[] = [
  { id: '1', text: 'A bateria dura o dia todo muito boa', likeCount: 100 },
  { id: '2', text: 'Tela muito bonita e brilhante', likeCount: 50 },
  { id: '3', text: 'Bateria melhorou bastante nessa versão', likeCount: 80 },
  { id: '4', text: 'Câmera excelente tira fotos lindas', likeCount: 200 },
]

describe('filterRelevantComments', () => {
  it('retorna apenas comentários com keywords da pergunta', () => {
    const result = filterRelevantComments('como está a bateria', mockComments, 10)
    const ids = result.map(c => c.id)
    expect(ids).toContain('1')
    expect(ids).toContain('3')
    expect(ids).not.toContain('2')
    expect(ids).not.toContain('4')
  })

  it('faz fallback para top por likes quando nenhum match', () => {
    const result = filterRelevantComments('processador velocidade', mockComments, 2)
    expect(result).toHaveLength(2)
    expect(result[0].likeCount).toBe(200)
    expect(result[1].likeCount).toBe(100)
  })

  it('respeita o limite topN', () => {
    const result = filterRelevantComments('bateria tela câmera', mockComments, 2)
    expect(result).toHaveLength(2)
  })

  it('retorna array vazio quando comentarios está vazio', () => {
    const result = filterRelevantComments('bateria', [], 10)
    expect(result).toHaveLength(0)
  })
})
```

- [ ] **Instalar dependências e rodar o teste para confirmar que falha:**

```bash
cd backend && npm install && npm test
```

Esperado: FAIL — `Cannot find module '../lib/retrieval'`

- [ ] **Criar `backend/lib/retrieval.ts`:**

```typescript
import type { Comment } from '../types'

export function filterRelevantComments(
  pergunta: string,
  comentarios: Comment[],
  topN: number = 30
): Comment[] {
  if (comentarios.length === 0) return []

  const keywords = pergunta
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3)

  if (keywords.length === 0) {
    return [...comentarios]
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, topN)
  }

  const scored = comentarios.map(comment => {
    const text = comment.text.toLowerCase()
    const score = keywords.reduce((sum, kw) => {
      const matches = (text.match(new RegExp(kw, 'g')) || []).length
      return sum + matches
    }, 0)
    return { comment, score }
  })

  const withMatches = scored.filter(s => s.score > 0)

  if (withMatches.length === 0) {
    return [...comentarios]
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, topN)
  }

  return withMatches
    .sort((a, b) => b.score - a.score || b.comment.likeCount - a.comment.likeCount)
    .slice(0, topN)
    .map(s => s.comment)
}
```

- [ ] **Rodar o teste para confirmar que passa:**

```bash
npm test
```

Esperado: `4 tests passed`

---

## Task 4: Implementar llm.ts com testes (TDD)

**Files:**
- Create: `backend/tests/llm.test.ts`
- Create: `backend/lib/llm.ts`

- [ ] **Escrever o teste primeiro em `backend/tests/llm.test.ts`:**

```typescript
import { describe, it, expect } from 'vitest'
import { parseResponse } from '../lib/llm'
import type { Comment } from '../types'

const mockComments: Comment[] = [
  { id: '1', text: 'Bateria dura o dia todo', likeCount: 100 },
  { id: '2', text: 'Tela é excelente', likeCount: 50 },
  { id: '3', text: 'Muito rápido no dia a dia', likeCount: 80 },
]

describe('parseResponse', () => {
  it('extrai resposta e fontes corretamente', () => {
    const raw = 'A bateria é excelente e dura o dia todo.\nFONTES: [1, 3]'
    const result = parseResponse(raw, mockComments)
    expect(result.resposta.trim()).toBe('A bateria é excelente e dura o dia todo.')
    expect(result.comentarios_fonte).toHaveLength(2)
    expect(result.comentarios_fonte[0].id).toBe('1')
    expect(result.comentarios_fonte[1].id).toBe('3')
  })

  it('retorna fontes vazias quando FONTES não está na resposta', () => {
    const raw = 'A bateria é boa.'
    const result = parseResponse(raw, mockComments)
    expect(result.resposta.trim()).toBe('A bateria é boa.')
    expect(result.comentarios_fonte).toHaveLength(0)
  })

  it('ignora índices fora do range da lista de comentários', () => {
    const raw = 'Boa.\nFONTES: [1, 99]'
    const result = parseResponse(raw, mockComments)
    expect(result.comentarios_fonte).toHaveLength(1)
    expect(result.comentarios_fonte[0].id).toBe('1')
  })

  it('remove a linha FONTES do texto da resposta exibida', () => {
    const raw = 'Resposta aqui.\nFONTES: [2]'
    const result = parseResponse(raw, mockComments)
    expect(result.resposta).not.toContain('FONTES')
  })
})
```

- [ ] **Rodar o teste para confirmar que falha:**

```bash
npm test
```

Esperado: FAIL — `Cannot find module '../lib/llm'`

- [ ] **Criar `backend/lib/llm.ts`:**

```typescript
import Groq from 'groq-sdk'
import type { Comment, AskResponse } from '../types'

const PRIMARY_MODEL = 'llama-3.3-70b-versatile'
const FALLBACK_MODEL = 'mixtral-8x7b-32768'

function buildPrompt(pergunta: string, comentarios: Comment[]): string {
  const lista = comentarios
    .map((c, i) => `[${i + 1}] "${c.text}" (${c.likeCount} likes)`)
    .join('\n')

  return `Você é um assistente que analisa comentários de vídeos do YouTube sobre reviews de produtos.

Comentários dos usuários:
${lista}

Pergunta: ${pergunta}

Responda em português de forma concisa (2-4 frases).
Ao final, indique os números dos comentários que embasaram sua resposta no formato:
FONTES: [1, 3, 7]`
}

export function parseResponse(raw: string, comentarios: Comment[]): AskResponse {
  const fontesMatch = raw.match(/FONTES:\s*\[([^\]]+)\]/)
  const resposta = raw.replace(/FONTES:.*$/s, '').trim()

  let comentarios_fonte: Comment[] = []
  if (fontesMatch) {
    const indices = fontesMatch[1]
      .split(',')
      .map(s => parseInt(s.trim(), 10) - 1) // 1-based → 0-based
      .filter(i => i >= 0 && i < comentarios.length)
    comentarios_fonte = indices.map(i => comentarios[i])
  }

  return { resposta, comentarios_fonte }
}

export async function askGroq(pergunta: string, comentarios: Comment[]): Promise<AskResponse> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const prompt = buildPrompt(pergunta, comentarios)

  const tryModel = async (model: string): Promise<string> => {
    const completion = await groq.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1024,
    })
    return completion.choices[0]?.message?.content ?? ''
  }

  let raw: string
  try {
    raw = await tryModel(PRIMARY_MODEL)
  } catch (error: any) {
    if (error?.status === 429) {
      // Rate limit no modelo primário: tenta o fallback
      raw = await tryModel(FALLBACK_MODEL)
    } else {
      throw error
    }
  }

  return parseResponse(raw, comentarios)
}
```

- [ ] **Rodar todos os testes para confirmar que passam:**

```bash
npm test
```

Esperado: `8 tests passed` (4 retrieval + 4 llm)

---

## Task 5: Implementar o endpoint POST /ask

**Files:**
- Create: `backend/api/ask.ts`

- [ ] **Criar `backend/api/ask.ts`:**

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { filterRelevantComments } from '../lib/retrieval'
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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  const body = req.body as AskRequest

  if (!body?.pergunta?.trim()) {
    return res.status(400).json({ error: 'pergunta é obrigatória' })
  }
  if (!Array.isArray(body?.comentarios) || body.comentarios.length === 0) {
    return res.status(400).json({ error: 'comentarios não pode estar vazio' })
  }

  const sanitized = body.pergunta.slice(0, 500) // previne prompt injection por tamanho
  const relevantes = filterRelevantComments(sanitized, body.comentarios, 30)
  const resultado = await askGroq(sanitized, relevantes)

  return res.status(200).json(resultado)
}
```

> **Nota:** usamos `@vercel/node` diretamente em vez de um framework de rotas (como Hono), pois com um único endpoint o roteador seria desnecessário e adicionaria complexidade sem benefício.

---

## Task 6: Testar o backend localmente

**Files:** nenhum novo

- [ ] **Instalar a Vercel CLI globalmente** (se ainda não tiver):

```bash
npm i -g vercel
```

- [ ] **Autenticar:**

```bash
vercel login
```

- [ ] **Iniciar o servidor de desenvolvimento dentro de `backend/`:**

```bash
cd backend
vercel dev
```

Esperado: `Ready! Available at http://localhost:3000`

- [ ] **Em outro terminal, testar o endpoint com um payload real:**

```bash
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d "{\"pergunta\":\"A bateria é boa?\",\"comentarios\":[{\"id\":\"1\",\"text\":\"A bateria dura o dia todo, muito satisfeito\",\"likeCount\":142},{\"id\":\"2\",\"text\":\"Tela excelente mas bateria um pouco fraca\",\"likeCount\":89},{\"id\":\"3\",\"text\":\"Bateria melhorou muito em comparação ao modelo anterior\",\"likeCount\":56}]}"
```

Esperado: JSON com campos `resposta` (string, 2-4 frases em português) e `comentarios_fonte` (array com 1-3 comentários).

---

## Task 7: Deploy na Vercel

**Files:** nenhum novo

- [ ] **Dentro de `backend/`, fazer o deploy de produção:**

```bash
cd backend
vercel --prod
```

Vercel irá detectar o projeto automaticamente. Ao final exibe a URL (ex: `https://youtube-qa-backend.vercel.app`). **Salve essa URL.**

- [ ] **Adicionar a variável de ambiente no painel da Vercel:**

Acessar: https://vercel.com/dashboard → seu projeto → **Settings → Environment Variables**

| Name | Value | Environments |
|---|---|---|
| `GROQ_API_KEY` | `gsk_...` (sua chave do Groq) | Production, Preview |

- [ ] **Fazer redeploy para aplicar a variável:**

```bash
vercel --prod
```

- [ ] **Validar o deploy em produção:**

```bash
curl -X POST https://SEU-PROJETO.vercel.app/api/ask \
  -H "Content-Type: application/json" \
  -d "{\"pergunta\":\"A câmera é boa?\",\"comentarios\":[{\"id\":\"1\",\"text\":\"Câmera incrível, fotos muito nítidas\",\"likeCount\":200},{\"id\":\"2\",\"text\":\"Câmera melhorou bastante no modo noturno\",\"likeCount\":150}]}"
```

Esperado: mesmo JSON de resposta com `resposta` e `comentarios_fonte`.

---

## Task 8: Corrigir manifest.json e atualizar service-worker.js

**Files:**
- Modify: `manifest.json`
- Modify: `service-worker.js`

- [ ] **Substituir o conteúdo completo de `manifest.json`:**

```json
{
  "manifest_version": 3,
  "name": "YouTube Comment Q&A",
  "version": "1.0.0",
  "description": "Analise comentários de vídeos do YouTube para responder perguntas",
  "action": {
    "default_popup": "popup.html"
  },
  "permissions": [
    "activeTab",
    "scripting",
    "tabs",
    "storage"
  ],
  "host_permissions": [
    "https://www.googleapis.com/*",
    "https://*.vercel.app/*"
  ],
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["*://*.youtube.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

> `tabs` e `storage` estavam ausentes (causavam erros silenciosos). `https://*.vercel.app/*` libera chamadas ao backend.

- [ ] **Em `service-worker.js`, adicionar `BACKEND_URL` logo após a linha `const API_KEY`** (linha 1):

```javascript
// Linha 1 — mantém a existente:
const API_KEY = '<CHAVE-REMOVIDA-REVOGADA>';

// Adicionar logo abaixo:
const BACKEND_URL = 'https://SEU-PROJETO.vercel.app'; // ← substitua pela URL do seu deploy
const MAX_COMMENTS = 500;
const MAX_PAGES = 5;
```

> Remova a linha `const MAX_COMMENTS` e `const MAX_PAGES` antigas (linhas 2 e 3) para não duplicar.

- [ ] **Substituir a função `callLLM` inteira** (linhas 107–154 no arquivo original) por:

```javascript
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
```

- [ ] **No handler `ASK_LLM` do `service-worker.js`** (bloco `if (message.type === 'ASK_LLM')`), localizar o `chrome.runtime.sendMessage` com `type: 'LLM_RESPONSE'` e atualizar os campos enviados:

```javascript
// ANTES:
chrome.runtime.sendMessage({
    type: 'LLM_RESPONSE',
    response: response,
    question: question,
    videoId: videoId
}, () => { ... });
```

```javascript
// DEPOIS:
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
```

- [ ] **No mesmo handler**, localizar `sendResponse({ success: true, response: response })` e atualizar:

```javascript
// ANTES:
sendResponse({ success: true, response: response });

// DEPOIS:
sendResponse({ success: true, resposta: response.resposta });
```

---

## Task 9: Atualizar popup.html e popup.css

**Files:**
- Modify: `popup.html`
- Modify: `popup.css`

- [ ] **Em `popup.html`**, localizar a linha:

```html
<div id="llm-response" class="response-box"></div>
```

E adicionar a seção de fontes imediatamente após (ainda dentro de `#qa-interface`):

```html
            <div id="llm-response" class="response-box"></div>

            <div id="source-comments" class="source-comments hidden">
              <div class="source-header">Comentários que confirmam</div>
              <div id="source-list"></div>
            </div>
```

- [ ] **Em `popup.css`**, adicionar ao final do arquivo:

```css
.source-comments {
  margin-top: 12px;
}

.source-header {
  font-size: 11px;
  color: #667eea;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.comment-source {
  background: #f0f4ff;
  border-left: 3px solid #667eea;
  padding: 8px 10px;
  border-radius: 0 6px 6px 0;
  font-size: 12px;
  color: #2c3e50;
  margin-bottom: 6px;
  line-height: 1.5;
  word-wrap: break-word;
}

.comment-source-likes {
  color: #95a5a6;
  font-size: 11px;
  margin-top: 4px;
}
```

---

## Task 10: Atualizar popup.js

**Files:**
- Modify: `popup.js`

- [ ] **Adicionar a função `renderSourceComments` ANTES da linha `let collectedComments = []`** (início do arquivo):

```javascript
function renderSourceComments(comentarios) {
  const container = document.getElementById('source-comments');
  const list = document.getElementById('source-list');

  if (!container || !list) return;

  if (!comentarios || comentarios.length === 0) {
    container.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  list.innerHTML = comentarios.map(c => `
    <div class="comment-source">
      <div>${c.text}</div>
      <div class="comment-source-likes">❤ ${c.likeCount} likes</div>
    </div>
  `).join('');

  container.classList.remove('hidden');
}
```

- [ ] **Dentro do `document.addEventListener('DOMContentLoaded', ...)`**, no bloco `switch (message.type)`, localizar o `case 'LLM_RESPONSE':` e atualizar completo:

```javascript
// ANTES:
case 'LLM_RESPONSE':
    llmResponse.textContent = message.response;
    llmResponse.classList.remove('loading');
    askButton.disabled = false;
    console.log('Resposta do LLM recebida:', message.response);
    break;
```

```javascript
// DEPOIS:
case 'LLM_RESPONSE':
    llmResponse.textContent = message.resposta;
    llmResponse.classList.remove('loading');
    askButton.disabled = false;
    renderSourceComments(message.comentarios_fonte);
    console.log('Resposta do LLM recebida:', message.resposta);
    break;
```

- [ ] **Atualizar a função `hideQAInterface`** para limpar as fontes ao ocultar:

```javascript
// ANTES:
function hideQAInterface() {
    qaInterface.classList.add('hidden');
    questionInput.value = '';
    llmResponse.textContent = '';
    llmResponse.classList.remove('loading');
}
```

```javascript
// DEPOIS:
function hideQAInterface() {
    qaInterface.classList.add('hidden');
    questionInput.value = '';
    llmResponse.textContent = '';
    llmResponse.classList.remove('loading');
    renderSourceComments([]); // limpa os cards de fonte
}
```

- [ ] **Adicionar atalho `Ctrl+Enter` para enviar a pergunta.** Localizar a linha `askButton.addEventListener('click', handleAskLLM);` e adicionar logo após:

```javascript
questionInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    handleAskLLM();
  }
});
```

---

## Task 11: Teste E2E no Chrome

**Files:** nenhum

- [ ] **Abrir `chrome://extensions/`** no Chrome e ativar o **Modo do desenvolvedor** (toggle no canto superior direito).

- [ ] **Carregar a extensão:** clicar em **Carregar sem compactação** → selecionar `C:\Users\moura\Documents\youtube-comment`.

> Se a extensão já estava carregada, clicar no ícone 🔄 ao lado dela para recarregar após as mudanças.

- [ ] **Abrir um vídeo de review de produto no YouTube** (ex: buscar "iPhone 16 review", "headphone Sony review").

- [ ] **Clicar no ícone da extensão → Analisar Comentários.**

Esperado:
- Status: `Coletando página 1 de comentários... (0 comentários)`
- Status: `✅ Coleta concluída! Total: X comentários`
- Seção de pergunta aparece

- [ ] **Digitar `A bateria é boa?` e clicar Perguntar** (ou `Ctrl+Enter`).

Esperado em até 5s:
- Caixa de resposta exibe texto gerado pelo Groq em português (2-4 frases)
- Seção **"Comentários que confirmam"** exibe 2-3 cards com borda azul e contagem de likes

- [ ] **Testar os casos de erro:**

| Cenário | Ação | Esperado |
|---|---|---|
| Pergunta vazia | Clique em Perguntar sem digitar nada | Mensagem: "Por favor, digite uma pergunta." |
| Antes de analisar | Perguntar sem ter coletado comentários | Mensagem: "Nenhum comentário coletado. Analise um vídeo primeiro." |
| Fora do YouTube | Abrir extensão em qualquer outro site | Mensagem: "Por favor, abra um vídeo do YouTube" |
| Ctrl+Enter | Digitar pergunta e pressionar Ctrl+Enter | Mesma ação que clicar "Perguntar" |

- [ ] **Testar com pelo menos 3 vídeos diferentes** (produto diferente cada um) para validar qualidade das respostas e variação dos comentários-fonte.

- [ ] **Comparar qualidade dos modelos:** em `backend/lib/llm.ts`, trocar `PRIMARY_MODEL` temporariamente para `'mixtral-8x7b-32768'` e repetir o teste — anotar diferenças de qualidade e velocidade para o TCC.
