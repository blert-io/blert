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
      authorize: async (credentials: any) => {
        try {
          const userId = await verifyUser(
            credentials.username,
            credentials.password,
          );
          return { name: credentials.username, id: userId };
        } catch (e) {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ trigger, token, user }) {
      if (trigger === 'signIn') {
        if (user) {
          token.id = user.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      return session;
    },
  },
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
});
