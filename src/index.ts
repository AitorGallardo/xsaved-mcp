#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  search,
  getBookmark,
  getStats,
  getTags,
  RagUnavailableError,
  RAG_BASE,
  type Strategy,
} from "./rag-client.js";
import type { Bookmark, SearchHit } from "./types.js";

// IMPORTANT: a stdio MCP server speaks JSON-RPC over stdout. Never console.log
// here — it corrupts the protocol stream. All logging goes to stderr.
//
// This server is a THIN BRIDGE. It owns no data and no search logic — every
// tool just calls the xsaved-rag HTTP service and relays the result.

// --- Formatting helpers ----------------------------------------------------
function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

function formatHit(h: SearchHit): string {
  const lines = [`[${h.bookmarkId}] @${h.author}`, h.text];
  if (h.tags?.length) lines.push(`tags: ${h.tags.join(", ")}`);
  if (h.notes) lines.push(`note: ${h.notes}`);
  const score =
    h.distance !== undefined
      ? `similarity: ${(1 - h.distance).toFixed(3)}`
      : h.keywordScore !== undefined
        ? `keyword score: ${h.keywordScore.toFixed(3)}`
        : null;
  if (score) lines.push(score);
  return lines.join("\n");
}

function formatBookmark(b: Bookmark): string {
  const lines = [`[${b.id}] @${b.author}`, b.text];
  if (b.tags?.length) lines.push(`tags: ${b.tags.join(", ")}`);
  if (b.notes) lines.push(`note: ${b.notes}`);
  if (b.bookmarked_at) lines.push(`bookmarked: ${b.bookmarked_at.slice(0, 10)}`);
  return lines.join("\n");
}

// Run a tool body, turning a down/unreachable rag service into a clean,
// model-readable error instead of a crash.
async function guard(fn: () => Promise<ReturnType<typeof textResult>>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RagUnavailableError) return textResult(e.message, true);
    return textResult(`Unexpected error: ${(e as Error).message}`, true);
  }
}

// --- Server ----------------------------------------------------------------
const server = new McpServer({ name: "xsaved-mcp", version: "0.2.0" });

// One factory for the three search tools — they differ only by strategy + copy.
function registerSearchTool(
  name: string,
  strategy: Strategy,
  title: string,
  description: string
) {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: {
        query: z.string().describe("What to search for"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results (default 10)"),
      },
    },
    ({ query, limit }) =>
      guard(async () => {
        const hits = await search(strategy, query, limit ?? 10);
        if (hits.length === 0) return textResult(`No bookmarks matched "${query}".`);
        const body = hits.map(formatHit).join("\n\n---\n\n");
        return textResult(`${hits.length} ${strategy} result(s) for "${query}":\n\n${body}`);
      })
  );
}

registerSearchTool(
  "search_bookmarks",
  "keyword",
  "Keyword search",
  "Keyword (full-text) search over saved tweets — matches exact words in the text, notes, author, and tags. Best for handles, library names, and specific terms. Returns ranked bookmarks with IDs."
);

registerSearchTool(
  "semantic_search_bookmarks",
  "vector",
  "Semantic (meaning-based) search",
  "Search by MEANING, not exact words — finds conceptually related tweets even with no shared keywords (e.g. 'AI safety' surfaces 'alignment', 'RLHF'). Best for fuzzy/conceptual questions. Returns ranked bookmarks with a similarity score."
);

registerSearchTool(
  "hybrid_search_bookmarks",
  "hybrid",
  "Hybrid search (keyword + semantic)",
  "Combines keyword and semantic search with Reciprocal Rank Fusion — the best general-purpose default. Catches both exact-term matches and conceptual matches. Returns ranked bookmarks with IDs."
);

server.registerTool(
  "get_bookmark",
  {
    title: "Get a bookmark by ID",
    description:
      "Fetch a single bookmark by its tweet ID (the value in square brackets from search results).",
    inputSchema: { id: z.string().describe("The bookmark / tweet ID") },
  },
  ({ id }) =>
    guard(async () => {
      const b = await getBookmark(id);
      if (!b) return textResult(`No bookmark found with id ${id}.`);
      return textResult(formatBookmark(b));
    })
);

server.registerTool(
  "get_stats",
  {
    title: "Corpus statistics",
    description:
      "Overview of the whole bookmark collection: total count, unique authors, date range, and the most-saved authors and tags.",
  },
  () =>
    guard(async () => {
      const s = await getStats();
      const lines = [
        `Total bookmarks: ${s.totalBookmarks}`,
        `Unique authors: ${s.uniqueAuthors}`,
        `Date range: ${(s.dateRange.earliest ?? "?").slice(0, 10)} → ${(s.dateRange.latest ?? "?").slice(0, 10)}`,
        ``,
        `Top authors:`,
        ...s.topAuthors.map((a) => `  @${a.name} — ${a.count}`),
        ``,
        `Top tags:`,
        ...s.topTags.map((t) => `  ${t.name} — ${t.count}`),
      ];
      return textResult(lines.join("\n"));
    })
);

server.registerTool(
  "list_tags",
  {
    title: "List all tags",
    description:
      "List every tag the user has applied to their bookmarks, with how many bookmarks carry each tag.",
  },
  () =>
    guard(async () => {
      const tags = await getTags();
      if (tags.length === 0) return textResult("No tags in the corpus.");
      const body = tags.map((t) => `${t.name} (${t.count})`).join("\n");
      return textResult(`${tags.length} tags:\n\n${body}`);
    })
);

// --- Connect over stdio -----------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[xsaved-mcp] thin bridge ready on stdio → rag at ${RAG_BASE}`);
