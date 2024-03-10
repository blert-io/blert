import ReactDOM from 'react-dom';
import styles from './style.module.scss';
import { useRef } from 'react';
import { Tooltip } from 'react-tooltip';

type LigmaTooltipProps = {
  children: React.ReactNode;
  openOnClick?: boolean;
  tooltipId: string;
};

export function LigmaTooltip(props: LigmaTooltipProps) {
  const { children, openOnClick, tooltipId } = props;
  const portalNode = useRef(document.getElementById('tooltip-portal'));

  return ReactDOM.createPortal(
    <Tooltip
      id={tooltipId}
      openOnClick={openOnClick}
      opacity={1}
      style={{
        backgroundColor: '#171821',
        borderRadius: '5px',
        boxShadow: '0px 0px 5px rgba(255, 2555, 255, 0.5)',
        pointerEvents: 'auto',
        zIndex: 999,
      }}
    >
      {children}
    </Tooltip>,
    portalNode.current!,
  );
}
