import { createCache } from '@/api/cache';

import { sql } from './db';
import type { ConnectedPlayer } from './users';

/**
 * Stores the OSRS players connected to a user's account in the order
 * they were linked.
 */
export const connectedPlayersCache = createCache(
  { name: 'connected-players', ttlSec: 5 * 60 },
  (userId: number) => String(userId),
  async (userId: number): Promise<ConnectedPlayer[]> => {
    const players = await sql<ConnectedPlayer[]>`
      SELECT p.id, p.username
      FROM api_keys a
      JOIN players p ON a.player_id = p.id
      WHERE a.user_id = ${userId}
      ORDER BY a.id
    `;
    return players.map((p) => ({ id: p.id, username: p.username }));
  },
);
