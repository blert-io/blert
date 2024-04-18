'use server';

import { UserModel } from '@blert/common';
import bcrypt from 'bcrypt';
import { z } from 'zod';

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

export async function login(
  _state: string | null,
  formData: FormData,
): Promise<string | null> {
  const username = formData.get('blert-username') as string;
  const password = formData.get('blert-password') as string;

  await connectToDatabase();

  const user = await UserModel.findOne({ username });
  if (user !== null) {
    const validPassword = await bcrypt.compare(password, user.password);
  }

  return 'Invalid username or password';
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

  return null;
}
