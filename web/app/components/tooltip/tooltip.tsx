'use client';

import ReactDOM from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Tooltip as ReactTooltip } from 'react-tooltip';

type TooltipProps = {
  children: React.ReactNode;
  maxWidth?: string | number;
  open?: boolean;
  openOnClick?: boolean;
  tooltipId: string;
};

export function Tooltip(props: TooltipProps) {
  const { children, maxWidth, open, openOnClick, tooltipId } = props;
  const [ready, setReady] = useState(false);
  const portalNode = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.getElementById('portal-root');

    const tooltipPortal = document.createElement('div');
    tooltipPortal.classList.add(`${tooltipId}-portal`);
    root?.appendChild(tooltipPortal);
    portalNode.current = tooltipPortal;

    setReady(true);

    return () => {
      if (portalNode.current !== null) {
        document
          .getElementById('portal-root')
          ?.removeChild(portalNode.current!);
      }
    };
  }, [tooltipId]);

  if (portalNode.current === null || !ready) {
    return null;
  }

  return ReactDOM.createPortal(
    <ReactTooltip
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
    </ReactTooltip>,
    portalNode.current,
  );
}
