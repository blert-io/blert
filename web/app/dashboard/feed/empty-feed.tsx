import styles from './feed.module.scss';

type EmptyFeedProps = {
  reason: 'no-follows' | 'no-activity';
};

export default function EmptyFeed({ reason }: EmptyFeedProps) {
  if (reason === 'no-follows') {
    return (
      <div className={styles.emptyState}>
        <i className="fas fa-user-plus" />
        <h3>Start Following Players</h3>
        <p>
          Follow your friends and favorite players to see their challenges and
          personal bests in your feed.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.emptyState}>
      <i className="fas fa-hourglass" />
      <h3>No Recent Activity</h3>
      <p>
        The players you follow haven&apos;t recorded any challenges yet. Check
        back later or follow more players to see more activity.
      </p>
    </div>
  );
}
