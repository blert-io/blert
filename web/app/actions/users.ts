'use server';

import { randomBytes } from 'crypto';
import {
  ApiKey,
  ApiKeyModel,
  PlayerModel,
  User,
  UserModel,
  hiscoreLookup,
} from '@blert/common';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { isRedirectError } from 'next/dist/client/components/redirect';
import { z } from 'zod';

import { auth, signIn } from '@/auth';
import connectToDatabase from './db';

const SALT_ROUNDS = 10;

const formSchema = z.object({
  username: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{2,24}$/, {
      message: 'Only letters, numbers, hyphens, or underscores',
    })
    .trim(),
  email: z.string().email({ message: 'Invalid email address' }),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters' })
    .max(96, { message: 'Password must be at most 96 characters' })
    .trim(),
});

/**
 * Checks if a user with the specified username exists in the database.
 * @param username The username to check.
 * @returns Promise resolving to true if the user exists, false otherwise.
 */
export async function userExists(username: string): Promise<boolean> {
  await connectToDatabase();

  return UserModel.findOne({ username }, { _id: 1 })
    .exec()
    .then((user) => user !== null);
}

export async function verifyUser(
  username: string,
  password: string,
): Promise<string> {
  await connectToDatabase();

  const user = await UserModel.findOne({ username });
  if (user !== null) {
    const validPassword = await bcrypt.compare(password, user.password);
    if (validPassword) {
      return user._id.toString();
    }
  }

  throw new Error('Invalid username or password');
}

export async function login(
  _state: string | null,
  formData: FormData,
): Promise<string | null> {
  try {
    await signIn('credentials', {
      username: formData.get('blert-username'),
      password: formData.get('blert-password'),
      redirect: false,
    });
  } catch (e) {
    if (isRedirectError(e)) {
      throw e;
    }
    return 'Invalid username or password';
  }

  return null;
}

const DUPLICATE_KEY_ERROR_CODE = 11000;

export type RegistrationErrors = {
  username?: string[];
  email?: string[];
  password?: string[];
  overall?: string;
};

export async function register(
  _state: RegistrationErrors | null,
  formData: FormData,
): Promise<RegistrationErrors | null> {
  const validatedFields = formSchema.safeParse({
    username: formData.get('blert-username'),
    email: formData.get('blert-email'),
    password: formData.get('blert-password'),
  });

  if (!validatedFields.success) {
    return validatedFields.error.flatten().fieldErrors;
  }

  const { username, password, email } = validatedFields.data;

  if (await userExists(username)) {
    return { username: [`Username ${username} is already taken`] };
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  if (!process.env.FEATURE_ACCOUNTS) {
    return { overall: 'Account creation is currently disabled' };
  }

  try {
    await UserModel.create({
      username,
      password: hash,
      email,
      emailVerified: false,
    });
  } catch (e: any) {
    if (e.name === 'MongoServerError' && e.code === DUPLICATE_KEY_ERROR_CODE) {
      return { email: ['Email address is already in use'] };
    }
  }

  await signIn('credentials', { username, password, redirectTo: '/' });
  return null;
}

export async function getSignedInUser(): Promise<User | null> {
  await connectToDatabase();

  const session = await auth();
  if (session === null) {
    return null;
  }

  return UserModel.findById(session.user.id).lean().exec();
}

export type ApiKeyWithUsername = ApiKey & { rsn: string };

export async function getApiKeys(): Promise<ApiKeyWithUsername[]> {
  await connectToDatabase();

  const session = await auth();
  if (session === null) {
    throw new Error('Not authenticated');
  }

  const keysWithPlayer = await ApiKeyModel.aggregate([
    {
      $match: { userId: new Types.ObjectId(session.user.id) },
    },
    {
      $lookup: {
        from: 'players',
        localField: 'playerId',
        foreignField: '_id',
        as: 'player',
      },
    },
    {
      $set: {
        rsn: { $arrayElemAt: ['$player.formattedUsername', 0] },
      },
    },
    {
      $project: {
        userId: 0,
        playerId: 0,
        player: 0,
        __v: 0,
      },
    },
  ]).exec();

  return keysWithPlayer;
}

const API_KEY_HEX_LENGTH = 24;
const API_KEY_BYTE_LENGTH = API_KEY_HEX_LENGTH / 2;

const MAX_API_KEYS_PER_USER = 2;

export async function createApiKey(rsn: string): Promise<ApiKeyWithUsername> {
  await connectToDatabase();

  const session = await auth();
  if (session === null) {
    throw new Error('Not authenticated');
  }

  if (rsn.length < 1 || rsn.length > 12) {
    throw new Error('Invalid RSN');
  }

  // TODO(frolv): This is temporary.
  const user = await UserModel.findById(session.user.id).exec();
  if (user === null || !user.canCreateApiKey) {
    throw new Error('Not authorized to create API keys');
  }

  const apiKeyCount = await ApiKeyModel.countDocuments({
    userId: session.user.id,
  });
  if (apiKeyCount >= MAX_API_KEYS_PER_USER) {
    throw new Error('Maximum number of API keys reached');
  }

  let player = await PlayerModel.findOne({
    username: rsn.toLowerCase(),
  }).exec();
  if (player === null) {
    let experience;
    try {
      experience = await hiscoreLookup(rsn);
    } catch (e: any) {
      throw new Error(
        'Unable to create API key at this time, please try again later',
      );
    }
    if (experience === null) {
      throw new Error('Player does not exist on Hiscores');
    }

    player = new PlayerModel({
      username: rsn.toLowerCase(),
      formattedUsername: rsn,
      totalRaidsRecorded: 0,
      overallExperience: experience,
    });
    player.save();
  }

  let apiKey;
  while (true) {
    const key = randomBytes(API_KEY_BYTE_LENGTH).toString('hex');

    try {
      apiKey = new ApiKeyModel({
        userId: new Types.ObjectId(session.user.id),
        playerId: player._id,
        key,
        active: true,
        lastUsed: null,
      });
      await apiKey.save();
      break;
    } catch (e: any) {
      if (
        e.name === 'MongoServerError' &&
        e.code === DUPLICATE_KEY_ERROR_CODE
      ) {
        // Try again if the key already exists.
        continue;
      }
      throw e;
    }
  }

  return { ...apiKey.toObject(), rsn: player.formattedUsername };
}

export async function deleteApiKey(key: string): Promise<void> {
  await connectToDatabase();

  const session = await auth();
  if (session === null) {
    throw new Error('Not authenticated');
  }

  await ApiKeyModel.deleteOne({ key, userId: session.user.id }).exec();
}

export type PlainApiKey = Omit<
  ApiKeyWithUsername,
  '_id' | 'userId' | 'playerId'
> & {
  _id: string;
};

export type ApiKeyFormState = {
  apiKey?: PlainApiKey;
  error?: string;
};

export async function submitApiKeyForm(
  _state: ApiKeyFormState,
  formData: FormData,
): Promise<ApiKeyFormState> {
  const rsn = (formData.get('blert-api-key-rsn') as string).trim();

  let key;
  try {
    key = await createApiKey(rsn);
  } catch (e: any) {
    return { error: e.message };
  }

  const { _id, userId, playerId, ...rest } = key;
  const apiKey = {
    ...rest,
    _id: _id.toString(),
  };

  return { apiKey };
}
