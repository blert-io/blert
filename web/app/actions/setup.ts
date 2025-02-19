'use server';

import {
  ChallengeType,
  DataRepository,
  User,
  isPostgresUniqueViolation,
} from '@blert/common';
import { randomBytes } from 'crypto';
import postgres from 'postgres';

import { auth } from '@/auth';
import { GearSetup } from '@/setups/setup';

import { webRepository } from './data-repository';
import { sql } from './db';
import redis from './redis';
import { where } from './query';

export type SetupState = 'draft' | 'published' | 'archived';

export type SetupRevision = {
  version: number;
  message: string | null;
  createdAt: Date;
  createdBy: number;
  createdByUsername: string;
};

export type SetupMetadata = {
  publicId: string;
  name: string;
  challengeType: ChallengeType;
  scale: number;
  authorId: number;
  author: string;
  state: SetupState;
  views: number;
  likes: number;
  dislikes: number;
  latestRevision: SetupRevision | null;
  draft: GearSetup | null;
};

export type VoteType = 'like' | 'dislike';

export type VoteCountsResult = {
  error: string | null;
  counts: {
    likes: number;
    dislikes: number;
  } | null;
};

export type SetupSort = 'latest' | 'score' | 'views';

export type SetupFilter = {
  author?: number;
  challenge?: ChallengeType;
  state?: SetupState;
  search?: string;
  orderBy?: SetupSort;
  scale?: number;
};

export type SetupListItem = {
  publicId: string;
  name: string;
  challengeType: ChallengeType;
  authorId: number;
  author: string;
  state: SetupState;
  views: number;
  likes: number;
  dislikes: number;
  score: number;
  createdAt: Date;
  updatedAt: Date | null;
};

export type SetupCursor = {
  createdAt: Date;
  score: number;
  views: number;
  direction?: 'forward' | 'backward';
  publicId: string;
};

export type SetupList = {
  setups: SetupListItem[];
  nextCursor: SetupCursor | null;
  prevCursor: SetupCursor | null;
  total: number;
  remaining: number;
};

function revisionDataKey(setupId: string, revisionId: number): string {
  return `gear-setups/${setupId}/rev-${revisionId}.json`;
}

function draftDataKey(setupId: string): string {
  return `gear-setups/${setupId}/draft.json`;
}

export async function newGearSetup(author: User): Promise<SetupMetadata> {
  while (true) {
    const publicId = randomBytes(8).toString('base64url');

    try {
      await sql`
        INSERT INTO gear_setups (
          public_id,
          author_id,
          name,
          challenge_type,
          state
        ) VALUES (
          ${publicId},
          ${author.id},
          'Untitled setup',
          ${ChallengeType.TOB},
          'draft'
        )
      `;
      return {
        publicId,
        name: 'Untitled setup',
        challengeType: ChallengeType.TOB,
        scale: 1,
        authorId: author.id,
        author: author.username,
        state: 'draft',
        views: 0,
        likes: 0,
        dislikes: 0,
        latestRevision: null,
        draft: null,
      };
    } catch (e) {
      if (!isPostgresUniqueViolation(e)) {
        throw e;
      }
      // If we hit a unique violation on `public_id`, try again with a new one.
      continue;
    }
  }
}

/**
 * Loads a gear setup with its latest revision and optional draft.
 * @param publicId The public ID of the setup.
 * @param loadDraft Whether to load a draft for the setup if one exists.
 * @returns The setup or null if the setup does not exist.
 */
export async function getSetupByPublicId(
  publicId: string,
  loadDraft: boolean = false,
): Promise<SetupMetadata | null> {
  const [setupRow] = await sql`
    SELECT
      s.public_id,
      s.name,
      s.challenge_type,
      s.scale,
      s.author_id,
      u.username as "author",
      s.state,
      s.has_draft,
      s.views,
      s.likes,
      s.dislikes,
      CASE WHEN s.latest_revision_id IS NOT NULL THEN jsonb_build_object(
        'version', r.version,
        'message', r.message,
        'createdAt', r.created_at,
        'createdBy', r.created_by
      ) END as "latest_revision"
    FROM gear_setups s
    LEFT JOIN gear_setup_revisions r ON r.id = s.latest_revision_id
    LEFT JOIN users u ON u.id = s.author_id
    WHERE s.public_id = ${publicId}
  `;

  if (!setupRow) {
    return null;
  }

  const setup: SetupMetadata = {
    publicId: setupRow.public_id,
    name: setupRow.name,
    challengeType: setupRow.challenge_type,
    scale: setupRow.scale,
    authorId: setupRow.author_id,
    author: setupRow.author,
    state: setupRow.state,
    views: setupRow.views,
    likes: setupRow.likes,
    dislikes: setupRow.dislikes,
    latestRevision: setupRow.latest_revision,
    draft: null,
  };

  if (loadDraft) {
    if (setupRow.has_draft) {
      try {
        const draftData = await webRepository.loadRaw(
          draftDataKey(setup.publicId),
        );
        if (draftData) {
          setup.draft = JSON.parse(new TextDecoder().decode(draftData));
        }
      } catch (e) {
        if (e instanceof DataRepository.NotFound) {
          return null;
        }
        throw e;
      }
    } else if (setupRow.latest_revision !== null) {
      // If there is no draft but one is requested, use the latest revision.
      const revision = await loadSetupData(
        setup.publicId,
        setupRow.latest_revision.version,
      );
      if (revision !== null) {
        setup.draft = revision;
      }
    }
  }

  return setup;
}

/**
 * Loads the data for a gear setup revision.
 * @param publicId The public ID of the setup.
 * @param revision The revision number.
 * @returns The setup data or null if the revision does not exist.
 */
export async function loadSetupData(
  publicId: string,
  revision: number,
): Promise<GearSetup | null> {
  try {
    const data = await webRepository.loadRaw(
      revisionDataKey(publicId, revision),
    );
    return JSON.parse(new TextDecoder().decode(data));
  } catch (e) {
    if (e instanceof DataRepository.NotFound) {
      return null;
    }
    throw e;
  }
}

/**
 * Saves a draft for a gear setup.
 * @param publicId The public ID of the setup.
 * @param setup The draft setup to save.
 */
export async function saveSetupDraft(
  publicId: string,
  setup: GearSetup,
): Promise<void> {
  const session = await auth();

  if (session === null || session.user.id === undefined) {
    throw new Error('Not authorized');
  }
  const userId = parseInt(session.user.id);

  const [current] = await sql<
    [{ id: number; author_id: number; state: SetupState }?]
  >`
    SELECT id, author_id, state
    FROM gear_setups
    WHERE public_id = ${publicId}
    FOR UPDATE
  `;

  if (!current) {
    throw new Error('Setup not found');
  }

  if (current.author_id !== userId) {
    throw new Error('Not authorized to modify this setup');
  }

  const updates: Record<string, unknown> = {
    has_draft: true,
  };

  if (current.state === 'draft') {
    // If the setup has not yet been published, change its name and scale to
    // match the latest draft.
    updates.name = setup.title;
    updates.scale = setup.players.length;
  }

  await sql`
    UPDATE gear_setups
    SET ${sql(updates)}
    WHERE id = ${current.id}
  `;

  await webRepository.saveRaw(
    draftDataKey(publicId),
    new TextEncoder().encode(JSON.stringify(setup)),
  );
}

/**
 * Publishes a new revision for a gear setup.
 * @param publicId The public ID of the setup.
 * @param setup The setup to publish.
 * @param message The message for the new revision.
 * @returns The updated setup metadata.
 */
export async function publishSetupRevision(
  publicId: string,
  setup: GearSetup,
  message: string | null,
): Promise<SetupMetadata> {
  const session = await auth();

  if (session === null || session.user.id === undefined) {
    throw new Error('Not authorized');
  }
  const userId = parseInt(session.user.id);

  if (setup.title.length === 0 || setup.description.length === 0) {
    throw new Error('Setup is missing required fields');
  }

  const { version } = await sql.begin(async (client) => {
    const [current] = await client<[{ id: number; author_id: number }?]>`
      SELECT id, author_id
      FROM gear_setups
      WHERE public_id = ${publicId}
      FOR UPDATE
    `;

    if (!current) {
      throw new Error('Setup not found');
    }

    if (current.author_id !== userId) {
      throw new Error('Not authorized to modify this setup');
    }

    const [revision] = await client<[{ id: number; version: number }]>`
      INSERT INTO gear_setup_revisions (
        setup_id,
        version,
        message,
        created_by
      )
      SELECT
        id,
        COALESCE(
          (
            SELECT version + 1
            FROM gear_setup_revisions
            WHERE setup_id = gear_setups.id
            ORDER BY version DESC
            LIMIT 1
          ),
          1
        ),
        ${message},
        ${userId}
      FROM gear_setups
      WHERE public_id = ${publicId}
      RETURNING id, version
    `;

    await client`
      UPDATE gear_setups
      SET
        name = ${setup.title},
        challenge_type = ${setup.challenge},
        scale = ${setup.players.length},
        latest_revision_id = ${revision.id},
        state = 'published',
        has_draft = FALSE,
        updated_at = NOW()
      WHERE id = ${current.id}
    `;

    return revision;
  });

  await webRepository.saveRaw(
    revisionDataKey(publicId, version),
    new TextEncoder().encode(JSON.stringify(setup)),
  );

  return getSetupByPublicId(publicId) as Promise<SetupMetadata>;
}

/**
 * Gets the current user's vote on a gear setup.
 * @param publicId The public ID of the setup.
 * @returns The user's vote type, or null if they haven't voted.
 */
export async function getCurrentVote(
  publicId: string,
): Promise<VoteType | null> {
  const session = await auth();
  if (session === null || session.user.id === undefined) {
    return null;
  }

  const userId = parseInt(session.user.id);

  const [vote] = await sql<[{ vote_type: VoteType } | undefined]>`
    SELECT vote_type::text
    FROM gear_setup_votes v
    JOIN gear_setups s ON s.id = v.setup_id
    WHERE s.public_id = ${publicId}
    AND v.user_id = ${userId}
  `;

  return vote?.vote_type ?? null;
}

/**
 * Votes on a gear setup.
 * @param publicId The public ID of the setup.
 * @param voteType The type of vote to cast.
 * @returns The updated vote counts.
 */
export async function voteSetup(
  publicId: string,
  voteType: VoteType,
): Promise<VoteCountsResult> {
  const session = await auth();
  if (session === null || session.user.id === undefined) {
    return { error: 'Not authorized', counts: null };
  }

  const userId = parseInt(session.user.id);

  try {
    const result = await sql.begin(async (client) => {
      const [setup] = await client<[{ id: number; author_id: number }?]>`
        SELECT id, author_id
        FROM gear_setups
        WHERE public_id = ${publicId}
        FOR UPDATE
    `;

      if (!setup) {
        throw new Error('Setup not found');
      }

      if (setup.author_id === userId) {
        throw new Error('Cannot vote on own setup');
      }

      // Insert or update the vote.
      await client`
        INSERT INTO gear_setup_votes (
          setup_id,
          user_id,
          vote_type
        ) VALUES (
          ${setup.id},
          ${userId},
          ${voteType}
        )
        ON CONFLICT (setup_id, user_id)
        DO UPDATE SET
          vote_type = EXCLUDED.vote_type,
          created_at = NOW()
      `;

      const [counts] = await client<[{ likes: number; dislikes: number }]>`
          UPDATE gear_setups
        SET
          likes = (
            SELECT COUNT(*)
            FROM gear_setup_votes
            WHERE setup_id = gear_setups.id
            AND vote_type = 'like'
          ),
          dislikes = (
            SELECT COUNT(*)
            FROM gear_setup_votes
            WHERE setup_id = gear_setups.id
            AND vote_type = 'dislike'
          )
        WHERE id = ${setup.id}
        RETURNING likes, dislikes
      `;

      return counts;
    });

    return {
      error: null,
      counts: result,
    };
  } catch (e) {
    return {
      error: (e as Error).message,
      counts: null,
    };
  }
}

/**
 * Removes a vote from a gear setup.
 * @param publicId The public ID of the setup.
 * @returns The updated vote counts.
 */
export async function removeVote(publicId: string): Promise<VoteCountsResult> {
  const session = await auth();
  if (session === null || session.user.id === undefined) {
    return { error: 'Not authorized', counts: null };
  }

  const userId = parseInt(session.user.id);

  try {
    const result = await sql.begin(async (client) => {
      const [setup] = await client<[{ id: number }?]>`
        SELECT id
        FROM gear_setups
        WHERE public_id = ${publicId}
        FOR UPDATE
    `;

      if (!setup) {
        throw new Error('Setup not found');
      }

      await client`
        DELETE FROM gear_setup_votes
        WHERE setup_id = ${setup.id}
        AND user_id = ${userId}
      `;

      const [counts] = await client<[{ likes: number; dislikes: number }]>`
        UPDATE gear_setups
        SET
          likes = (
            SELECT COUNT(*)
            FROM gear_setup_votes
            WHERE setup_id = gear_setups.id
            AND vote_type = 'like'
          ),
          dislikes = (
            SELECT COUNT(*)
            FROM gear_setup_votes
            WHERE setup_id = gear_setups.id
            AND vote_type = 'dislike'
          )
        WHERE id = ${setup.id}
        RETURNING likes, dislikes
      `;

      return counts;
    });

    return {
      error: null,
      counts: result,
    };
  } catch (e) {
    return {
      error: (e as Error).message,
      counts: null,
    };
  }
}

/**
 * Gets all revisions for a gear setup.
 * @param publicId The public ID of the setup.
 * @returns Array of revisions ordered by latest version.
 */
export async function getSetupRevisions(
  publicId: string,
): Promise<SetupRevision[]> {
  const [setup] = await sql<[{ id: number }?]>`
    SELECT id
    FROM gear_setups
    WHERE public_id = ${publicId}
  `;

  if (!setup) {
    return [];
  }

  const revisions = await sql<
    Array<{
      version: number;
      message: string | null;
      created_at: Date;
      created_by: number;
      username: string;
    }>
  >`
    SELECT
      r.version,
      r.message,
      r.created_at,
      r.created_by,
      u.username
    FROM gear_setup_revisions r
    JOIN users u ON u.id = r.created_by
    WHERE r.setup_id = ${setup.id}
    ORDER BY r.version DESC
  `;

  return revisions.map((r) => ({
    version: r.version,
    message: r.message,
    createdAt: r.created_at,
    createdBy: r.created_by,
    createdByUsername: r.username,
  }));
}

/**
 * Gets a paginated list of setups matching the given filters.
 * @param filter Filter criteria for the setups.
 * @param cursor Pagination cursor for the next page.
 * @param limit Maximum number of setups to return.
 * @returns The filtered and paginated list of setups.
 */
export async function getSetups(
  filter: SetupFilter = {},
  cursor: SetupCursor | null = null,
  limit: number = 20,
): Promise<SetupList> {
  const conditions: postgres.Fragment[] = [];

  if (filter.author !== undefined) {
    conditions.push(sql`s.author_id = ${filter.author}`);
  }

  if (filter.challenge !== undefined) {
    conditions.push(sql`s.challenge_type = ${filter.challenge}`);
  }

  if (filter.state !== undefined) {
    conditions.push(sql`s.state = ${filter.state}`);
  }

  if (filter.search !== undefined) {
    conditions.push(sql`(
      s.name ILIKE ${`%${filter.search}%`} OR
      u.username ILIKE ${`%${filter.search}%`}
    )`);
  }

  if (filter.scale !== undefined) {
    conditions.push(sql`s.scale = ${filter.scale}`);
  }

  const filterConditions = [...conditions];

  if (cursor !== null) {
    const isBackward = cursor.direction === 'backward';
    const operator = isBackward ? sql`>` : sql`<`;

    if (filter.orderBy === 'score') {
      conditions.push(sql`(
        s.score ${operator} ${cursor.score} OR
        (s.score = ${cursor.score} AND s.created_at ${operator} ${cursor.createdAt})
      )`);
    } else if (filter.orderBy === 'views') {
      conditions.push(sql`(
        s.views ${operator} ${cursor.views} OR
        (s.views = ${cursor.views} AND s.created_at ${operator} ${cursor.createdAt})
      )`);
    } else {
      conditions.push(sql`(s.created_at ${operator} ${cursor.createdAt})`);
    }

    conditions.push(sql`s.public_id != ${cursor.publicId}`);
  }

  let direction = cursor?.direction === 'backward' ? sql`ASC` : sql`DESC`;
  let orderBy;
  if (filter.orderBy === 'score') {
    orderBy = sql`s.score ${direction}, s.created_at ${direction}`;
  } else if (filter.orderBy === 'views') {
    orderBy = sql`s.views ${direction}, s.created_at ${direction}`;
  } else {
    orderBy = sql`s.created_at ${direction}`;
  }

  const [{ total, remaining }, setups] = await Promise.all([
    sql.begin(async (client) => {
      const [{ count }] = await client<[{ count: string }]>`
        SELECT COUNT(*) as count
        FROM gear_setups s
        JOIN users u ON u.id = s.author_id
        ${where(filterConditions)}
      `;

      const [{ count: after }] = await client<[{ count: string }]>`
        SELECT COUNT(*) as count
        FROM gear_setups s
        JOIN users u ON u.id = s.author_id
        ${where(conditions)}
      `;

      return { total: parseInt(count), remaining: parseInt(after) };
    }),
    sql`
      SELECT
        s.id,
        s.public_id,
        s.name,
        s.challenge_type,
        s.author_id,
        s.scale,
        u.username as "author",
        s.state,
        s.views,
        s.likes,
        s.dislikes,
        s.score,
        s.created_at,
        s.updated_at
      FROM gear_setups s
      JOIN users u ON u.id = s.author_id
      ${where(conditions)}
      ORDER BY ${orderBy}
      LIMIT ${limit}
    `,
  ]);

  let hasNextPage = false;
  let hasPrevPage = false;

  if (cursor?.direction === 'backward') {
    setups.reverse();
    hasPrevPage = remaining > limit;
    hasNextPage = true;
  } else {
    hasNextPage = remaining > limit;
    hasPrevPage = true;
  }

  let nextCursor: SetupCursor | null = null;
  let prevCursor: SetupCursor | null = null;

  if (setups.length > 0) {
    const first = setups[0];
    const last = setups[setups.length - 1];

    if (hasNextPage) {
      nextCursor = {
        createdAt: last.created_at,
        score: last.score,
        views: last.views,
        publicId: last.public_id,
        direction: 'forward',
      };
    }

    if (hasPrevPage) {
      prevCursor = {
        createdAt: first.created_at,
        score: first.score,
        views: first.views,
        publicId: first.public_id,
        direction: 'backward',
      };
    }
  }

  return {
    setups: setups.map((s) => ({
      publicId: s.public_id,
      name: s.name,
      challengeType: s.challenge_type,
      scale: s.scale,
      authorId: s.author_id,
      author: s.author,
      state: s.state,
      views: s.views,
      likes: s.likes,
      dislikes: s.dislikes,
      score: s.score,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    })),
    nextCursor,
    prevCursor,
    total,
    remaining,
  };
}

/**
 * Gets a list of setups for the current user.
 * @param limit Maximum number of setups to return.
 * @returns The user's setups, or null if not logged in.
 */
export async function getCurrentUserSetups(
  limit: number = 20,
): Promise<SetupList | null> {
  const session = await auth();
  if (session === null || session.user.id === undefined) {
    return null;
  }

  return getSetups({ author: parseInt(session.user.id) }, null, limit);
}

const VIEW_EXPIRY_SECONDS = 1 * 60 * 60; // 1 hour

/**
 * Increments the view count for a gear setup.
 * @param publicId The public ID of the setup.
 * @param viewerIp The IP address of the viewer for anonymous views.
 * @returns The updated view count.
 */
export async function incrementSetupViews(
  publicId: string,
  viewerIp: string,
): Promise<number> {
  const [session, redisClient] = await Promise.all([auth(), redis()]);
  const userId = session?.user?.id;

  return sql.begin(async (client) => {
    const [setup] = await client<[{ id: number }?]>`
      SELECT id
      FROM gear_setups
      WHERE public_id = ${publicId}
      FOR UPDATE
    `;

    if (!setup) {
      throw new Error('Setup not found');
    }

    // Use either the user ID or IP address to identify the viewer.
    const viewerKey = `web:setup-views:${setup.id}:${userId || viewerIp}`;

    const hasRecentView = await redisClient.exists(viewerKey);
    if (!hasRecentView) {
      await redisClient.set(viewerKey, '1', { EX: VIEW_EXPIRY_SECONDS });

      const [{ views }] = await client<[{ views: number }]>`
        UPDATE gear_setups
        SET views = views + 1
        WHERE id = ${setup.id}
        RETURNING views
      `;

      return views;
    }

    const [{ views }] = await client<[{ views: number }]>`
      SELECT views
      FROM gear_setups
      WHERE id = ${setup.id}
    `;

    return views;
  });
}
