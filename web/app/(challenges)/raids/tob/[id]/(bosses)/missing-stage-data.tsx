import { Stage, stageName } from '@blert/common';

import styles from './missing-stage-data.module.scss';

type MissingStageDataProps = {
  stage: Stage;
};

export default function MissingStageData({ stage }: MissingStageDataProps) {
  return (
    <div className={styles.container}>
      <i className={`fas fa-circle-question ${styles.icon}`} />
      <p className={styles.message}>No {stageName(stage)} data for this raid</p>
      <p className={styles.details}>
        The team may not have reached this room, or the recording didn&apos;t
        capture it.
      </p>
    </div>
  );
}
