import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { getEmailVerificationStatus, verifyUser } from './actions/users';

declare module 'next-auth' {
  interface User {
    isEmailVerified?: boolean;
  }

  interface Session {
    user: User & { isEmailVerified: boolean };
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    isEmailVerified?: boolean;
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
          const result = await verifyUser(username, password);
          return {
            name: username,
            id: result.id,
            isEmailVerified: result.emailVerified,
          };
        } catch {
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
          token.isEmailVerified = user.isEmailVerified;
        }
      } else if (
        trigger === undefined &&
        token.id &&
        token.isEmailVerified !== true
      ) {
        // Hack. Will migrate away from NextAuth.
        token.isEmailVerified = await getEmailVerificationStatus(
          token.id as string,
        );
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.isEmailVerified = token.isEmailVerified ?? false;
      return session;
    },
  },
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
});
