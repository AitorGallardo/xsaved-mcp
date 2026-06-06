#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BookmarkStore } from "./data.js";
import { semanticAvailable, semanticSearch } from "./semantic.js";
import type { Bookmark } from "./types.js";

// IMPORTANT: a stdio MCP server speaks JSON-RPC over stdout. Anything we print
// to stdout that isn't a protocol message corrupts the stream. So ALL logging
// goes to stderr via console.error. Never console.log in this file.

const BOOKMARKS_PATH = process.env.BOOKMARKS_PATH ?? "./data/bookmarks.json";

// --- Load the corpus once, up front ---------------------------------------
const store = new BookmarkStore();
const count = await store.load(BOOKMARKS_PATH);
console.error(`[xsaved-mcp] loaded ${count} bookmarks from ${BOOKMARKS_PATH}`);

// --- Formatting helpers (turn data into readable text for the model) -------
function formatBookmark(b: Bookmark, score?: number): string {
  const lines = [
    `[${b.id}] @${b.author}`,
    b.text,
  ];
  if (b.tags.length) lines.push(`tags: ${b.tags.join(", ")}`);
  if (b.notes) lines.push(`note: ${b.notes}`);
  if (b.bookmarkedAt) lines.push(`bookmarked: ${b.bookmarkedAt.slice(0, 10)}`);
  if (score !== undefined) lines.push(`score: ${score}`);
  return lines.join("\n");
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// --- Server + tools ---------------------------------------------------------
const server = new McpServer({
  name: "xsaved-mcp",
  version: "0.1.0",
});

server.registerTool(
  "search_bookmarks",
  {
    title: "Search bookmarks",
    description:
      "Keyword search over the user's saved tweets (matches tweet text, notes, author handle, and tags). Returns the most relevant bookmarks with their IDs so you can cite or fetch them.",
    inputSchema: {
      query: z.string().describe("Search terms, e.g. 'prompt caching' or 'karpathy llm'"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results to return (default 10)"),
    },
  },
  async ({ query, limit }) => {
    const hits = store.search(query, limit ?? 10);
    if (hits.length === 0) {
      return textResult(`No bookmarks matched "${query}".`);
    }
    const body = hits.map((h) => formatBookmark(h, h.score)).join("\n\n---\n\n");
    return textResult(`${hits.length} result(s) for "${query}":\n\n${body}`);
  }
);

server.registerTool(
  "get_bookmark",
  {
    title: "Get a bookmark by ID",
    description:
      "Fetch a single bookmark by its tweet ID (the value in square brackets from search results).",
    inputSchema: {
      id: z.string().describe("The bookmark / tweet ID"),
    },
  },
  async ({ id }) => {
    const b = store.get(id);
    if (!b) return textResult(`No bookmark found with id ${id}.`);
    return textResult(formatBookmark(b));
  }
);

server.registerTool(
  "get_stats",
  {
    title: "Corpus statistics",
    description:
      "Overview of the whole bookmark collection: total count, unique authors and tags, date range, and the most-saved authors and tags.",
  },
  async () => {
    const s = store.stats();
    const lines = [
      `Total bookmarks: ${s.totalBookmarks}`,
      `Unique authors: ${s.uniqueAuthors}`,
      `Unique tags: ${s.uniqueTags}`,
      `Date range: ${s.dateRange.earliest.slice(0, 10)} → ${s.dateRange.latest.slice(0, 10)}`,
      ``,
      `Top authors:`,
      ...s.topAuthors.map((a) => `  @${a.name} — ${a.count}`),
      ``,
      `Top tags:`,
      ...s.topTags.map((t) => `  ${t.name} — ${t.count}`),
    ];
    return textResult(lines.join("\n"));
  }
);

server.registerTool(
  "list_tags",
  {
    title: "List all tags",
    description:
      "List every tag the user has applied to their bookmarks, with how many bookmarks carry each tag. Useful for browsing the collection by theme.",
  },
  async () => {
    const tags = store.tagCounts();
    if (tags.length === 0) return textResult("No tags in the corpus.");
    const body = tags.map((t) => `${t.name} (${t.count})`).join("\n");
    return textResult(`${tags.length} tags:\n\n${body}`);
  }
);

// --- Semantic search (optional — only if xsaved-rag's DB + an OpenAI key are
//     configured). This is the bridge to Project 4: meaning-based search over
//     the same bookmarks, served through the same MCP doorway. ---------------
if (semanticAvailable()) {
  server.registerTool(
    "semantic_search_bookmarks",
    {
      title: "Semantic (meaning-based) search",
      description:
        "Search bookmarks by MEANING, not exact words — finds conceptually related tweets even when they share no keywords (e.g. 'AI safety' also surfaces 'alignment', 'RLHF'). Use this when keyword search misses paraphrases or synonyms. Returns ranked bookmarks with a similarity score (1.0 = closest).",
      inputSchema: {
        query: z.string().describe("A natural-language description of what you're looking for"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results to return (default 10)"),
      },
    },
    async ({ query, limit }) => {
      const hits = await semanticSearch(query, limit ?? 10);
      if (hits.length === 0) {
        return textResult(`No bookmarks found for "${query}".`);
      }
      const body = hits.map((h) => formatBookmark(h, h.score)).join("\n\n---\n\n");
      return textResult(`${hits.length} semantically-related result(s) for "${query}":\n\n${body}`);
    }
  );
  console.error("[xsaved-mcp] semantic_search_bookmarks ENABLED (DB + OpenAI key found)");
} else {
  console.error(
    "[xsaved-mcp] semantic_search_bookmarks disabled (set DATABASE_URL + OPENAI_API_KEY to enable)"
  );
}

// --- Connect over stdio -----------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[xsaved-mcp] server ready on stdio");
