# How to run, test & watch the MCP server

**rag = the engine** (data + search), **mcp = the doorway** Claude talks to.
The doorway calls the engine over HTTP.

```
Claude Desktop / Inspector → xsaved-mcp (thin bridge) → HTTP → xsaved-rag service → Postgres (pgvector + FTS)
```

## 1. Start the engine first

The MCP server is a thin bridge — it needs the RAG engine running on :8790.
Startup steps live in one place: **[`xsaved-rag/USAGE.md`](../xsaved-rag/USAGE.md)**. TL;DR:

```bash
cd xsaved-rag
docker compose up -d --wait
npm run setup                 # one-time: tables + media + embeddings (details in xsaved-rag/USAGE.md)
npm run serve                 # http://localhost:8790 — LEAVE THIS RUNNING
```

## 2. Test the MCP server (pick one)

**Option A — fastest, no Claude needed (MCP Inspector UI):**

```bash
cd xsaved-mcp
npm run inspect               # opens a browser UI
# click a tool (e.g. hybrid_search_bookmarks), type a query, hit Run
```

**Option B — the real demo (Claude Desktop):**

```bash
cd xsaved-mcp
npm run build
# Claude Desktop config already points at RAG_API_URL=http://localhost:8790
# Fully QUIT and reopen Claude Desktop, then ask:
#   "hybrid-search my bookmarks for discipline"
# or use the "research_bookmarks" prompt from the + / prompt picker.
```

## 3. Watch the MCP log

mcp is spawned by Claude Desktop and has no terminal of its own — tail its log:

```bash
tail -f ~/Library/Logs/Claude/mcp-server-xsaved.log
```

```
[xsaved-mcp] 8:16:57 AM → hybrid_search_bookmarks("discipline", limit=2)
[xsaved-mcp] 8:16:58 AM   ✓ hybrid_search_bookmarks("discipline", limit=2) (749ms)
```

(If you run mcp via `npm run inspect` instead, the Inspector shows these.)
Pair this with the rag serve terminal's request log = full visibility of every hop.

## If it breaks

- Tool says **"could not reach xsaved-rag service"** → the engine isn't running; see [`xsaved-rag/USAGE.md`](../xsaved-rag/USAGE.md) (`npm run serve`).
- Claude Desktop shows no `xsaved` tools → didn't fully quit/reopen, or `dist` not built (`npm run build`).
- `EADDRINUSE: :::8790` → a server is already on that port; `lsof -ti tcp:8790 | xargs kill`.
