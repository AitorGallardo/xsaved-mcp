# Testing the whole MCP + RAG system

How to run and test the full stack end-to-end. The mental model: **rag = the
engine** (data + search), **mcp = the doorway** Claude talks to. The doorway
calls the engine over HTTP.

```
Claude Desktop / Inspector → xsaved-mcp (thin bridge) → HTTP → xsaved-rag service → Postgres (pgvector + FTS)
```

**Prereq:** OrbStack (Docker) running.

## Terminal 1 — start the RAG engine (data + search)

```bash
cd xsaved-rag
docker compose up -d --wait   # Postgres + pgvector (the vector database)
npm run db:migrate            # first time only — creates the tables
npm run index                 # first time only — embeds the 189 bookmarks (~$0.0002)
npm run serve                 # API on http://localhost:8790 — LEAVE THIS RUNNING
```

Sanity-check rag on its own (optional):

```bash
curl "http://localhost:8790/search?q=motivation&strategy=hybrid&limit=3"   # should print JSON hits
```

## Terminal 2 — test the MCP server (pick one)

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
```

## If it breaks

- Tool says **"could not reach xsaved-rag service"** → Terminal 1 isn't running (`npm run serve`).
- `/search` empty or errors → DB not indexed (`npm run index`).
- `EADDRINUSE: :::8790` → a server is already on that port; `lsof -ti tcp:8790 | xargs kill`.
- Claude Desktop shows no `xsaved` tools → didn't fully quit/reopen, or `dist` not built (`npm run build`).
