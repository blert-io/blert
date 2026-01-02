'use client';

import { useContext, useEffect } from 'react';
import { NavbarContext } from '@/display';

export function LayoutContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { sidebarCollapsed } = useContext(NavbarContext);

  useEffect(() => {
    const width = sidebarCollapsed ? '60px' : '240px';
    document.documentElement.style.setProperty('--left-nav-width', width);
  }, [sidebarCollapsed]);

  return <div className={className}>{children}</div>;
}
