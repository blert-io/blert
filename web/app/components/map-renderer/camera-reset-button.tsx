'use client';

import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import { useReplayContext } from './replay-context';

import styles from './style.module.scss';

type CameraResetButtonProps = {
  className?: string;
};

export default function CameraResetButton({
  className,
}: CameraResetButtonProps) {
  const { resetCamera } = useReplayContext();

  return (
    <button
      className={`${styles.mapButton} ${className ?? ''}`}
      onClick={resetCamera}
      data-tooltip-id={GLOBAL_TOOLTIP_ID}
      data-tooltip-content="Reset camera to initial position"
    >
      <i className="fas fa-video" />
      <span className="sr-only">Reset camera to initial position</span>
    </button>
  );
}
