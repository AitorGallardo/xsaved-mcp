// Shapes returned by the xsaved-rag HTTP API. The MCP server doesn't own any
// search/data logic — it just relays these.

export interface SearchHit {
  bookmarkId: string;
  author: string;
  text: string;
  notes?: string;
  tags: string[];
  rank: number;
  distance?: number; // present for vector/hybrid (cosine distance, lower = closer)
  keywordScore?: number; // present for keyword/hybrid (BM25-family rank)
}

export interface Bookmark {
  id: string;
  text: string;
  author: string;
  notes?: string;
  tags: string[];
  created_at?: string;
  bookmarked_at?: string;
}

export interface Stats {
  totalBookmarks: number;
  uniqueAuthors: number;
  dateRange: { earliest: string | null; latest: string | null };
  topAuthors: { name: string; count: number }[];
  topTags: { name: string; count: number }[];
}

export interface TagCount {
  name: string;
  count: number;
}
