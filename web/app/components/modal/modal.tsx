'use client';

import { createPortal } from 'react-dom';

import styles from './style.module.scss';
import { useEffect, useRef, useState } from 'react';

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
  const [shouldRender, setShouldRender] = useState(open);

  useEffect(() => {
    const root = document.getElementById('portal-root');

    const portal = document.createElement('div');
    portal.classList.add(styles.portal);
    portal.dataset.blertDisableSidebar = 'true';
    root?.appendChild(portal);
    modalPortal.current = portal;

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
      const isInput =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement;
      if (event.key === 'Escape' && !isInput) {
        onClose();
      }
    };

    const onClick = (event: MouseEvent) => {
      if (!modalRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    const hidePortal = () => {
      document.body.style.overflowY = 'auto';

      if (modalPortal.current !== null) {
        modalPortal.current.style.visibility = 'hidden';
        modalPortal.current.classList.remove(styles.closing);
        modalPortal.current.removeEventListener('click', onClick);
        window.removeEventListener('keydown', onKeyDown);
      }
      setShouldRender(false);
    };

    if (open) {
      setShouldRender(true);
      document.body.style.overflowY = 'hidden';
      if (modalPortal.current !== null) {
        modalPortal.current.style.visibility = 'visible';
        modalPortal.current.classList.remove(styles.closing);
        modalPortal.current.addEventListener('click', onClick);
        window.addEventListener('keydown', onKeyDown);
      }
    } else {
      // Start closing animation and wait for animation completion before hiding
      if (modalPortal.current !== null) {
        modalPortal.current.classList.add(styles.closing);
      }

      const timeoutId = setTimeout(() => {
        hidePortal();
      }, 200); // Match the CSS transition duration

      return () => {
        clearTimeout(timeoutId);
        hidePortal();
      };
    }

    return () => hidePortal();
  }, [open, onClose]);

  if (modalPortal.current === null || !shouldRender) {
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
