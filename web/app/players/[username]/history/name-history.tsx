import Card, { CardLink } from '@/components/card';

import { LineageNode } from './lineage';

import styles from './name-history.module.scss';

type NameHistoryProps = {
  nodes: LineageNode[];
  /** Number of accepted changes. */
  changeCount: number;
  /** Current username, for the submit link. */
  username: string;
};

function TimelineNode({ node, last }: { node: LineageNode; last: boolean }) {
  const isCurrent = node.kind === 'current';

  return (
    <div className={styles.node}>
      <div className={styles.rail}>
        <span
          className={`${styles.dot} ${isCurrent ? styles.dotCurrent : styles.dotPast}`}
        />
        {!last && <span className={styles.line} />}
      </div>
      <div className={`${styles.content} ${last ? styles.contentLast : ''}`}>
        <span
          className={`${styles.name} ${isCurrent ? styles.nameCurrent : ''}`}
        >
          {node.name}
        </span>
        {isCurrent && <span className={styles.currentTag}>Current</span>}
        {node.duration !== null && (
          <span className={styles.duration}>{node.duration}</span>
        )}
        <span className={styles.date}>{node.dateLabel}</span>
      </div>
    </div>
  );
}

export default function NameHistory({
  nodes,
  changeCount,
  username,
}: NameHistoryProps) {
  return (
    <Card
      className={styles.card}
      header={{
        title: (
          <>
            <i className="fas fa-id-card" /> Name History
          </>
        ),
        action: (
          <span className={styles.count}>
            {changeCount} {changeCount === 1 ? 'change' : 'changes'} tracked
          </span>
        ),
      }}
    >
      <div className={styles.timeline}>
        {nodes.map((node, i) => (
          <TimelineNode
            key={`${node.name}-${i}`}
            node={node}
            last={i === nodes.length - 1}
          />
        ))}
      </div>
      <CardLink
        className={styles.submitLink}
        href={`/change-name?rsn=${encodeURIComponent(username)}`}
        text="Submit a name change"
      />
    </Card>
  );
}
