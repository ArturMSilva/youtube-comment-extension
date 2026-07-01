# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Extension (Manifest V3) that collects YouTube video comments via the YouTube Data API and answers natural-language questions about them using an LLM (Groq). The answer and the source comments that support it are displayed in the popup.

## Repository Structure

This extension and its backend are **two separate sibling git repositories** under `TCC/`, not a nested folder:

```
TCC/
├── youtube-comment-extension/            ← This repo (loaded directly into Chrome)
│   ├── manifest.json                     ← MV3 manifest
│   ├── service-worker.js                 ← Background script (handles API calls)
│   ├── content.js                        ← Injected into YouTube pages (detects video ID)
│   └── popup.html / popup.css / popup.js ← Extension popup UI
└── youtube-comment-backend/              ← Sibling repo — Vercel serverless backend
    ├── api/ask.ts                        ← Single endpoint: POST /api/ask
    ├── lib/retrieval.ts                  ← Keyword-scoring RAG filter
    ├── lib/llm.ts                        ← Groq API integration + response parser
    ├── types.ts                          ← Shared TypeScript interfaces
    ├── tests/                            ← Vitest unit tests
    ├── package.json
    ├── tsconfig.json
    └── vercel.json
```

## Backend Commands

All commands run from inside the sibling `youtube-comment-backend/` repo:

```bash
npm test              # Run all tests once (vitest run)
npm run test:watch    # Watch mode
npx vercel dev        # Local dev server at http://localhost:3000
npx vercel --prod     # Deploy to production
```

Run a single test file:
```bash
npx vitest run tests/retrieval.test.ts
```

## Architecture & Data Flow

### Extension → Backend

1. **content.js** detects `?v=` in the YouTube URL and sends `VIDEO_ID_FOUND` to the service worker via `chrome.runtime.sendMessage`.
2. **popup.js** triggers `START_COMMENT_COLLECTION` → **service-worker.js** fetches comments from YouTube Data API (`/commentThreads`) in pages of 100, up to 500 comments / 5 pages.
3. When the user asks a question, popup.js sends `ASK_LLM { question, comments, videoId }` to the service worker.
4. **service-worker.js** → `POST /api/ask` on the Vercel backend → receives `{ resposta, comentarios_fonte[] }` → sends `LLM_RESPONSE` back to popup.
5. **popup.js** renders the answer in `#llm-response` and source comment cards in `#source-list`.

### Backend Pipeline (api/ask.ts)

```
Request → CORS check → input validation → filterRelevantComments (top-30 by keyword score)
        → askGroq (llama-3.3-70b-versatile, fallback: mixtral-8x7b-32768 on 429)
        → parseResponse (extracts FONTES: [1,3] indices from LLM output)
        → { resposta, comentarios_fonte[] }
```

### RAG Strategy (lib/retrieval.ts)

Keywords are extracted from the question (words > 3 chars). Comments are scored by keyword frequency. If no matches, falls back to top-N by like count. Sends at most 30 comments to the LLM.

### LLM Response Format

The prompt instructs the model to end its response with `FONTES: [1, 3, 7]` (1-based indices into the filtered comment list). `parseResponse` strips this line from the displayed text and maps indices back to `Comment` objects.

## Environment Variables

| Variable | Location | Purpose |
|---|---|---|
| `GROQ_API_KEY` | Vercel dashboard (never in code) | Groq API authentication |

Local dev: add to `youtube-comment-backend/.env` (gitignored).

## Git Commit Conventions

- **Commit messages must be written in Portuguese** (matches the existing history — see `git log`).
- Keep the `type: descrição` prefix style (`feat:`, `fix:`, `chore:`, etc.) with the description in Portuguese.
- **Do not add a `Co-Authored-By` trailer** to commits in this repository.

## Key Constraints

- **CORS**: The backend only sets `Access-Control-Allow-Origin` for `chrome-extension://` origins and `http://localhost`. Do not widen this.
- **MV3**: The extension uses Manifest V3. The service worker (`service-worker.js`) is an ES module (`"type": "module"`). No persistent background pages.
- **`BACKEND_URL`**: Hardcoded in `service-worker.js` line 2. Must be updated after each new Vercel deployment URL.
- **YouTube API key**: Hardcoded in `service-worker.js` line 1 (`API_KEY`). Acceptable for TCC/academic use.
- **XSS**: Comment text must always be set via `textContent`, never `innerHTML` (popup.js uses `createElement` + `textContent` for this reason).

## Chrome Extension Loading

Load **this repo's root folder** (`youtube-comment-extension/`) in Chrome — the backend is a separate repo and is never loaded into Chrome:
- `chrome://extensions/` → Developer mode → Load unpacked → select `youtube-comment-extension/`
- After changing extension files, click the reload (↻) icon on the extension card.
