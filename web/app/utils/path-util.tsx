'use client';

import { usePathname } from 'next/navigation';

// This a client component, still prerendered
// @ts-ignore
export function Pathname({ children }) {
  const pathname = usePathname();
  return (
    <div>
      <p>Path: {pathname}</p>
      {children}
    </div>
  );
}
