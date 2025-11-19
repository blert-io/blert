'use client';

import { SessionProvider } from 'next-auth/react';

import ChallengeProvider from './challenge-context';
import ToastProvider from './components/toast';
import { DisplayWrapper } from './display';

type ProvidersProps = {
  children: React.ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <DisplayWrapper>
        <ChallengeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ChallengeProvider>
      </DisplayWrapper>
    </SessionProvider>
  );
}
