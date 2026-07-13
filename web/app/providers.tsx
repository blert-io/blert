'use client';

import ChallengeProvider from './challenge-context';
import SettingsProvider from './components/settings-provider';
import ToastProvider from './components/toast';
import { DisplayWrapper } from './display';
import ThemeApplier from './theme/theme-applier';

type ProvidersProps = {
  children: React.ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  return (
    <DisplayWrapper>
      <ChallengeProvider>
        <ToastProvider>
          <SettingsProvider>
            <ThemeApplier />
            {children}
          </SettingsProvider>
        </ToastProvider>
      </ChallengeProvider>
    </DisplayWrapper>
  );
}
