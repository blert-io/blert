'use client';

import ReactDOM from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Tooltip } from 'react-tooltip';

type LigmaTooltipProps = {
  children: React.ReactNode;
  maxWidth?: string | number;
  open?: boolean;
  openOnClick?: boolean;
  portalId?: string;
  tooltipId: string;
};

export function LigmaTooltip(props: LigmaTooltipProps) {
  const { children, maxWidth, open, openOnClick, portalId, tooltipId } = props;
  const [ready, setReady] = useState(false);
  const portalNode = useRef<HTMLElement | null>(null);

  useEffect(() => {
    portalNode.current = document.getElementById(portalId ?? 'tooltip-portal');
    setReady(true);
  }, [portalId]);

  if (portalNode.current === null || !ready) {
    return null;
  }

  return ReactDOM.createPortal(
    <Tooltip
      id={tooltipId}
      isOpen={open}
      openOnClick={openOnClick}
      opacity={1}
      style={{
        backgroundColor: '#171821',
        borderRadius: '5px',
        boxShadow: '0px 0px 5px rgba(64, 64, 64, 0.2)',
        pointerEvents: 'auto',
        maxWidth,
        zIndex: 999,
      }}
    >
      {children}
    </Tooltip>,
    portalNode.current!,
  );
}
