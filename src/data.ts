import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Bookmark, SearchHit } from "./types.js";

// Shape of a raw record in data/bookmarks.json (snake_case from the export).
interface RawBookmark {
  id: string;
  text: string;
  author: string;
  notes?: string;
  tags?: string[];
  created_at: string;
  bookmarked_at: string;
}

/**
 * The whole "database" for this project: bookmarks loaded into memory once at
 * startup. 189 short tweets — no need for Postgres here. Keeping it in a plain
 * array is the pragmatic call, and it keeps the MCP lessons front and centre.
 */
export class BookmarkStore {
  private bookmarks: Bookmark[] = [];
  private byId = new Map<string, Bookmark>();

  async load(path: string): Promise<number> {
    const raw = await readFile(resolve(path), "utf-8");
    const records = JSON.parse(raw) as RawBookmark[];

    this.bookmarks = records.map((b) => ({
      id: b.id,
      text: b.text,
      author: b.author,
      notes: b.notes,
      tags: Array.isArray(b.tags) ? b.tags : [],
      createdAt: b.created_at,
      bookmarkedAt: b.bookmarked_at,
    }));

    this.byId = new Map(this.bookmarks.map((b) => [b.id, b]));
    return this.bookmarks.length;
  }

  get(id: string): Bookmark | undefined {
    return this.byId.get(id);
  }

  /**
   * Dead-simple keyword search. Splits the query into terms, scores each
   * bookmark by how many terms appear across its searchable text (tweet +
   * notes + author + tags), and returns the top `limit`. This is the "keyword"
   * leg — no embeddings, no Postgres. Good enough, and easy to reason about.
   */
  search(query: string, limit: number): SearchHit[] {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (terms.length === 0) return [];

    const hits: SearchHit[] = [];
    for (const b of this.bookmarks) {
      const haystack = [
        b.text,
        b.notes ?? "",
        b.author,
        b.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();

      // Score = number of distinct query terms that appear in the haystack,
      // with a small bonus for matches in the author handle or tags.
      let score = 0;
      for (const term of terms) {
        if (!haystack.includes(term)) continue;
        score += 1;
        if (b.author.toLowerCase().includes(term)) score += 0.5;
        if (b.tags.some((t) => t.toLowerCase().includes(term))) score += 0.5;
      }

      if (score > 0) hits.push({ ...b, score });
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Aggregate stats for the get_stats tool. */
  stats() {
    const authors = new Map<string, number>();
    const tags = new Map<string, number>();
    let earliest = "";
    let latest = "";

    for (const b of this.bookmarks) {
      authors.set(b.author, (authors.get(b.author) ?? 0) + 1);
      for (const t of b.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
      if (!earliest || b.bookmarkedAt < earliest) earliest = b.bookmarkedAt;
      if (!latest || b.bookmarkedAt > latest) latest = b.bookmarkedAt;
    }

    return {
      totalBookmarks: this.bookmarks.length,
      uniqueAuthors: authors.size,
      uniqueTags: tags.size,
      dateRange: { earliest, latest },
      topAuthors: topN(authors, 10),
      topTags: topN(tags, 15),
    };
  }

  /** Tag → count, sorted by count desc. Powers list_tags. */
  tagCounts() {
    const tags = new Map<string, number>();
    for (const b of this.bookmarks) {
      for (const t of b.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
    }
    return topN(tags, tags.size);
  }
}

function topN(counts: Map<string, number>, n: number) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}
