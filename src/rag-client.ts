import type { Bookmark, SearchHit, Stats, TagCount } from "./types.js";

// --- HTTP client for the xsaved-rag search service -------------------------
//
// This is the ONLY thing in the MCP server that touches data. There is no
// Postgres, no OpenAI, no SQL, no search logic here — all of that lives in
// xsaved-rag. The MCP server is a thin bridge: it turns MCP tool calls into
// HTTP requests to rag and relays the results. (rag = engine, mcp = doorway.)

const BASE = process.env.RAG_API_URL ?? "http://localhost:8790";

export type Strategy = "keyword" | "vector" | "hybrid";

/** Thrown when the rag service can't be reached or returns an error. */
export class RagUnavailableError extends Error {}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path);
  } catch {
    throw new RagUnavailableError(
      `Could not reach the xsaved-rag service at ${BASE}. Is it running? ` +
        `Start it with: (cd xsaved-rag && npm run serve)`
    );
  }
  if (!res.ok) {
    if (res.status === 404) throw new RagUnavailableError("not found");
    const body = await res.text().catch(() => "");
    throw new RagUnavailableError(`rag responded ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export async function search(
  strategy: Strategy,
  query: string,
  limit: number
): Promise<SearchHit[]> {
  const qs = new URLSearchParams({ q: query, strategy, limit: String(limit) });
  const data = await get<{ hits: SearchHit[] }>(`/search?${qs}`);
  return data.hits;
}

export async function getBookmark(id: string): Promise<Bookmark | null> {
  try {
    return await get<Bookmark>(`/bookmarks/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof RagUnavailableError && e.message === "not found") return null;
    throw e;
  }
}

export function getStats(): Promise<Stats> {
  return get<Stats>("/stats");
}

export async function getTags(): Promise<TagCount[]> {
  const data = await get<{ tags: TagCount[] }>("/tags");
  return data.tags;
}

export { BASE as RAG_BASE };
