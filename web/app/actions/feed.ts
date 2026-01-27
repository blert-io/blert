'use server';

import {
  ChallengeMode,
  ChallengeType,
  NameChangeStatus,
  RELEVANT_PB_SPLITS,
  SessionStatus,
  SplitType,
  splitName,
} from '@blert/common';
import type { SessionRow } from '@blert/common/dist/db/challenge';
import postgres from 'postgres';

import { clamp } from '@/utils/math';

import { sql } from './db';
import { AuthenticationError } from './errors';
import {
  ChallengeOverview,
  SessionWithChallenges,
  findChallenges,
} from './challenge';
import { getConnectedPlayers, getSignedInUserId } from './users';

export type SessionFeedItem = {
  type: 'session';
  id: number;
  timestamp: Date;
  session: SessionWithChallenges;
  followedPlayers: string[];
  partyCurrentNames: string[];
};

export type PersonalBestFeedItem = {
  type: 'personal_best';
  id: number;
  timestamp: Date;
  player: string;
  splitType: SplitType;
  splitName: string;
  scale: number;
  ticks: number;
  previousTicks: number | null;
  challengeUuid: string;
  challengeType: ChallengeType;
  challengeMode: ChallengeMode;
};

export type NameChangeFeedItem = {
  type: 'name_change';
  id: number;
  timestamp: Date;
  playerId: number;
  oldName: string;
  newName: string;
  currentName: string;
};

export type FeedItem =
  | SessionFeedItem
  | PersonalBestFeedItem
  | NameChangeFeedItem;

const FEED_ITEM_TYPE_PRIORITY: Record<FeedItem['type'], number> = {
  session: 0,
  personal_best: 1,
  name_change: 2,
};

export type FollowedPlayer = {
  id: number;
  username: string;
  followedAt: Date;
};

async function ensureAuthenticated(): Promise<number> {
  const userId = await getSignedInUserId();
  if (userId === null) {
    throw new AuthenticationError();
  }
  return userId;
}

/**
 * Follow a player by their username.
 * Creates a new follow relationship if one doesn't exist.
 * @param username The username of the player to follow.
 * @returns The followed player, or null if the player doesn't exist.
 */
export async function followPlayer(
  username: string,
): Promise<FollowedPlayer | null> {
  const userId = await ensureAuthenticated();

  const [player] = await sql<{ id: number; username: string }[]>`
    SELECT id, username
    FROM players
    WHERE lower(username) = ${username.toLowerCase()}
  `;

  if (!player) {
    return null;
  }

  const [follow] = await sql<{ created_at: Date }[]>`
    INSERT INTO user_follows (user_id, player_id)
    VALUES (${userId}, ${player.id})
    ON CONFLICT (user_id, player_id) DO UPDATE SET created_at = NOW()
    RETURNING created_at
  `;

  return {
    id: player.id,
    username: player.username,
    followedAt: follow.created_at,
  };
}

/**
 * Unfollow a player by their player ID.
 * @param playerId The ID of the player to unfollow.
 */
export async function unfollowPlayer(playerId: number): Promise<void> {
  const userId = await ensureAuthenticated();

  await sql`
    DELETE FROM user_follows
    WHERE user_id = ${userId} AND player_id = ${playerId}
  `;
}

export type FollowingResult = {
  players: FollowedPlayer[];
  totalCount: number;
  cursor: string | null;
};

type FollowingCursor = {
  timestamp: Date;
  playerId: number;
};

function encodeFollowingCursor(cursor: FollowingCursor): string {
  return `${cursor.timestamp.toISOString()}|${cursor.playerId}`;
}

function decodeFollowingCursor(cursor: string): FollowingCursor | null {
  const parts = cursor.split('|');
  if (parts.length !== 2) {
    return null;
  }

  const timestamp = new Date(parts[0]);
  if (isNaN(timestamp.getTime())) {
    return null;
  }

  const playerId = parseInt(parts[1], 10);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return null;
  }

  return { timestamp, playerId };
}

/**
 * Get the list of players the current user is following.
 * @param options Pagination options.
 * @returns Paginated list of followed players sorted by most recently followed.
 */
export async function getFollowing(options?: {
  cursor?: string;
  limit?: number;
}): Promise<FollowingResult> {
  const userId = await ensureAuthenticated();
  const limit = clamp(options?.limit ?? 50, 1, 100);

  const cursor = options?.cursor ? decodeFollowingCursor(options.cursor) : null;

  const cursorCondition =
    cursor !== null
      ? sql`AND (uf.created_at, uf.player_id) < (${cursor.timestamp}, ${cursor.playerId})`
      : sql``;

  const [follows, countResult] = await Promise.all([
    sql<{ id: number; username: string; created_at: Date }[]>`
      SELECT p.id, p.username, uf.created_at
      FROM user_follows uf
      JOIN players p ON uf.player_id = p.id
      WHERE uf.user_id = ${userId}
        ${cursorCondition}
      ORDER BY uf.created_at DESC, uf.player_id DESC
      LIMIT ${limit}
    `,
    sql<{ count: string }[]>`
      SELECT COUNT(*) as count
      FROM user_follows
      WHERE user_id = ${userId}
    `,
  ]);

  const players = follows.map((f) => ({
    id: f.id,
    username: f.username,
    followedAt: f.created_at,
  }));

  const nextCursor =
    follows.length > 0
      ? encodeFollowingCursor({
          timestamp: follows[follows.length - 1].created_at,
          playerId: follows[follows.length - 1].id,
        })
      : null;

  return {
    players,
    totalCount: parseInt(countResult[0].count, 10),
    cursor: nextCursor,
  };
}

/**
 * Check if the current user is following a specific player.
 * @param playerId The player ID to check.
 * @returns True if the user is following the player.
 */
export async function isFollowing(playerId: number): Promise<boolean> {
  const userId = await getSignedInUserId();
  if (userId === null) {
    return false;
  }

  const [follow] = await sql<{ user_id: number }[]>`
    SELECT user_id
    FROM user_follows
    WHERE user_id = ${userId} AND player_id = ${playerId}
    LIMIT 1
  `;

  return follow !== undefined;
}

/**
 * Check if the current user is following a player by username.
 * @param username The player username to check.
 * @returns True if the user is following the player.
 */
export async function isFollowingByUsername(
  username: string,
): Promise<boolean> {
  const userId = await getSignedInUserId();
  if (userId === null) {
    return false;
  }

  const [follow] = await sql<{ user_id: number }[]>`
    SELECT uf.user_id
    FROM user_follows uf
    JOIN players p ON uf.player_id = p.id
    WHERE uf.user_id = ${userId} AND lower(p.username) = ${username.toLowerCase()}
    LIMIT 1
  `;

  return follow !== undefined;
}

type SessionWithPlayers = SessionRow & {
  player_ids: number[];
  player_usernames: string[];
  player_current_usernames: string[];
  followed_player_usernames: string[];
};

type PbHistoryRow = {
  id: number;
  created_at: Date;
  username: string;
  split_type: SplitType;
  split_scale: number;
  ticks: number;
  previous_ticks: number | null;
  challenge_uuid: string;
  challenge_type: ChallengeType;
  challenge_mode: ChallengeMode;
};

type NameChangeRow = {
  id: number;
  player_id: number;
  old_name: string;
  new_name: string;
  current_name: string;
  processed_at: Date;
};

type FeedCursor = {
  timestamp: Date;
  type: FeedItem['type'];
  id: number;
};

export type FeedQuery = {
  cursor?: string;
  direction?: 'older' | 'newer';
  limit?: number;
};

export type FeedResult = {
  items: FeedItem[];
  /** Cursor to fetch older items (for "load more"). */
  olderCursor: FeedCursorString | null;
  /** Cursor to fetch newer items (for polling). */
  newerCursor: FeedCursorString | null;
};

/**
 * Opaque string representation of a feed cursor.
 * Format: "timestamp|type|id"
 * - timestamp: ISO string
 * - type: 'session', 'personal_best', 'name_change' (case-insensitive)
 * - id: numeric ID of the item
 */
type FeedCursorString = `${string}|${FeedItem['type']}|${number}`;

/**
 * Encode a feed cursor as an opaque string.
 */
function encodeFeedCursor(cursor: FeedCursor): FeedCursorString {
  return `${cursor.timestamp.toISOString()}|${cursor.type}|${cursor.id}`;
}

/**
 * Decode a feed cursor from an opaque string.
 */
function decodeFeedCursor(cursor: string): FeedCursor | null {
  const parts = cursor.split('|');
  if (parts.length !== 3) {
    return null;
  }

  const [ts, typeStr, idStr] = parts;
  const timestamp = new Date(ts);
  if (isNaN(timestamp.getTime())) {
    return null;
  }

  if (
    typeStr !== 'session' &&
    typeStr !== 'personal_best' &&
    typeStr !== 'name_change'
  ) {
    return null;
  }

  const id = parseInt(idStr, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return { timestamp, type: typeStr, id };
}

/**
 * Build a cursor from a feed response for subsequent pagination.
 *
 * For 'older' direction: cursor points to the oldest (last) item, used to load
 * more historical items.
 *
 * For 'newer' direction: cursor points to the newest (first) item, used for
 * polling for new items.
 *
 * @param items The feed items from the response.
 * @param direction The direction for the next query using this cursor.
 */
function buildFeedCursor(
  items: FeedItem[],
  direction: 'older' | 'newer',
): FeedCursorString | null {
  if (items.length === 0) {
    return null;
  }
  const boundaryItem =
    direction === 'older' ? items[items.length - 1] : items[0];
  return encodeFeedCursor(boundaryItem);
}

function buildCursorCondition(args: {
  cursor: FeedCursor;
  direction: 'older' | 'newer';
  rowTime: postgres.Fragment;
  rowId: postgres.Fragment;
  rowType: FeedItem['type'];
}): postgres.Fragment {
  const { cursor, direction, rowTime, rowId, rowType } = args;

  const rowPriority = FEED_ITEM_TYPE_PRIORITY[rowType];
  const cursorPriority = FEED_ITEM_TYPE_PRIORITY[cursor.type];

  if (direction === 'older') {
    return sql`AND (
      ${rowTime} < ${cursor.timestamp}
      OR (
        ${rowTime} = ${cursor.timestamp}
        AND (
          ${rowPriority} > ${cursorPriority}
          OR (${rowPriority} = ${cursorPriority} AND ${rowId} < ${cursor.id})
        )
      )
    )`;
  }

  return sql`AND (
    ${rowTime} > ${cursor.timestamp}
    OR (
      ${rowTime} = ${cursor.timestamp}
      AND (
        ${rowPriority} < ${cursorPriority}
        OR (${rowPriority} = ${cursorPriority} AND ${rowId} > ${cursor.id})
      )
    )
  )`;
}

async function fetchSessionFeedItems(
  userId: number,
  cursor: FeedCursor | null,
  direction: 'older' | 'newer',
  limit: number,
): Promise<SessionFeedItem[]> {
  const cursorCondition =
    cursor !== null
      ? buildCursorCondition({
          cursor,
          direction,
          rowTime: sql`cs.sort_time`,
          rowId: sql`cs.id`,
          rowType: 'session',
        })
      : sql``;

  const sessions = await sql<SessionWithPlayers[]>`
    WITH followed_sessions AS (
      SELECT DISTINCT
        c.session_id,
        cs.id as session_row_id,
        cs.sort_time as sort_time
      FROM challenges c
      JOIN challenge_players cp ON c.id = cp.challenge_id
      JOIN challenge_sessions cs ON c.session_id = cs.id
      JOIN user_follows uf
        ON cp.player_id = uf.player_id AND uf.user_id = ${userId}
      WHERE cs.status != ${SessionStatus.HIDDEN}
        ${cursorCondition}
      ORDER BY sort_time DESC, session_row_id DESC
      LIMIT ${limit * 2}
    ),
    session_players AS (
      SELECT
        session_id,
        array_agg(player_id ORDER BY player_id) as player_ids,
        array_agg(username ORDER BY player_id) as player_usernames,
        array_agg(current_username ORDER BY player_id) as player_current_usernames,
        array_agg(current_username ORDER BY player_id)
          FILTER (WHERE is_followed) as followed_player_usernames
      FROM (
        SELECT DISTINCT
          c.session_id,
          cp.player_id,
          cp.username,
          p.username as current_username,
          uf.user_id IS NOT NULL as is_followed
        FROM challenges c
        JOIN challenge_players cp ON c.id = cp.challenge_id
        JOIN players p ON cp.player_id = p.id
        LEFT JOIN user_follows uf
          ON cp.player_id = uf.player_id AND uf.user_id = ${userId}
        WHERE c.session_id IN (SELECT session_id FROM followed_sessions)
      ) unique_players
      GROUP BY session_id
    )
    SELECT
      cs.*,
      sp.player_ids,
      sp.player_usernames,
      sp.player_current_usernames,
      sp.followed_player_usernames
    FROM challenge_sessions cs
    JOIN followed_sessions fs ON cs.id = fs.session_id
    JOIN session_players sp ON cs.id = sp.session_id
    ORDER BY cs.sort_time DESC, cs.id DESC
  `;

  if (sessions.length === 0) {
    return [];
  }

  const sessionsByUuid = new Map(
    sessions.map((s) => [
      s.uuid,
      {
        ...s,
        challenges: [] as ChallengeOverview[],
        party: s.player_usernames,
      },
    ]),
  );

  const [challenges] = await findChallenges(null, {
    session: sessions.map((s) => s.id),
  });

  for (const c of challenges) {
    sessionsByUuid.get(c.sessionUuid)?.challenges.push(c);
  }

  const items: SessionFeedItem[] = [];
  for (const session of sessions) {
    const sessionData = sessionsByUuid.get(session.uuid);
    if (!sessionData || sessionData.challenges.length === 0) {
      continue;
    }

    const sessionWithChallenges: SessionWithChallenges = {
      uuid: session.uuid,
      challengeType: session.challenge_type,
      challengeMode: session.challenge_mode,
      scale: session.scale,
      startTime: session.start_time,
      endTime: session.end_time,
      status: session.status,
      party: session.player_usernames,
      challenges: sessionData.challenges.toSorted(
        (a, b) => b.startTime.getTime() - a.startTime.getTime(),
      ),
    };

    items.push({
      type: 'session',
      id: session.id,
      timestamp: session.end_time ?? session.start_time,
      session: sessionWithChallenges,
      followedPlayers: session.followed_player_usernames ?? [],
      partyCurrentNames: session.player_current_usernames,
    });
  }

  return items;
}

async function fetchPbFeedItems(
  userId: number,
  cursor: FeedCursor | null,
  direction: 'older' | 'newer',
  limit: number,
): Promise<PersonalBestFeedItem[]> {
  const cursorCondition =
    cursor !== null
      ? buildCursorCondition({
          cursor,
          direction,
          rowTime: sql`pbh.created_at`,
          rowId: sql`pbh.id`,
          rowType: 'personal_best',
        })
      : sql``;

  // TODO(frolv): Consider denormalization of split type and scale into personal
  // best history as it grows.
  const pbs = await sql<PbHistoryRow[]>`
    WITH pbh_page AS MATERIALIZED (
      SELECT
        pbh.id,
        pbh.created_at,
        pbh.player_id,
        pbh.challenge_split_id,
        cs.type AS split_type,
        cs.scale AS split_scale,
        cs.ticks,
        cs.challenge_id
      FROM personal_best_history pbh
      JOIN user_follows uf
        ON uf.user_id = ${userId} AND uf.player_id = pbh.player_id
      JOIN challenge_splits cs
        ON cs.id = pbh.challenge_split_id
      WHERE cs.type = ANY(${RELEVANT_PB_SPLITS})
        ${cursorCondition}
      ORDER BY pbh.created_at DESC, pbh.id DESC
      LIMIT ${limit * 2}
    ),
    page_rows AS (
      SELECT
        pbh.*,
        LAG(pbh.ticks) OVER (
          PARTITION BY pbh.player_id, pbh.split_type, pbh.split_scale
          ORDER BY pbh.created_at, pbh.id
        ) AS previous_ticks_in_page
      FROM pbh_page pbh
    ),
    boundary_per_group AS (
      SELECT DISTINCT ON (player_id, split_type, split_scale)
        player_id, split_type, split_scale, created_at, id
      FROM pbh_page
      ORDER BY player_id, split_type, split_scale, created_at, id
    ),
    prev_outside_page AS (
      SELECT
        b.player_id, b.split_type, b.split_scale,
        prev.ticks AS previous_ticks
      FROM boundary_per_group b
      JOIN LATERAL (
        SELECT cs2.ticks
        FROM personal_best_history pbh2
        JOIN challenge_splits cs2 ON cs2.id = pbh2.challenge_split_id
        WHERE pbh2.player_id = b.player_id
          AND cs2.type = b.split_type
          AND cs2.scale = b.split_scale
          AND (pbh2.created_at, pbh2.id) < (b.created_at, b.id)
        ORDER BY pbh2.created_at DESC, pbh2.id DESC
        LIMIT 1
      ) prev ON true
    )
    SELECT
      p.id,
      p.created_at,
      pl.username,
      p.split_type,
      p.split_scale,
      p.ticks,
      COALESCE(p.previous_ticks_in_page, po.previous_ticks) AS previous_ticks,
      c.uuid as challenge_uuid,
      c.type as challenge_type,
      c.mode as challenge_mode
    FROM page_rows p
    JOIN players pl ON pl.id = p.player_id
    JOIN challenges c ON c.id = p.challenge_id
    LEFT JOIN prev_outside_page po
      ON po.player_id = p.player_id
     AND po.split_type = p.split_type
     AND po.split_scale = p.split_scale
    ORDER BY p.created_at DESC, p.id DESC
  `;

  return pbs.map((pb) => ({
    type: 'personal_best',
    id: pb.id,
    timestamp: pb.created_at,
    player: pb.username,
    splitType: pb.split_type,
    splitName: splitName(pb.split_type, true),
    scale: pb.split_scale,
    ticks: pb.ticks,
    previousTicks: pb.previous_ticks,
    challengeUuid: pb.challenge_uuid,
    challengeType: pb.challenge_type,
    challengeMode: pb.challenge_mode,
  }));
}

async function fetchNameChangeFeedItems(
  userId: number,
  cursor: FeedCursor | null,
  direction: 'older' | 'newer',
  limit: number,
): Promise<NameChangeFeedItem[]> {
  const cursorCondition =
    cursor !== null
      ? buildCursorCondition({
          cursor,
          direction,
          rowTime: sql`nc.processed_at`,
          rowId: sql`nc.id`,
          rowType: 'name_change',
        })
      : sql``;

  const nameChanges = await sql<NameChangeRow[]>`
    SELECT
      nc.id,
      nc.player_id,
      nc.old_name,
      nc.new_name,
      p.username as current_name,
      nc.processed_at
    FROM name_changes nc
    JOIN players p ON nc.player_id = p.id
    JOIN user_follows uf
      ON nc.player_id = uf.player_id AND uf.user_id = ${userId}
    WHERE nc.status = ${NameChangeStatus.ACCEPTED}
      AND nc.hidden = FALSE
      AND nc.processed_at IS NOT NULL
      ${cursorCondition}
    ORDER BY nc.processed_at DESC, nc.id DESC
    LIMIT ${limit * 2}
  `;

  return nameChanges.map((nc) => ({
    type: 'name_change',
    id: nc.id,
    timestamp: nc.processed_at,
    playerId: nc.player_id,
    oldName: nc.old_name,
    newName: nc.new_name,
    currentName: nc.current_name,
  }));
}

/**
 * Load the personalized feed for the current user.
 * Combines sessions and personal bests from followed players into a single
 * chronological feed.
 * @param query Pagination options.
 * @returns Feed items sorted by timestamp (most recent first), with cursor.
 */
export async function loadFeed(query: FeedQuery = {}): Promise<FeedResult> {
  const userId = await ensureAuthenticated();
  const limit = query.limit ?? 20;
  const direction = query.direction ?? 'older';
  const cursor = query.cursor ? decodeFeedCursor(query.cursor) : null;

  const [sessionItems, pbItems, nameChangeItems] = await Promise.all([
    fetchSessionFeedItems(userId, cursor, direction, limit),
    fetchPbFeedItems(userId, cursor, direction, limit),
    fetchNameChangeFeedItems(userId, cursor, direction, limit),
  ]);

  // Merge and sort by (timestamp DESC, type priority, id DESC).
  const allItems: FeedItem[] = [
    ...sessionItems,
    ...pbItems,
    ...nameChangeItems,
  ];
  allItems.sort((a, b) => {
    const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    const typeDiff =
      FEED_ITEM_TYPE_PRIORITY[a.type] - FEED_ITEM_TYPE_PRIORITY[b.type];
    if (typeDiff !== 0) {
      return typeDiff;
    }
    return b.id - a.id;
  });

  const items = allItems.slice(0, limit);
  const olderCursor = buildFeedCursor(items, 'older');
  const newerCursor = buildFeedCursor(items, 'newer');
  return { items, olderCursor, newerCursor };
}

export type SuggestedPlayer = {
  id: number;
  username: string;
  totalChallenges: number;
};

const MIN_RECORDINGS_FOR_SUGGESTION = 3;
const MAX_SUGGESTED_PLAYERS = 50;

export type SuggestionsQuery = {
  limit?: number;
  exclude?: number[];
};

/**
 * Get suggested players to follow for the current user.
 *
 * Suggestions are fetched fresh each time (no caching) to ensure accuracy.
 * The FollowManager component handles client-side buffering for smooth UX.
 *
 * @param query Query options including limit and player IDs to exclude.
 * @returns Suggested players.
 */
export async function getSuggestedPlayers(
  query: SuggestionsQuery = {},
): Promise<SuggestedPlayer[]> {
  const userId = await getSignedInUserId();
  if (userId === null) {
    return [];
  }

  const limit = clamp(query.limit ?? 5, 1, MAX_SUGGESTED_PLAYERS);
  const excludeIds = query.exclude ?? [];

  const connectedPlayers = await getConnectedPlayers();
  const connectedPlayerIds = connectedPlayers.map((p) => p.id);

  // Combine connected players and explicit excludes.
  const allExcludeIds = [...new Set([...connectedPlayerIds, ...excludeIds])];

  let allPlayers: SuggestedPlayer[] = [];

  // If user has connected players, find raid partners first.
  // Only suggest partners who have enough recordings to provide feed value.
  if (connectedPlayerIds.length > 0) {
    const partnerResults = await sql<
      { partner_id: number; username: string; total_challenges: number }[]
    >`
      WITH partner_stats AS (
        SELECT
          CASE
            WHEN player_id_1 = ANY(${connectedPlayerIds}) THEN player_id_2
            ELSE player_id_1
          END AS partner_id,
          SUM(challenge_count * EXP(-0.02 * (CURRENT_DATE - day_bucket))) AS score
        FROM mv_daily_player_pairs
        WHERE player_id_1 = ANY(${connectedPlayerIds})
           OR player_id_2 = ANY(${connectedPlayerIds})
        GROUP BY partner_id
      )
      SELECT
        ps.partner_id,
        p.username,
        p.total_recordings AS total_challenges
      FROM partner_stats ps
      JOIN players p ON ps.partner_id = p.id
      WHERE ps.partner_id != ALL(${allExcludeIds})
        AND p.total_recordings >= ${MIN_RECORDINGS_FOR_SUGGESTION}
        AND NOT EXISTS (
          SELECT 1 FROM user_follows uf
          WHERE uf.user_id = ${userId} AND uf.player_id = ps.partner_id
        )
      ORDER BY ps.score DESC
      LIMIT ${limit}
    `;

    allPlayers = partnerResults.map((s) => ({
      id: s.partner_id,
      username: s.username,
      totalChallenges: s.total_challenges,
    }));
  }

  if (allPlayers.length < limit) {
    const remaining = limit - allPlayers.length;
    const activePlayers = await suggestActivePlayers(userId, remaining, [
      ...allExcludeIds,
      ...allPlayers.map((p) => p.id),
    ]);
    allPlayers.push(...activePlayers);
  }

  return allPlayers;
}

// Randomly sample from the most active and recently active players.
async function suggestActivePlayers(
  userId: number,
  limit: number,
  excludeIds: number[],
): Promise<SuggestedPlayer[]> {
  const mostActiveResults = await sql<
    { player_id: number; username: string; total_challenges: number }[]
  >`
    SELECT
      cp.player_id,
      p.username,
      p.total_recordings AS total_challenges
    FROM challenge_players cp
    JOIN challenges c ON c.id = cp.challenge_id
    JOIN players p ON p.id = cp.player_id
    WHERE c.start_time > NOW() - INTERVAL '6 months'
      ${excludeIds.length > 0 ? sql`AND cp.player_id != ALL(${excludeIds})` : sql``}
      AND NOT EXISTS (
        SELECT 1 FROM user_follows uf
        WHERE uf.user_id = ${userId} AND uf.player_id = cp.player_id
      )
    GROUP BY cp.player_id, p.username, p.total_recordings
    ORDER BY COUNT(*) DESC
    LIMIT ${MAX_SUGGESTED_PLAYERS}
  `;

  const mostActive = mostActiveResults.map((s) => ({
    id: s.player_id,
    username: s.username,
    totalChallenges: s.total_challenges,
  }));

  const excludeFromRecent = [...excludeIds, ...mostActive.map((p) => p.id)];

  const recentlyActiveResults = await sql<
    { player_id: number; username: string; total_challenges: number }[]
  >`
    SELECT DISTINCT ON (cp.player_id)
      cp.player_id,
      p.username,
      p.total_recordings AS total_challenges
    FROM challenge_players cp
    JOIN challenges c ON c.id = cp.challenge_id
    JOIN players p ON p.id = cp.player_id
    WHERE c.start_time > NOW() - INTERVAL '7 days'
      ${excludeFromRecent.length > 0 ? sql`AND cp.player_id != ALL(${excludeFromRecent})` : sql``}
      AND NOT EXISTS (
        SELECT 1 FROM user_follows uf
        WHERE uf.user_id = ${userId} AND uf.player_id = cp.player_id
      )
    ORDER BY cp.player_id, c.start_time DESC
    LIMIT ${MAX_SUGGESTED_PLAYERS}
  `;

  const recentlyActive = recentlyActiveResults.map((s) => ({
    id: s.player_id,
    username: s.username,
    totalChallenges: s.total_challenges,
  }));

  const allPlayers: SuggestedPlayer[] = [];
  while (allPlayers.length < limit) {
    let pool = Math.random() < 0.6 ? mostActive : recentlyActive;
    if (pool.length === 0) {
      pool = pool === mostActive ? recentlyActive : mostActive;
      if (pool.length === 0) {
        break;
      }
    }

    const i = Math.floor(Math.random() * pool.length);
    const last = pool.length - 1;
    [pool[i], pool[last]] = [pool[last], pool[i]];
    allPlayers.push(pool.pop()!);
  }

  return allPlayers;
}
