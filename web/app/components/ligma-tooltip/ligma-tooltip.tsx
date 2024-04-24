'use client';

import ReactDOM from 'react-dom';
import { useEffect, useRef } from 'react';
import { Tooltip } from 'react-tooltip';

type LigmaTooltipProps = {
  children: React.ReactNode;
  open?: boolean;
  openOnClick?: boolean;
  portalId?: string;
  tooltipId: string;
};

export function LigmaTooltip(props: LigmaTooltipProps) {
  const { children, open, openOnClick, portalId, tooltipId } = props;
  const portalNode = useRef<HTMLElement | null>(
    document.getElementById(portalId ?? 'tooltip-portal'),
  );

  useEffect(() => {
    portalNode.current = document.getElementById(portalId ?? 'tooltip-portal');
  }, [portalId]);

  return ReactDOM.createPortal(
    <Tooltip
      id={tooltipId}
      isOpen={open}
      openOnClick={openOnClick}
      opacity={1}
      style={{
        backgroundColor: '#171821',
        borderRadius: '5px',
        boxShadow: '0px 0px 5px rgba(255, 255, 255, 0.2)',
        pointerEvents: 'auto',
        zIndex: 999,
      }}
    >
      {children}
    </Tooltip>,
    portalNode.current!,
  );
}
