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

// Definitely not copied from somebody elses codebase by proxy
// from the cursed AI that is making intellectual property ownership a thing of the past
export function getOrdinal(n: number): string {
  let s = ['th', 'st', 'nd', 'rd'],
    v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
