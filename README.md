# XSaved MCP

An **MCP server** that exposes a Twitter/X bookmark corpus as tools any MCP client — Claude Desktop, Claude Code, a custom agent — can call. Ask *"search my bookmarks for prompt caching"* inside Claude Desktop and it transparently calls this server.

The mental flip from a normal Claude app: here, **Claude calls you**. You're not sending prompts to a model — you're standing up a small service that *describes the tools it offers*, and the model decides when to call them.

```
Claude Desktop / Claude Code  ──(MCP, JSON-RPC over stdio)──►  this server  ──►  bookmark corpus
```

---

## What is MCP, in one paragraph

**MCP (Model Context Protocol)** is an open standard from Anthropic for connecting LLM apps to external data and tools — think *USB-C for AI*: one connector, many devices. An **MCP server** is a process that advertises a list of **tools** (functions with typed inputs) and answers when a client calls them. The client (Claude Desktop, etc.) handles the LLM; the server handles the data. They talk **JSON-RPC** — a simple "here's a method name and arguments, send me back a result" message format — over **stdio** (the server's standard input/output streams) when running locally.

---

## Tools this server exposes

| Tool | Input | What it returns |
|---|---|---|
| `search_bookmarks` | `query`, `limit?` | Keyword search over tweet text, notes, author, and tags. Returns ranked bookmarks with IDs. |
| `get_bookmark` | `id` | A single bookmark by its tweet ID. |
| `get_stats` | — | Corpus overview: totals, unique authors/tags, date range, top authors, top tags. |
| `list_tags` | — | Every tag with how many bookmarks carry it. |

Each tool is registered with a Zod input schema, so the client knows exactly what arguments to send and the server validates them before running.

---

## Architecture

Deliberately small. The whole "database" is the bookmark corpus loaded into memory once at startup — 189 short tweets don't need Postgres.

```
┌───────────────────────────────────────────────┐
│ MCP client (Claude Desktop / Claude Code)     │
│   - runs the LLM                              │
│   - decides which tool to call                │
└───────────────────────────────────────────────┘
                    │  JSON-RPC over stdio
                    ▼
┌───────────────────────────────────────────────┐
│ xsaved-mcp server (src/index.ts)              │
│   - McpServer + StdioServerTransport          │
│   - registers 4 tools (Zod-typed inputs)      │
└───────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────┐
│ BookmarkStore (src/data.ts)                   │
│   - loads data/bookmarks.json into memory     │
│   - keyword search, get-by-id, stats, tags    │
└───────────────────────────────────────────────┘
```

**Why local data, not a backend?** The roadmap's original plan had this server wrap the production XSaved REST API — but that backend doesn't store bookmark text yet (a real privacy decision). Rather than block on a backend change, the server is backed by the same self-contained corpus used by [`xsaved-rag`](../xsaved-rag/). The MCP lessons — tool design, schemas, stdio transport, the server lifecycle — are identical either way; only the data source behind the tools changes. Swapping in a real HTTP backend later is a one-file change in `src/data.ts`.

---

## Usage

```bash
npm install

# Run the server directly (it speaks JSON-RPC on stdio and waits for a client).
npm run dev

# Type-check / build to dist/
npm run build

# Inspect interactively with the official MCP Inspector (opens a UI):
npm run inspect
```

Running `npm run dev` on its own just sits there — that's correct. An MCP server is meant to be *launched by a client*, which pipes JSON-RPC into its stdin. Use the Inspector, or register it in Claude Desktop below.

### Register in Claude Desktop

Add this to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "xsaved": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/xsaved-mcp/src/index.ts"]
    }
  }
}
```

Then in a Claude Desktop chat: *"Use the xsaved tools to find my bookmarks about AI agents"* — and watch it call `search_bookmarks`.

---

## Key engineering decisions

### 1. High-level `McpServer` + `registerTool`, not raw JSON-RPC
The SDK's `McpServer` handles the protocol handshake, capability advertisement, and request routing. Each tool is one `registerTool(name, { description, inputSchema }, handler)` call. The `inputSchema` is a Zod shape, so the client gets typed argument hints and the server gets automatic validation — bad inputs are rejected before the handler runs.

### 2. Never write to stdout
On stdio transport, **stdout is the protocol channel** — every line is a JSON-RPC message. A stray `console.log` corrupts the stream and breaks the client. All logging goes to **stderr** (`console.error`). This is the single most common way a first MCP server breaks, so it's enforced by convention in `src/index.ts`.

### 3. Tools return text the model can read *and* cite
Search results include the bookmark **ID** in `[brackets]`, so the model can follow up with `get_bookmark` or cite the source. Tool output is for an LLM to consume, so it's formatted as clean, scannable text rather than raw JSON.

### 4. Self-contained data, swappable source
`BookmarkStore` is the only thing that touches data. It loads a bundled JSON corpus today; pointing it at an HTTP backend or `xsaved-rag`'s Postgres later doesn't touch the tool definitions at all.

---

## Stack

`@modelcontextprotocol/sdk` (server + stdio transport) · `zod` (tool input schemas) · `tsx` (run TS directly) · `typescript`

---

## What this project is part of

This is the **MCP server** in a sequenced AI Engineer roadmap covering the Claude API, MCP, agentic patterns, RAG, multi-agent orchestration, and evaluation — all built around the same XSaved bookmark corpus.

See [../ROADMAP.md](../ROADMAP.md) for the full plan, [../xsaved-topics/README.md](../xsaved-topics/README.md) for the Claude API project, and [../xsaved-rag/README.md](../xsaved-rag/README.md) for the RAG project (whose semantic search this server can expose as a `semantic_search_bookmarks` tool — a natural next step).
