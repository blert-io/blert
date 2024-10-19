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
  const results = await sql`
    SELECT id, username, strict_word_similarity(username, ${query}) AS similarity
    FROM players
    WHERE NOT starts_with(username, '*')
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
