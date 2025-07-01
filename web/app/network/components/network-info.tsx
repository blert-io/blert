'use client';

import Link from 'next/link';

import Card from '@/components/card';
import { playerUrl } from '@/utils/url';

import { SelectedNode } from '../network-content';

import styles from './network-info.module.scss';

type NetworkInfoProps = {
  selectedNode: SelectedNode;
  onClose: () => void;
  onFocusPlayer: (username: string | null) => void;
};

export default function NetworkInfo({
  selectedNode,
  onClose,
  onFocusPlayer,
}: NetworkInfoProps) {
  if (!selectedNode) {
    return null;
  }

  const handleFocusClick = () => {
    onFocusPlayer(selectedNode.username);
    onClose();
  };

  return (
    <div className={styles.infoPanel}>
      <Card className={styles.infoCard}>
        <div className={styles.infoHeader}>
          <div className={styles.playerInfo}>
            <h3>
              <i className="fas fa-user" />
              {selectedNode.username}
            </h3>
            <div className={styles.connectionCount}>
              <i className="fas fa-link" />
              <span>
                {selectedNode.connections} connection
                {selectedNode.connections === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          <div className={styles.headerActions}>
            <button className={styles.focusButton} onClick={handleFocusClick}>
              <i className="fas fa-crosshairs" />
            </button>

            <button className={styles.closeButton} onClick={onClose}>
              <i className="fas fa-times" />
            </button>
          </div>
        </div>

        <div className={styles.infoContent}>
          <div className={styles.quickActions}>
            <Link
              href={playerUrl(selectedNode.username)}
              className={styles.profileLink}
            >
              <i className="fas fa-external-link-alt" />
              View Profile
            </Link>
          </div>

          {selectedNode.neighbors.length > 0 && (
            <div className={styles.neighborsSection}>
              <h4>
                <i className="fas fa-users" />
                Top Partners ({Math.min(selectedNode.neighbors.length, 10)})
              </h4>

              <div className={styles.neighborsList}>
                {selectedNode.neighbors.slice(0, 10).map((neighbor) => (
                  <div key={neighbor.username} className={styles.neighborItem}>
                    <Link
                      href={playerUrl(neighbor.username)}
                      className={styles.neighborLink}
                    >
                      <div className={styles.neighborInfo}>
                        <span className={styles.neighborName}>
                          {neighbor.username}
                        </span>
                        <span className={styles.neighborCount}>
                          {neighbor.edgeCount.toLocaleString()} raid
                          {neighbor.edgeCount === 1 ? '' : 's'}
                        </span>
                      </div>
                    </Link>

                    <button
                      className={styles.focusNeighborButton}
                      onClick={() => {
                        onFocusPlayer(neighbor.username);
                        onClose();
                      }}
                    >
                      <i className="fas fa-crosshairs" />
                    </button>
                  </div>
                ))}
              </div>

              {selectedNode.neighbors.length > 10 && (
                <div className={styles.morePartners}>
                  <i className="fas fa-ellipsis-h" />
                  <span>
                    +{selectedNode.neighbors.length - 10} more partner
                    {selectedNode.neighbors.length - 10 === 1 ? '' : 's'}
                  </span>
                </div>
              )}
            </div>
          )}

          {selectedNode.neighbors.length === 0 && (
            <div className={styles.noConnections}>
              <i className="fas fa-user-times" />
              <p>No recorded partnerships found with current filters.</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
