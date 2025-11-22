'use client';

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  startTransition,
} from 'react';
import { ChallengeType, ChallengeMode } from '@blert/common';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';

import { useToast } from '@/components/toast';
import { queryString } from '@/utils/url';

import NetworkControlsOverlay from './components/network-controls-overlay';
const NetworkGraph = dynamic(() => import('./components/network-graph'), {
  ssr: false,
});
import NetworkInfo from './components/network-info';

import styles from './network-content.module.scss';

export type NetworkData = {
  nodes: string[];
  edges: {
    source: string;
    target: string;
    value: number;
  }[];
  meta: {
    filters: {
      type?: ChallengeType;
      mode?: ChallengeMode;
      scale?: number[];
      from?: Date;
      to?: Date;
    };
  };
};

export type NetworkFilters = {
  type?: ChallengeType;
  mode?: ChallengeMode;
  scale?: number[];
  from?: Date;
  to?: Date;
  limit?: number;
  minConnections?: number;
};

export type SelectedNode = {
  username: string;
  connections: number;
  neighbors: {
    username: string;
    edgeCount: number;
  }[];
} | null;

export default function NetworkContent() {
  const searchParams = useSearchParams();
  const showToast = useToast();
  const isInitialLoadRef = useRef(true);

  const [networkData, setNetworkData] = useState<NetworkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedNode>(null);
  const [focusedPlayer, setFocusedPlayer] = useState<string | null>(
    searchParams.get('focus'),
  );

  const [filters, setFilters] = useState<NetworkFilters>({
    type: ChallengeType.TOB,
    limit: 10_000,
    minConnections: 5,
  });

  const fetchNetworkData = useCallback(async () => {
    try {
      if (isInitialLoadRef.current) {
        setLoading(true);
        isInitialLoadRef.current = false;
      } else {
        setUpdating(true);
      }
      setError(null);

      const params = {
        type: filters.type,
        mode: filters.mode,
        scale: filters.scale,
        limit: filters.limit,
        minConnections: filters.minConnections,
      };

      const response = await fetch(`/api/v1/network?${queryString(params)}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch network data: ${response.statusText}`);
      }

      const data = (await response.json()) as NetworkData;

      startTransition(() => {
        setNetworkData(data);
        if (data.nodes.length === 0) {
          showToast('No network data found with current filters', 'info');
        }
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to load network data';
      setError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setLoading(false);
      setTimeout(() => setUpdating(false), 100);
    }
  }, [filters, showToast]);

  useEffect(() => {
    void fetchNetworkData();
  }, [fetchNetworkData]);

  const handleFiltersChange = useCallback((newFilters: NetworkFilters) => {
    setFilters(newFilters);
    setSelectedNode(null);
  }, []);

  const handleNodeSelect = useCallback((nodeData: SelectedNode) => {
    setSelectedNode(nodeData);
  }, []);

  const handleFocusPlayer = useCallback((username: string | null) => {
    setFocusedPlayer(username);
    if (username) {
      const newUrl = new URL(window.location.href);
      if (username) {
        newUrl.searchParams.set('focus', username);
      } else {
        newUrl.searchParams.delete('focus');
      }
      window.history.replaceState({}, '', newUrl.toString());
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    await fetchNetworkData();
    showToast('Network data refreshed', 'success');
  }, [fetchNetworkData, showToast]);

  if (error) {
    return (
      <div className={styles.errorState}>
        <div className={styles.errorContent}>
          <i className="fas fa-exclamation-triangle" />
          <h3>Failed to Load Network</h3>
          <p>{error}</p>
          <button
            className={styles.retryButton}
            onClick={() => void handleRefresh()}
          >
            <i className="fas fa-redo" />
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.networkContent}>
      <div className={styles.graphContainer}>
        <NetworkGraph
          data={networkData}
          loading={loading || updating}
          selectedNode={selectedNode}
          onNodeSelect={handleNodeSelect}
          focusedPlayer={focusedPlayer}
          controlsOverlay={
            <NetworkControlsOverlay
              filters={filters}
              onFiltersChange={handleFiltersChange}
              loading={updating}
              nodeCount={networkData?.nodes.length ?? 0}
              edgeCount={networkData?.edges.length ?? 0}
              focusedPlayer={focusedPlayer}
              onFocusPlayer={handleFocusPlayer}
            />
          }
        />

        {selectedNode && (
          <NetworkInfo
            selectedNode={selectedNode}
            onClose={() => setSelectedNode(null)}
            onFocusPlayer={handleFocusPlayer}
          />
        )}
      </div>
    </div>
  );
}
