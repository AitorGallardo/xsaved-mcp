# How to run, test & watch the MCP + RAG system

The mental model: **rag = the engine** (data + search), **mcp = the doorway**
Claude talks to. The doorway calls the engine over HTTP.

```
Claude Desktop / Inspector → xsaved-mcp (thin bridge) → HTTP → xsaved-rag service → Postgres (pgvector + FTS)
```

**Prereq:** OrbStack (Docker) running.

## Terminal 1 — start the RAG engine (data + search)

```bash
cd xsaved-rag
docker compose up -d --wait   # Postgres + pgvector (the vector database)
npm run db:migrate            # first time only — creates the tables
npm run index                 # first time only — embeds the bookmarks (~$0.0002)
npm run serve                 # API on http://localhost:8790 — LEAVE THIS RUNNING
```

Sanity-check rag on its own (optional):

```bash
curl "http://localhost:8790/search?q=motivation&strategy=hybrid&limit=3"
# with metadata filters (combine structured + semantic search):
curl "http://localhost:8790/search?q=rockets&strategy=hybrid&author=elonmusk"
curl "http://localhost:8790/search?q=ai&strategy=vector&tag=ai_local&since=2026-01-01"
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
# or use the "research_bookmarks" prompt from the + / prompt picker.
```

## Terminal 3 — watch what's happening (logs)

Both servers log every request, so you can see the traffic flow.

**rag** (Terminal 1) prints one coloured line per call:

```
8:16:58 AM GET /search?...&strategy=hybrid 200 660ms → 2 hits [hybrid] "discipline"
```

**mcp** is spawned by Claude Desktop and has no terminal — watch its log file:

```bash
tail -f ~/Library/Logs/Claude/mcp-server-xsaved.log
```

You'll see each tool call:

```
[xsaved-mcp] 8:16:57 AM → hybrid_search_bookmarks("discipline", limit=2)
[xsaved-mcp] 8:16:58 AM   ✓ hybrid_search_bookmarks("discipline", limit=2) (749ms)
```

(If you run mcp via `npm run inspect` instead, the Inspector shows these.)
So: **rag terminal + `tail -f` the MCP log = full visibility of every hop.**

## If it breaks

- Tool says **"could not reach xsaved-rag service"** → Terminal 1 isn't running (`npm run serve`).
- `/search` empty or errors → DB not indexed (`npm run index`).
- `EADDRINUSE: :::8790` → a server is already on that port; `lsof -ti tcp:8790 | xargs kill`.
- Claude Desktop shows no `xsaved` tools → didn't fully quit/reopen, or `dist` not built (`npm run build`).
