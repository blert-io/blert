'use client';

import ReactDOM from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Tooltip as ReactTooltip, PlacesType } from 'react-tooltip';

import styles from './style.module.scss';

type TooltipProps = {
  /** Additional CSS class for tooltip */
  className?: string;
  /** Allow interaction with tooltip content */
  clickable?: boolean;
  /** Tooltip content as React children */
  children?: React.ReactNode;
  /** Maximum width of tooltip */
  maxWidth?: string | number;
  /** Control tooltip visibility externally */
  open?: boolean;
  /** Open tooltip on click instead of hover */
  openOnClick?: boolean;
  /** Unique ID for the tooltip */
  tooltipId: string;
  /** Position relative to anchor element */
  place?: PlacesType;
  /** Distance between tooltip and anchor (default: 10) */
  offset?: number;
  /** Delay before showing tooltip (ms) */
  delayShow?: number;
  /** Delay before hiding tooltip (ms) */
  delayHide?: number;
  /** Custom border style (overrides default sophisticated border) */
  border?: string;
  /** Tooltip opacity (default: 1) */
  opacity?: number;
  /** Custom render function for tooltip content */
  render?: ({
    content,
    activeAnchor,
  }: {
    content: string | null;
    activeAnchor: HTMLElement | null;
  }) => React.ReactNode;
};

export function Tooltip(props: TooltipProps) {
  const {
    children,
    maxWidth,
    open,
    openOnClick,
    tooltipId,
    clickable,
    place,
    offset = 10,
    delayShow,
    delayHide,
    border = '1px solid rgba(var(--blert-button-base), 0.15)',
    opacity = 1,
  } = props;
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
      place={place}
      offset={offset}
      delayShow={delayShow}
      delayHide={delayHide}
      opacity={opacity}
      render={props.render}
      border={border}
      arrowColor="rgba(var(--nav-bg-base), 0.95)"
      style={{
        background:
          'linear-gradient(135deg, var(--panel-bg) 0%, rgba(var(--nav-bg-base), 0.95) 100%)',
        borderRadius: '8px',
        boxShadow:
          '0 8px 32px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(8px)',
        maxWidth,
        zIndex: 999,
      }}
    >
      {children}
    </ReactTooltip>,
    portalNode.current,
  );
}
