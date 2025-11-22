'use client';

import Graph from 'graphology';
import { useEffect, useRef, useCallback, useState } from 'react';
import Sigma from 'sigma';

import Card from '@/components/card';

import { NetworkData, SelectedNode } from '../network-content';

import styles from './network-graph.module.scss';

function hashString(str: string) {
  let hash = 5381;
  let i = str.length;

  while (i) {
    hash = (hash * 33) ^ str.charCodeAt(--i);
  }
  return hash >>> 0;
}

const NODE_CENTER_X = 0;
const NODE_CENTER_Y = 0;
const BASE_RADIUS = 350;
const JITTER_FACTOR = 150;

type NetworkGraphProps = {
  data: NetworkData | null;
  loading: boolean;
  selectedNode: SelectedNode;
  onNodeSelect: (nodeData: SelectedNode) => void;
  focusedPlayer: string | null;
  controlsOverlay?: React.ReactNode;
};

type GraphNodeData = {
  key: string;
  attributes: object;
};

type GraphEdgeData = {
  key: string;
  source: string;
  target: string;
  attributes: object;
};

type LayoutWorkerMessage = {
  success: boolean;
  graphData: {
    nodes: GraphNodeData[];
    edges: GraphEdgeData[];
  };
  error?: string;
};

export default function NetworkGraph({
  data,
  loading,
  onNodeSelect,
  focusedPlayer,
  controlsOverlay,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [edgeTooltip, setEdgeTooltip] = useState<{
    x: number;
    y: number;
    source: string;
    target: string;
    weight: number;
  } | null>(null);

  const createBasicGraph = useCallback(
    (networkData: NetworkData) => {
      // Generates a fast, unoptimized graph for immediate display.
      const graph = new Graph();

      const nodeConnections = new Map<string, number>();
      networkData.edges.forEach((edge) => {
        nodeConnections.set(
          edge.source,
          (nodeConnections.get(edge.source) ?? 0) + 1,
        );
        nodeConnections.set(
          edge.target,
          (nodeConnections.get(edge.target) ?? 0) + 1,
        );
      });

      const maxConnections = Math.max(...nodeConnections.values());
      const minConnections = Math.min(...nodeConnections.values());
      const connectionRange = maxConnections - minConnections || 1;

      networkData.nodes.forEach((node, i) => {
        const connections = nodeConnections.get(node) ?? 0;
        const normalizedSize = (connections - minConnections) / connectionRange;
        const size = 3 + normalizedSize * 12;

        const h = hashString(node);
        const angle = (2 * Math.PI * i) / networkData.nodes.length;
        const radius = BASE_RADIUS + (h % JITTER_FACTOR);

        graph.addNode(node, {
          label: node,
          size,
          originalSize: size,
          connections,
          x: NODE_CENTER_X + radius * Math.cos(angle),
          y: NODE_CENTER_Y + radius * Math.sin(angle),
          color:
            focusedPlayer?.toLowerCase() === node.toLowerCase()
              ? '#5865f2'
              : '#8b95a5',
          labelColor:
            focusedPlayer?.toLowerCase() === node.toLowerCase()
              ? '#5865f2'
              : '#c3c7c9',
        });
      });

      networkData.edges.forEach((edge) => {
        if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
          const maxWeight = Math.max(...networkData.edges.map((e) => e.value));
          const minWeight = Math.min(...networkData.edges.map((e) => e.value));
          const weightRange = maxWeight - minWeight || 1;

          const normalizedWeight = (edge.value - minWeight) / weightRange;
          const thickness = 0.5 + normalizedWeight * 2;

          graph.addEdge(edge.source, edge.target, {
            weight: edge.value,
            size: thickness,
            color: '#3d4450',
          });
        }
      });

      return graph;
    },
    [focusedPlayer],
  );

  const applyLayoutWithWorker = useCallback(
    async (networkData: NetworkData): Promise<Graph> => {
      return new Promise<Graph>((resolve, reject) => {
        const worker = new Worker('/scripts/graph-layout-worker.js', {
          type: 'module',
        });

        worker.postMessage({
          networkData,
          focusedPlayer,
        });

        worker.onmessage = (e: MessageEvent<LayoutWorkerMessage>) => {
          const { success, graphData, error } = e.data;

          if (success) {
            const newGraph = new Graph();

            graphData.nodes.forEach((nodeData) => {
              newGraph.addNode(nodeData.key, nodeData.attributes);
            });

            graphData.edges.forEach((edgeData) => {
              newGraph.addEdge(
                edgeData.source,
                edgeData.target,
                edgeData.attributes,
              );
            });

            resolve(newGraph);
          } else {
            reject(new Error(error));
          }

          worker.terminate();
        };

        worker.onerror = (error) => {
          reject(new Error(error.message));
          worker.terminate();
        };
      });
    },
    [focusedPlayer],
  );

  const handleNodeClick = useCallback(
    (event: { node: string }) => {
      const nodeId = event.node;
      const graph = graphRef.current;

      if (!graph || !data) {
        return;
      }

      const connections = graph.neighbors(nodeId);
      const nodeConnections = connections.length;

      const neighbors = connections
        .map((neighborId) => {
          let edgeKey: string | undefined;

          if (graph.hasEdge(nodeId, neighborId)) {
            edgeKey = graph.edge(nodeId, neighborId);
          } else if (graph.hasEdge(neighborId, nodeId)) {
            edgeKey = graph.edge(neighborId, nodeId);
          }

          if (!edgeKey) {
            console.warn(
              `Could not find edge between ${nodeId} and ${neighborId}`,
            );
            return {
              username: neighborId,
              edgeCount: 0,
            };
          }

          return {
            username: neighborId,
            edgeCount: graph.getEdgeAttribute(edgeKey, 'weight') as number,
          };
        })
        .sort((a, b) => b.edgeCount - a.edgeCount);

      const nodeData: SelectedNode = {
        username: nodeId,
        connections: nodeConnections,
        neighbors,
      };

      onNodeSelect(nodeData);
    },
    [data, onNodeSelect],
  );

  const handleEdgeEnter = useCallback(
    (event: { edge: string; event: { x: number; y: number } }) => {
      const graph = graphRef.current;
      if (!graph) {
        return;
      }

      const edgeId = event.edge;
      const source = graph.source(edgeId);
      const target = graph.target(edgeId);
      const weight = graph.getEdgeAttribute(edgeId, 'weight') as number;

      setEdgeTooltip({
        x: event.event.x,
        y: event.event.y,
        source,
        target,
        weight,
      });
    },
    [],
  );

  const handleEdgeLeave = useCallback(() => {
    setEdgeTooltip(null);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !data) {
      return;
    }

    const initializeGraph = async () => {
      let sigma = sigmaRef.current;
      const isFirstLoad = !sigma;

      if (isFirstLoad) {
        const basicGraph = createBasicGraph(data);
        graphRef.current = basicGraph;

        sigma = new Sigma(basicGraph, containerRef.current!, {
          defaultNodeColor: '#8b95a5',
          defaultEdgeColor: '#3d4450',
          enableEdgeEvents: true,
          renderEdgeLabels: false,
          labelColor: { attribute: 'labelColor' },
          labelSize: 14,
          labelWeight: 'normal',
          labelFont: 'Arial, sans-serif',
          labelDensity: 1,
          renderLabels: true,
        });

        sigma.on('clickNode', handleNodeClick);
        sigma.on('enterEdge', handleEdgeEnter);
        sigma.on('leaveEdge', handleEdgeLeave);

        sigmaRef.current = sigma;
      }

      try {
        const optimizedGraph = await applyLayoutWithWorker(data);

        if (sigmaRef.current && sigmaRef.current === sigma) {
          sigmaRef.current.setGraph(optimizedGraph);
          graphRef.current = optimizedGraph;
        }
      } catch (error) {
        console.error('Layout worker failed:', error);
        if (isFirstLoad && sigmaRef.current) {
          const basicGraph = createBasicGraph(data);
          sigmaRef.current.setGraph(basicGraph);
          graphRef.current = basicGraph;
        }
      }
    };

    void initializeGraph();

    return () => {
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
    };
  }, [
    data,
    createBasicGraph,
    applyLayoutWithWorker,
    handleNodeClick,
    handleEdgeEnter,
    handleEdgeLeave,
  ]);

  if (!data && loading) {
    return (
      <Card className={styles.graphCard}>
        {controlsOverlay}
        <div className={styles.loadingState}>
          <div className={styles.loadingIndicator}>
            <i className="fas fa-spinner fa-spin" />
            <span>Loading network data...</span>
          </div>
        </div>
      </Card>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <Card className={styles.graphCard}>
        {controlsOverlay}
        <div className={styles.emptyState}>
          <i className="fas fa-project-diagram" />
          <h3>No Network Data</h3>
          <p>Try adjusting your filters to find player connections.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={styles.graphCard}>
      {controlsOverlay}
      <div className={styles.sigmaContainer} ref={containerRef} />

      {loading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.loadingIndicator}>
            <i className="fas fa-spinner fa-spin" />
            <span>Updating...</span>
          </div>
        </div>
      )}

      {edgeTooltip && (
        <div
          className={styles.edgeTooltip}
          style={{
            left: edgeTooltip.x + 10,
            top: edgeTooltip.y - 10,
          }}
        >
          <div className={styles.tooltipHeader}>
            <i className="fas fa-link" />
            <span>Partnership</span>
          </div>
          <div className={styles.tooltipContent}>
            <div className={styles.playerPair}>
              <span className={styles.playerName}>{edgeTooltip.source}</span>
              <i className="fas fa-arrows-alt-h" />
              <span className={styles.playerName}>{edgeTooltip.target}</span>
            </div>
            <div className={styles.raidCount}>
              <i className="fas fa-shield-alt" />
              <span>
                {edgeTooltip.weight.toLocaleString()} raid
                {edgeTooltip.weight === 1 ? '' : 's'} together
              </span>
            </div>
          </div>
        </div>
      )}

      <div className={styles.focusLegend}>
        <div className={styles.legendItem}>
          <div
            className={styles.legendColor}
            style={{ backgroundColor: '#5865f2' }}
          />
          <span>Focused Player</span>
        </div>
        <div className={styles.legendItem}>
          <div
            className={styles.legendColor}
            style={{ backgroundColor: '#45b381' }}
          />
          <span>Connected Players</span>
        </div>
        <div className={styles.legendItem}>
          <div
            className={styles.legendColor}
            style={{ backgroundColor: '#4a5568' }}
          />
          <span>Other Players</span>
        </div>
      </div>
    </Card>
  );
}
