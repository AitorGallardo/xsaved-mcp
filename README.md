# XSaved MCP

An **MCP server** that exposes a Twitter/X bookmark corpus as tools any MCP client — Claude Desktop, Claude Code, a custom agent — can call. Ask *"search my bookmarks for prompt caching"* inside Claude Desktop and it transparently calls this server.

The mental flip from a normal Claude app: here, **Claude calls you**. You're not sending prompts to a model — you're standing up a small service that *describes the tools it offers*, and the model decides when to call them.

It's a **thin bridge**: it owns no data and no search logic. Every tool turns an MCP call into an HTTP request to the [`xsaved-rag`](../xsaved-rag/) retrieval service, then relays the result.

```
Claude Desktop / Claude Code  ──(MCP, JSON-RPC over stdio)──►  xsaved-mcp  ──(HTTP)──►  xsaved-rag service  ──►  Postgres (pgvector + FTS)
```

---

## What is MCP, in one paragraph

**MCP (Model Context Protocol)** is an open standard from Anthropic for connecting LLM apps to external data and tools — think *USB-C for AI*: one connector, many devices. An **MCP server** advertises a list of **tools** (functions with typed inputs) and answers when a client calls them. The client (Claude Desktop, etc.) runs the LLM; the server handles the tools. They talk **JSON-RPC** — a simple "method name + arguments → result" message format — over **stdio** (the server's standard input/output streams) when running locally.

---

## Tools

| Tool | Input | What it returns |
|---|---|---|
| `search_bookmarks` | `query`, `limit?`, *filters* | **Keyword** full-text search (exact words: handles, library names, terms). |
| `semantic_search_bookmarks` | `query`, `limit?`, *filters* | **Meaning-based** search — conceptual matches even with no shared keywords. |
| `hybrid_search_bookmarks` | `query`, `limit?`, *filters* | **Keyword + semantic** fused with Reciprocal Rank Fusion. The best general default. |
| `get_bookmark` | `id` | A single bookmark by tweet ID. |
| `get_stats` | — | Corpus overview: totals, unique authors, date range, top authors/tags. |
| `list_tags` | — | Every tag with how many bookmarks carry it. |

All three search tools also accept optional **metadata filters** — `author`, `tag`, `since`, `until` — applied *before* scoring, so you can combine structured filtering with semantic/keyword search (e.g. only `@elonmusk`, only bookmarks since `2026-01-01`). They're backed by the same `xsaved-rag` engine; the MCP server just picks the strategy, forwards the filters, and relays the call. Each tool is registered with a Zod input schema, so the client gets typed argument hints and the server validates inputs before relaying.

**Prompt:** the server also exposes a reusable prompt, `research_bookmarks` (arg: `topic`) — a canned "research my bookmarks about X, with citations" workflow that clients can surface in their prompt picker.

---

## Architecture — why a thin bridge

The server deliberately contains **no Postgres client, no embeddings, no SQL, no search logic.** All of that lives once, in `xsaved-rag`. This server only translates protocols.

```
┌───────────────────────────────────────────────┐
│ MCP client (Claude Desktop / Claude Code)     │  runs the LLM, decides which tool to call
└───────────────────────────────────────────────┘
                    │  JSON-RPC over stdio
                    ▼
┌───────────────────────────────────────────────┐
│ xsaved-mcp  (src/index.ts)                    │  registers 6 tools (Zod-typed)
│   src/rag-client.ts                           │  the ONLY thing that touches data: fetch()
└───────────────────────────────────────────────┘
                    │  HTTP
                    ▼
┌───────────────────────────────────────────────┐
│ xsaved-rag service  (GET /search, /stats, ...) │  keyword + vector + hybrid retrieval
│   → Postgres (pgvector + full-text search)     │  one source of truth for all search logic
└───────────────────────────────────────────────┘
```

**Why this split?** An earlier version had the MCP server query Postgres directly and even re-implemented its own keyword search. That meant **two copies of the search stack** that could (and did) drift apart. Centralising retrieval in `xsaved-rag` and making this server a pure proxy means search logic exists in exactly one place, the corpora can't diverge, and adding a new client (an agent, a web UI) needs zero new search code. This is the standard real-world pattern: services compose through an API boundary, not by importing each other's internals.

---

## Usage

This server needs the `xsaved-rag` service running (that's where the data + search live).

```bash
# 1. Start the retrieval service (separate terminal)
cd ../xsaved-rag
docker compose up -d --wait   # Postgres + pgvector
npm run db:migrate            # once
npm run index                 # once — embeds the corpus
npm run serve                 # http://localhost:8790

# 2. The MCP server
cd ../xsaved-mcp
npm install
cp .env.example .env          # set RAG_API_URL if not the default 8790
npm run dev                   # speaks JSON-RPC on stdio, waits for a client
npm run build                 # → dist/index.js (for Claude Desktop)
npm run inspect               # poke the tools in a UI (MCP Inspector)
```

Running `npm run dev` on its own just sits there — correct. An MCP server is launched *by a client*, which pipes JSON-RPC into its stdin.

### Register in Claude Desktop

Build first (`npm run build`), then add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "xsaved": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/xsaved-mcp/dist/index.js"],
      "env": { "RAG_API_URL": "http://localhost:8790" }
    }
  }
}
```

**Why absolute paths to `node`?** macOS launches GUI apps without your shell's `PATH`, so Claude Desktop often can't find `npx`/`tsx`/`node`. Pointing `command` at the absolute `node` binary (`which node`) and `args` at the built `dist/index.js` sidesteps the most common "works in the terminal but not in Claude Desktop" failure. (Make sure the `xsaved-rag` service is running, or the tools return a clear "service unreachable" message.)

Then ask: *"Use the xsaved tools — hybrid-search my bookmarks for ideas about discipline."*

---

## Key engineering decisions

### 1. Thin bridge: zero data/search logic in the server
Every tool is a `fetch()` to `xsaved-rag` (`src/rag-client.ts`). No SQL, no DB driver, no embeddings here. Retrieval lives in one place; this server just speaks MCP on one side and HTTP on the other.

### 2. Never write to stdout
On stdio transport, **stdout is the protocol channel** — every line is a JSON-RPC message. A stray `console.log` corrupts it. All logging goes to **stderr**. This is the #1 way a first MCP server breaks.

### 3. Graceful failure when the engine is down
If the rag service isn't reachable, tools don't crash — they return a clear, model-readable error (`isError: true`) telling you how to start it. The client and model can react instead of hanging.

### 4. One factory for three search tools
`keyword`, `vector`, and `hybrid` differ only by a strategy string and description, so they're generated by one helper — less duplication, identical behaviour, easy to add a fourth strategy.

### 5. Tools return text the model can read *and* cite
Results include the bookmark **ID** in `[brackets]`, so the model can chain `search → get_bookmark` and cite sources. Output is formatted for an LLM to consume, not as raw JSON.

---

## Stack

`@modelcontextprotocol/sdk` (server + stdio transport) · `zod` (tool input schemas) · `dotenv` · `tsx` · `typescript`

No database or AI SDK — those are `xsaved-rag`'s job.

---

## What this project is part of

This is the **MCP server** in a sequenced AI Engineer roadmap covering the Claude API, MCP, agentic patterns, RAG, multi-agent orchestration, and evaluation — all built around the same XSaved bookmark corpus.

See [../ROADMAP.md](../ROADMAP.md), [../xsaved-topics/README.md](../xsaved-topics/README.md) (Claude API), and [../xsaved-rag/README.md](../xsaved-rag/README.md) (the retrieval engine this bridges to).
