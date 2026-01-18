'use client';

import { useSession } from 'next-auth/react';
import { useEffect } from 'react';

export default function SessionRefresh() {
  const { update } = useSession();

  useEffect(() => {
    void update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
