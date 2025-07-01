// Web Worker for graph layout processing.
import Graph from 'graphology';
import { inferSettings, assign } from 'graphology-layout-forceatlas2';

self.onmessage = function (e) {
  const { networkData, focusedPlayer } = e.data;

  function hashString(str) {
    let hash = 5381;
    let i = str.length;

    while (i) {
      hash = (hash * 33) ^ str.charCodeAt(--i);
    }

    return hash >>> 0;
  }

  try {
    const graph = new Graph();

    const nodeConnections = new Map();
    networkData.edges.forEach((edge) => {
      nodeConnections.set(
        edge.source,
        (nodeConnections.get(edge.source) || 0) + 1,
      );
      nodeConnections.set(
        edge.target,
        (nodeConnections.get(edge.target) || 0) + 1,
      );
    });

    const maxConnections = Math.max(...nodeConnections.values());
    const minConnections = Math.min(...nodeConnections.values());
    const connectionRange = maxConnections - minConnections || 1;

    const focus = focusedPlayer?.toLowerCase();

    const focusedPlayerNeighbors = new Set();
    if (focusedPlayer) {
      networkData.edges.forEach((edge) => {
        if (edge.source.toLowerCase() === focus) {
          focusedPlayerNeighbors.add(edge.target);
        } else if (edge.target.toLowerCase() === focus) {
          focusedPlayerNeighbors.add(edge.source);
        }
      });
    }

    const NODE_CENTER_X = 0;
    const NODE_CENTER_Y = 0;
    const BASE_RADIUS = 350;
    const JITTER_FACTOR = 150;

    const N = networkData.nodes.length;

    networkData.nodes.forEach((node, i) => {
      const connections = nodeConnections.get(node) || 0;
      const normalizedSize = (connections - minConnections) / connectionRange;
      const size = 3 + normalizedSize * 12;

      const h = hashString(node);
      const angle = (2 * Math.PI * i) / N;
      const radius = BASE_RADIUS + (h % JITTER_FACTOR);

      // Determine node color based on relationship to the focused player.
      let color = '#8b95a5';
      let labelColor = '#c3c7c9';

      if (focus === node.toLowerCase()) {
        // Focused player.
        color = '#5865f2';
        labelColor = '#5865f2';
      } else if (focus && focusedPlayerNeighbors.has(node)) {
        // Connected to focused player.
        color = '#45b381';
        labelColor = '#45b381';
      } else if (focus) {
        color = '#4a5568';
        labelColor = '#c3c7c9';
      }

      graph.addNode(node, {
        label: node,
        size,
        originalSize: size,
        connections,
        x: NODE_CENTER_X + radius * Math.cos(angle),
        y: NODE_CENTER_Y + radius * Math.sin(angle),
        color,
        labelColor,
      });
    });

    const maxWeight = Math.max(...networkData.edges.map((e) => e.value));
    const minWeight = Math.min(...networkData.edges.map((e) => e.value));
    const weightRange = maxWeight - minWeight || 1;

    networkData.edges.forEach((edge) => {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        const normalizedWeight = (edge.value - minWeight) / weightRange;
        const thickness = 0.5 + normalizedWeight * 2;

        // Determine edge color based on connection to the focused player.
        const isConnectedToFocus =
          focus &&
          (edge.source.toLowerCase() === focus ||
            edge.target.toLowerCase() === focus);
        const color = isConnectedToFocus ? '#45b381' : '#3d4450';
        const size = isConnectedToFocus ? thickness * 1.5 : thickness;

        graph.addEdge(edge.source, edge.target, {
          weight: edge.value,
          size,
          color,
        });
      }
    });

    const settings = inferSettings(graph);
    assign(graph, {
      iterations: 50,
      settings: {
        ...settings,
        gravity: 1.5,
        strongGravityMode: true,
        slowDown: 1,
        scalingRatio: 1,
        barnesHutOptimize: true,
        outboundAttractionDistribution: false,
        linLogMode: false,
        adjustSizes: false,
        edgeWeightInfluence: 1.2,
      },
    });

    const graphData = {
      nodes: [],
      edges: [],
    };

    graph.forEachNode((node, attributes) => {
      graphData.nodes.push({
        key: node,
        attributes: { ...attributes },
      });
    });

    graph.forEachEdge((edge, attributes, source, target) => {
      graphData.edges.push({
        key: edge,
        source,
        target,
        attributes: { ...attributes },
      });
    });

    self.postMessage({
      success: true,
      graphData,
    });
  } catch (error) {
    self.postMessage({
      success: false,
      error: error.message,
    });
  }
};
