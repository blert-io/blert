'use client';

import ChallengeProvider from './challenge-context';
import SettingsProvider from './components/settings-provider';
import ToastProvider from './components/toast';
import { DisplayWrapper } from './display';

type ProvidersProps = {
  children: React.ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  return (
    <DisplayWrapper>
      <ChallengeProvider>
        <ToastProvider>
          <SettingsProvider>{children}</SettingsProvider>
        </ToastProvider>
      </ChallengeProvider>
    </DisplayWrapper>
  );
}
