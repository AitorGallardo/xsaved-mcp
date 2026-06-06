import pg from "pg";
import pgvector from "pgvector/pg";
import OpenAI from "openai";
import type { SearchHit } from "./types.js";

// --- Semantic (meaning-based) search ---------------------------------------
//
// This is the bridge to Project 4 (xsaved-rag). Instead of reaching into that
// project's source code, we connect to the SAME Postgres database it already
// populated. The database IS the integration surface — clean package boundary,
// no shared imports. xsaved-rag indexed every bookmark into two tables:
//   - bookmarks            (id = tweet id, text, author, ...)
//   - bookmark_embeddings  (bookmark_id, embedding vector(1536), ...)
//
// To search by meaning we: (1) turn the user's query into the same kind of
// vector with the same embedding model, then (2) ask Postgres for the rows
// whose stored vector is closest to it (pgvector's `<=>` = cosine distance).

const EMBEDDING_MODEL = "text-embedding-3-small"; // MUST match what xsaved-rag indexed with

// Is semantic search even available? Only if both the DB and the embedding key
// are configured. The core server works fine without these — the tool is just
// not registered when they're missing (graceful capability detection).
export function semanticAvailable(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.OPENAI_API_KEY);
}

let pool: pg.Pool | null = null;
function getPool(): pg.Pool {
  if (pool) return pool;
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  // Teach the pg driver how to send/receive the pgvector `vector` type.
  pool.on("connect", (client) => pgvector.registerType(client));
  return pool;
}

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (openai) return openai;
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

/** Turn the query string into a 1536-dim vector using the same model as indexing. */
async function embedQuery(query: string): Promise<number[]> {
  const res = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  });
  return res.data[0].embedding;
}

/**
 * Find the `limit` bookmarks whose meaning is closest to `query`.
 * `distance` is cosine distance: 0 = identical meaning, higher = less related.
 */
export async function semanticSearch(
  query: string,
  limit: number
): Promise<SearchHit[]> {
  const queryEmbedding = await embedQuery(query);

  // <=> is pgvector's cosine-distance operator. ORDER BY it ASC + LIMIT = the
  // nearest neighbours. The HNSW index makes this fast even on huge corpora.
  const sql = `
    SELECT b.id, b.author, b.text, b.notes, b.tags,
           e.embedding <=> $1 AS distance
    FROM bookmark_embeddings e
    JOIN bookmarks b ON b.id = e.bookmark_id
    ORDER BY e.embedding <=> $1
    LIMIT $2;
  `;
  const { rows } = await getPool().query(sql, [
    pgvector.toSql(queryEmbedding), // serialise the vector for Postgres
    limit,
  ]);

  return rows.map((r) => ({
    id: r.id as string,
    author: r.author as string,
    text: r.text as string,
    notes: r.notes ?? undefined,
    tags: (r.tags as string[]) ?? [],
    createdAt: "", // not needed for search output
    bookmarkedAt: "",
    // Convert distance → a friendlier "similarity" score (1 = identical).
    score: Number((1 - Number(r.distance)).toFixed(3)),
  }));
}
