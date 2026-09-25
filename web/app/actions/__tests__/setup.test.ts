import { ChallengeType, User } from '@blert/common';

jest.mock('@/actions/users', () => ({
  getSignedInUser: jest.fn(),
  getSignedInUserId: jest.fn(),
}));

import { sql } from '@/actions/db';
import { getSetups, SetupFilter, SetupState } from '@/actions/setup';
import { getSignedInUser } from '@/actions/users';

const mockedGetSignedInUser = getSignedInUser as jest.MockedFunction<
  typeof getSignedInUser
>;

async function insertUser(username: string): Promise<User> {
  const email = `${username}@example.com`;
  const [{ id, created_at }] = await sql<{ id: number; created_at: Date }[]>`
    INSERT INTO users (username, email)
    VALUES (${username}, ${email})
    RETURNING id, created_at
  `;
  return {
    id,
    username,
    displayUsername: null,
    createdAt: created_at,
    email,
    emailVerified: true,
    canCreateApiKey: false,
    discordId: null,
    discordUsername: null,
  };
}

async function insertSetup(
  author: User,
  state: SetupState,
  createdAt: Date,
): Promise<string> {
  const publicId = `${author.username}-${state}`;
  const setup = {
    author_id: author.id,
    public_id: publicId,
    name: `${author.username} ${state}`,
    challenge_type: ChallengeType.TOB,
    scale: 3,
    state,
    created_at: createdAt,
  };
  await sql`INSERT INTO gear_setups ${sql(setup)}`;
  return publicId;
}

async function listSetups(
  viewer: User | null,
  filter: SetupFilter,
): Promise<string[]> {
  mockedGetSignedInUser.mockResolvedValue(viewer);
  const result = await getSetups(filter, null, 50);
  expect(result.total).toBe(result.setups.length);
  return result.setups.map((setup) => setup.publicId);
}

afterAll(async () => {
  await sql.end();
});

describe('getSetups', () => {
  let alice: User;
  let bob: User;

  beforeAll(async () => {
    alice = await insertUser('alice');
    bob = await insertUser('bob');

    await insertSetup(alice, 'published', new Date('2026-09-01'));
    await insertSetup(alice, 'draft', new Date('2026-09-02'));
    await insertSetup(alice, 'unlisted', new Date('2026-09-03'));
    await insertSetup(alice, 'archived', new Date('2026-09-04'));
    await insertSetup(bob, 'published', new Date('2026-09-05'));
    await insertSetup(bob, 'draft', new Date('2026-09-06'));
    await insertSetup(bob, 'unlisted', new Date('2026-09-07'));
    await insertSetup(bob, 'archived', new Date('2026-09-08'));
  });

  afterAll(async () => {
    await sql`DELETE FROM gear_setups`;
    await sql`DELETE FROM users`;
  });

  describe('signed out', () => {
    it('returns only published setups', async () => {
      expect(await listSetups(null, {})).toEqual([
        'bob-published',
        'alice-published',
      ]);
    });

    it('returns nothing for a non-published state', async () => {
      expect(await listSetups(null, { state: 'draft' })).toEqual([]);
    });

    it('returns only published setups from a specified author', async () => {
      expect(await listSetups(null, { author: alice.id })).toEqual([
        'alice-published',
      ]);
    });
  });

  describe('signed in', () => {
    it("returns published setups and all of the user's own", async () => {
      expect(await listSetups(alice, {})).toEqual([
        'bob-published',
        'alice-archived',
        'alice-unlisted',
        'alice-draft',
        'alice-published',
      ]);
    });

    it('returns all published setups when filtering by published', async () => {
      expect(await listSetups(alice, { state: 'published' })).toEqual([
        'bob-published',
        'alice-published',
      ]);
    });

    it("returns only the viewer's own setups for a non-published state", async () => {
      expect(await listSetups(alice, { state: 'draft' })).toEqual([
        'alice-draft',
      ]);
    });

    it("returns all of the viewer's setups when filtering by themselves", async () => {
      expect(await listSetups(alice, { author: alice.id })).toEqual([
        'alice-archived',
        'alice-unlisted',
        'alice-draft',
        'alice-published',
      ]);
    });

    it('returns only published setups from another author', async () => {
      expect(await listSetups(alice, { author: bob.id })).toEqual([
        'bob-published',
      ]);
      expect(
        await listSetups(alice, { author: bob.id, state: 'unlisted' }),
      ).toEqual([]);
    });
  });
});
