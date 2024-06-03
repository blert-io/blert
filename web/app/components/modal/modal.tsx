'use client';

import { createPortal } from 'react-dom';

import styles from './style.module.scss';
import { useEffect, useRef } from 'react';

type ModalProps = {
  children: React.ReactNode;
  className?: string;
  onClose: () => void;
  open: boolean;
  width?: number | string;
};

export function Modal(props: ModalProps) {
  const { open, onClose } = props;

  const modalPortal = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = document.getElementById('portal-root');

    const tooltipPortal = document.createElement('div');
    tooltipPortal.classList.add(styles.portal);
    root?.appendChild(tooltipPortal);
    modalPortal.current = tooltipPortal;

    return () => {
      if (modalPortal.current !== null) {
        document
          .getElementById('portal-root')
          ?.removeChild(modalPortal.current);
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const onClick = (event: MouseEvent) => {
      if (
        modalRef.current === null ||
        !modalRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    const hidePortal = () => {
      document.body.style.overflowY = 'auto';

      if (modalPortal.current !== null) {
        modalPortal.current.style.visibility = 'hidden';
        modalPortal.current.removeEventListener('click', onClick);
        window.removeEventListener('keydown', onKeyDown);
      }
    };

    if (open) {
      document.body.style.overflowY = 'hidden';
      if (modalPortal.current !== null) {
        modalPortal.current.style.visibility = 'visible';
        modalPortal.current.addEventListener('click', onClick);
        window.addEventListener('keydown', onKeyDown);
      }
    } else {
      hidePortal();
    }

    return () => hidePortal();
  }, [open, onClose]);

  if (modalPortal.current === null) {
    return null;
  }

  let className = styles.modal;
  if (props.className) {
    className += ` ${props.className}`;
  }

  return createPortal(
    <div className={className} ref={modalRef} style={{ width: props.width }}>
      {props.children}
    </div>,
    modalPortal.current,
  );
}
