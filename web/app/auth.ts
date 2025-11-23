import NextAuth, { User } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { verifyUser } from './actions/users';

declare module 'next-auth' {
  interface Session {
    user: User;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        username: {},
        password: {},
      },
      authorize: async (credentials) => {
        try {
          const username = credentials?.username as string;
          const password = credentials?.password as string;
          const userId = await verifyUser(username, password);
          return { name: username, id: userId };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ trigger, token, user }) {
      if (trigger === 'signIn') {
        if (user) {
          token.id = user.id;
        }
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      return session;
    },
  },
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
});
