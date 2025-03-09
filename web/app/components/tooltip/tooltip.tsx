'use client';

import ReactDOM from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Tooltip as ReactTooltip } from 'react-tooltip';

import styles from './style.module.scss';

type TooltipProps = {
  className?: string;
  clickable?: boolean;
  children?: React.ReactNode;
  maxWidth?: string | number;
  open?: boolean;
  openOnClick?: boolean;
  tooltipId: string;
  render?: ({
    content,
    activeAnchor,
  }: {
    content: string | null;
    activeAnchor: HTMLElement | null;
  }) => React.ReactNode;
};

export function Tooltip(props: TooltipProps) {
  const { children, maxWidth, open, openOnClick, tooltipId, clickable } = props;
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

  let className = styles.tooltip;
  if (props.className) {
    className = `${className} ${props.className}`;
  }

  return ReactDOM.createPortal(
    <ReactTooltip
      className={className}
      clickable={clickable}
      id={tooltipId}
      isOpen={open}
      openOnClick={openOnClick}
      opacity={1}
      render={props.render}
      style={{
        backgroundColor: '#171821',
        borderRadius: '5px',
        boxShadow: '0px 0px 5px rgba(64, 64, 64, 0.2)',
        maxWidth,
        zIndex: 999,
      }}
    >
      {children}
    </ReactTooltip>,
    portalNode.current,
  );
}
