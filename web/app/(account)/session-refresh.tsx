'use client';

import { useEffect } from 'react';

import { authClient } from '@/auth-client';

export default function SessionRefresh() {
  useEffect(() => {
    void authClient.getSession({
      query: { disableCookieCache: true },
    });
  }, []);

  return null;
}
