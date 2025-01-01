'use server';

import {
  ChallengeType,
  DataRepository,
  isPostgresUniqueViolation,
  User,
} from '@blert/common';
import { randomBytes } from 'crypto';

import { auth } from '@/auth';
import { GearSetup } from '@/setups/setup';

import { webRepository } from './data-repository';
import { sql } from './db';

export type SetupRevision = {
  version: number;
  message: string | null;
  createdAt: Date;
  createdBy: number;
  setup: GearSetup;
};

export type SetupMetadata = {
  publicId: string;
  name: string;
  challengeType: ChallengeType;
  authorId: number;
  author: string;
  state: 'draft' | 'published' | 'archived';
  latestRevision: SetupRevision | null;
  draft: GearSetup | null;
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
        authorId: author.id,
        author: author.username,
        state: 'draft',
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
      s.author_id,
      u.username as "author",
      s.state,
      s.has_draft,
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
    authorId: setupRow.author_id,
    author: setupRow.author,
    state: setupRow.state,
    latestRevision: null,
    draft: null,
  };

  if (loadDraft && setupRow.has_draft) {
    try {
      const draftData = await webRepository.loadRaw(
        draftDataKey(setup.publicId),
      );
      if (draftData) {
        setup.draft = JSON.parse(new TextDecoder().decode(draftData));
      }
    } catch (e) {
      if (e instanceof DataRepository.BackendError) {
        return null;
      }
      throw e;
    }
  } else {
    setup.draft = null;
  }

  if (setupRow.latest_revision !== null) {
    try {
      const revisionData = await webRepository.loadRaw(
        revisionDataKey(setup.publicId, setupRow.latest_revision.version),
      );
      const setupData = JSON.parse(new TextDecoder().decode(revisionData));
      setup.latestRevision = {
        ...setupRow.latest_revision,
        setup: setupData,
      };
      if (loadDraft && setup.draft === null) {
        setup.draft = setupData;
      }
    } catch (e) {
      if (e instanceof DataRepository.BackendError) {
        return null;
      }
      throw e;
    }
  }

  return setup;
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

  const [current] = await sql<[{ id: number; author_id: number }?]>`
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

  await sql`
    UPDATE gear_setups
    SET has_draft = TRUE
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
