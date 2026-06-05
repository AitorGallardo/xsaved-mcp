// A single bookmark, normalised from the raw JSON corpus.
export interface Bookmark {
  id: string;
  text: string;
  author: string;
  notes?: string;
  tags: string[];
  createdAt: string; // when the tweet was posted
  bookmarkedAt: string; // when the user saved it
}

// What a search returns per hit: the bookmark plus a relevance score.
export interface SearchHit extends Bookmark {
  score: number;
}
