import { normalizeRsn } from '@blert/common';

import { sql } from './db';

export const enum SuggestionType {
  PLAYER,
}

export type Suggestion = {
  type: SuggestionType;
  value: string;
};

export type Suggestions = {
  query: string;
  results: Suggestion[];
};

export async function suggestPlayers(
  query: string,
  limit: number,
): Promise<Suggestions> {
  const normalizedQuery = normalizeRsn(query);

  const results = await sql<{ username: string; similarity: number }[]>`
    SELECT
      username,
      word_similarity(${normalizedQuery}, normalized_username) AS similarity
    FROM
      players,
      set_config('pg_trgm.word_similarity_threshold', 0.4::text, true)
    WHERE normalized_username %> ${normalizedQuery}
      AND NOT starts_with(normalized_username, '*')
    ORDER BY similarity DESC
    LIMIT ${limit}
  `;

  return {
    query,
    results: results.map((row) => ({
      type: SuggestionType.PLAYER,
      value: row.username,
    })),
  };
}
