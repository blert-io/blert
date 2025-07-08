'use client';

import { Coords } from '@blert/common';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MapControls, OrthographicCamera, Plane } from '@react-three/drei';
import { Canvas, ThreeEvent, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { MapControls as MapControlsImpl } from 'three-stdlib';

import DevConsole from './dev-console';
import GroundObject from './ground-object';
import KeyboardCameraControls from './keyboard-camera-controls';
import MapFloor from './map-floor';
import Npc from './npc';
import Player from './player';
import { useReplayContext } from './replay-context';
import StackIndicator from './stack-indicator';
import TileHoverOverlay from './tile-hover-overlay';
import {
  ActorInteractionState,
  AnyEntity,
  CustomEntity,
  EntityType,
  GroundObjectEntity,
  MapDefinition,
  NpcEntity,
  PlayerEntity,
} from './types';

import styles from './style.module.scss';
import StackHoverPlane from './stack-hover-plane';

export interface MapCanvasProps {
  /** List of entities to render on the map. */
  entities: AnyEntity[];

  /** Callback when an entity is selected or deselected. */
  onEntitySelected?: (entity: AnyEntity | null) => void;

  /** Callback when an entity is hovered. */
  onEntityHovered?: (entity: AnyEntity | null) => void;

  /** Currently selected entity. */
  selectedEntity?: AnyEntity | null;

  /** Actor ID to follow with the camera. */
  followedActor?: string | null;

  /** Whether to enable WASD keyboard controls for camera movement. */
  keyboardControlsEnabled?: boolean;

  /** Speed of keyboard camera movement in tiles per second. */
  keyboardControlsSpeed?: number;

  /** Additional Map components to render within the canvas. */
  children?: React.ReactNode;
}

const PARTY_COLORS = [
  '#ef4444', // red
  '#22c55e', // green
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

type StackEntity = {
  entity: AnyEntity;
  fanOutIndex: number;
};

type StackMap = Map<string, StackEntity>;

function MapScene({
  mapDefinition,
  entities,
  interactionState,
  onEntitySelected,
  onEntityHovered,
}: {
  mapDefinition: MapDefinition;
  entities: AnyEntity[];
  interactionState: ActorInteractionState;
  onEntitySelected: (entity: AnyEntity | null) => void;
  onEntityHovered: (entity: AnyEntity | null) => void;
}) {
  const [hoveredTile, setHoveredTile] = useState<Coords | null>(null);
  const [hoveredStack, setHoveredStack] = useState<StackMap | null>(null);

  const { config } = useReplayContext();

  // Map of tile coordinates to a map of entity IDs to stack index.
  const [entitiesById, entitiesByTile, multiEntityStacks] = useMemo(() => {
    const idMap = new Map<string, AnyEntity>();
    const tileMap = new Map<string, StackMap>();

    for (const entity of entities) {
      idMap.set(entity.getUniqueId(), entity);
      if (!entity.interactive) {
        continue;
      }

      const tile = `${entity.position.x},${entity.position.y}`;
      const stack = tileMap.get(tile) || new Map<string, StackEntity>();
      stack.set(entity.getUniqueId(), {
        entity,
        fanOutIndex: stack.size,
      });
      tileMap.set(tile, stack);
    }

    const multiEntityStacks: Array<{ position: Coords; stack: StackMap }> = [];

    for (const [tile, stack] of tileMap) {
      if (stack.size > 1) {
        const [x, y] = tile.split(',').map(Number);
        multiEntityStacks.push({
          position: { x, y },
          stack,
        });
      }
    }

    return [idMap, tileMap, multiEntityStacks];
  }, [entities]);

  const onPointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      for (const intersection of event.intersections) {
        let obj: THREE.Object3D<THREE.Object3DEventMap> | null =
          intersection.object;

        for (; obj !== null; obj = obj.parent) {
          if (obj.userData?.entityId) {
            const entityId = obj.userData.entityId as string;
            const entity = entitiesById.get(entityId);
            if (entity === undefined) {
              continue;
            }

            if (hoveredStack !== null && !hoveredStack.has(entityId)) {
              // When a stack is hovered, only entities within that stack should
              // be interactable.
              continue;
            }

            onEntityHovered(entity);
            return;
          }
        }
      }

      onEntityHovered(null);
    },
    [entitiesById, hoveredStack, onEntityHovered],
  );

  const onPointerOut = useCallback(() => {
    onEntityHovered(null);
  }, [onEntityHovered]);

  const handleTileHover = useCallback(
    (tile: Coords | null) => {
      if (!tile) {
        setHoveredTile(null);
        setHoveredStack(null);
        return;
      }

      setHoveredTile(tile);
      const stack = entitiesByTile.get(`${tile.x},${tile.y}`);
      if (stack && stack.size > 1) {
        setHoveredStack(stack);
      }
    },
    [entitiesByTile],
  );

  const handleStackHoverOut = useCallback(() => {
    setHoveredTile(null);
    setHoveredStack(null);
  }, []);

  const players = entities.filter(
    (entity) => entity.type === EntityType.PLAYER,
  ) as PlayerEntity[];
  const npcs = entities.filter(
    (entity) => entity.type === EntityType.NPC,
  ) as NpcEntity[];
  const groundObjects = entities.filter(
    (entity) => entity.type === EntityType.GROUND_OBJECT,
  ) as GroundObjectEntity[];
  const customEntities = entities.filter(
    (entity) => entity.type === EntityType.CUSTOM,
  ) as CustomEntity[];

  const mapCenterX = mapDefinition.baseX + mapDefinition.width / 2;
  const mapCenterZ = -(mapDefinition.baseY + mapDefinition.height / 2);

  const handleEntityClick = (entity: AnyEntity) => {
    if (interactionState.selectedActorId === entity.getUniqueId()) {
      onEntitySelected?.(null);
    } else {
      onEntitySelected?.(entity);
    }
  };

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight
        position={[mapDefinition.baseX, 100, -mapDefinition.baseY]}
        intensity={0.5}
      />

      <MapFloor
        baseX={mapDefinition.baseX}
        baseY={mapDefinition.baseY}
        width={mapDefinition.width}
        height={mapDefinition.height}
      />

      <TileHoverOverlay
        baseX={mapDefinition.baseX}
        baseY={mapDefinition.baseY}
        width={mapDefinition.width}
        height={mapDefinition.height}
        hoveredTile={hoveredTile}
        onTileHovered={handleTileHover}
      />

      <group onPointerMove={onPointerMove} onPointerOut={onPointerOut}>
        {players.map((entity) => {
          const stackEntity = hoveredStack?.get(entity.getUniqueId());
          const inStack = stackEntity !== undefined;

          return (
            <Player
              key={entity.getUniqueId()}
              entity={entity}
              partyColor={PARTY_COLORS[entity.orb % PARTY_COLORS.length]}
              onClicked={handleEntityClick}
              isSelected={
                interactionState.selectedActorId === entity.getUniqueId()
              }
              isHovered={
                interactionState.hoveredActorId === entity.getUniqueId()
              }
              isDimmed={hoveredStack !== null && !inStack}
              fanOutIndex={stackEntity?.fanOutIndex}
              stackSize={hoveredStack?.size ?? 1}
            />
          );
        })}

        {npcs.map((entity) => {
          const stackEntity = hoveredStack?.get(entity.getUniqueId());
          const inStack = stackEntity !== undefined;

          return (
            <Npc
              key={entity.getUniqueId()}
              entity={entity}
              onClicked={handleEntityClick}
              isSelected={
                interactionState.selectedActorId === entity.getUniqueId()
              }
              isHovered={
                interactionState.hoveredActorId === entity.getUniqueId()
              }
              isDimmed={hoveredStack !== null && !inStack}
              fanOutIndex={stackEntity?.fanOutIndex}
              stackSize={hoveredStack?.size ?? 1}
            />
          );
        })}

        {groundObjects.map((entity) => (
          <GroundObject key={entity.getUniqueId()} entity={entity} />
        ))}

        {customEntities.map((entity) => {
          const Renderer = entity.renderer;
          return <Renderer key={entity.getUniqueId()} entity={entity} />;
        })}
      </group>

      {hoveredStack && (
        <StackHoverPlane
          entities={Array.from(hoveredStack.values()).map((e) => e.entity)}
          basePosition={hoveredStack.values().next().value!.entity.position}
          onPointerOut={handleStackHoverOut}
        />
      )}

      {multiEntityStacks.map((stack) => {
        if (hoveredStack === stack.stack) {
          return null;
        }

        return (
          <StackIndicator
            key={`${stack.position.x},${stack.position.y}`}
            position={stack.position}
            size={stack.stack.size}
          />
        );
      })}

      {config.debug && (
        <>
          <gridHelper
            args={[50, 50]}
            position={[mapCenterX, 0.01, mapCenterZ]}
          />
          <axesHelper args={[50]} position={[mapCenterX, 0.01, mapCenterZ]} />
        </>
      )}
    </>
  );
}

function LoadingFallback() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--panel-bg)',
        color: 'var(--font-color-nav)',
        fontSize: '0.9rem',
      }}
    >
      <i className="fas fa-spinner fa-spin" style={{ marginRight: '0.5rem' }} />
      Loading map...
    </div>
  );
}

function CameraRig({
  controlsRef,
  initialX,
  initialZ,
  initialZoom,
}: {
  controlsRef: React.RefObject<MapControlsImpl | null>;
  initialX: number;
  initialZ: number;
  initialZoom: number;
}) {
  const { onResetAvailable } = useReplayContext();
  const { camera, controls } = useThree();
  const isInitialized = useRef(false);

  const frameId = useRef<number | null>(null);

  const resetCamera = useCallback(() => {
    if (!camera || !controlsRef.current) {
      return;
    }

    if (frameId.current) {
      cancelAnimationFrame(frameId.current);
    }

    const wasDampingEnabled = controlsRef.current.enableDamping;
    controlsRef.current.enableDamping = false;

    frameId.current = requestAnimationFrame(() => {
      const mapControls = controlsRef.current;
      if (!camera || !mapControls) {
        return;
      }

      mapControls.target0.set(initialX, 0, initialZ);
      mapControls.position0.set(initialX, 100, initialZ);

      if (camera.type === 'OrthographicCamera') {
        mapControls.zoom0 = initialZoom;
      }

      mapControls.reset();
      mapControls.enableDamping = wasDampingEnabled;
    });
  }, [camera, initialX, initialZ, initialZoom, controlsRef]);

  useEffect(() => {
    if (controls && !isInitialized.current) {
      // Set the camera's final position and orientation after the controls
      // are initialized.
      camera.position.set(initialX, 100, initialZ);
      camera.lookAt(initialX, 0, initialZ);
      isInitialized.current = true;
      onResetAvailable(resetCamera);
    }

    return () => {
      if (frameId.current) {
        cancelAnimationFrame(frameId.current);
      }
    };
  }, [controls, camera, initialX, initialZ, resetCamera, onResetAvailable]);

  return null;
}

export default function MapCanvas({
  entities,
  onEntitySelected,
  onEntityHovered,
  selectedEntity,
  followedActor = null,
  keyboardControlsEnabled = true,
  keyboardControlsSpeed = 16,
  children,
}: MapCanvasProps) {
  const { mapDefinition } = useReplayContext();

  const [interactionState, setInteractionState] =
    useState<ActorInteractionState>({
      selectedActorId: null,
      hoveredActorId: null,
    });
  const [consoleOpen, setConsoleOpen] = useState(false);
  const mapControlsRef = useRef<MapControlsImpl>(null);

  const isControlled = selectedEntity !== undefined;

  useEffect(() => {
    if (isControlled) {
      setInteractionState((prev) => ({
        ...prev,
        selectedActorId: selectedEntity ? selectedEntity.getUniqueId() : null,
      }));
    }
  }, [selectedEntity, isControlled]);

  const mapCenterX = mapDefinition.baseX + mapDefinition.width / 2;
  const mapCenterZ = -(mapDefinition.baseY + mapDefinition.height / 2);

  let initialX = mapCenterX;
  let initialZ = mapCenterZ;
  if (mapDefinition.initialCameraPosition) {
    initialX = mapDefinition.initialCameraPosition.x;
    initialZ = -mapDefinition.initialCameraPosition.y;
  }

  const cameraPosition: [number, number, number] = [initialX, 50, initialZ];

  const handleEntitySelected = (entity: AnyEntity | null) => {
    if (!isControlled) {
      setInteractionState((prev) => ({
        ...prev,
        selectedActorId: entity ? entity.getUniqueId() : null,
      }));
    }
    onEntitySelected?.(entity);
  };

  const handleEntityHovered = (entity: AnyEntity | null) => {
    setInteractionState((prev) => ({
      ...prev,
      hoveredActorId: entity ? entity.getUniqueId() : null,
    }));
    onEntityHovered?.(entity);
  };

  const handleConsoleToggle = () => {
    setConsoleOpen(!consoleOpen);
  };

  const handleConsoleClose = () => {
    setConsoleOpen(false);
  };

  return (
    <div className={styles.mapCanvas} data-camera-reset-container>
      <Canvas
        style={{
          background: '#000',
          borderRadius: '8px',
          border: '1px solid var(--nav-bg-lightened)',
          cursor: interactionState.hoveredActorId ? 'pointer' : 'default',
        }}
      >
        <OrthographicCamera
          makeDefault
          position={cameraPosition}
          zoom={mapDefinition.initialZoom ?? 20}
          near={0.1}
          far={1000}
        />

        <MapControls
          makeDefault
          ref={mapControlsRef}
          target={[initialX, 0, initialZ]}
          enableRotate
          enableZoom
          enablePan
          maxPolarAngle={Math.PI / 2.1}
          minZoom={10}
          maxZoom={150}
          mouseButtons={{
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.ROTATE,
            RIGHT: THREE.MOUSE.PAN,
          }}
        />

        <CameraRig
          controlsRef={mapControlsRef}
          initialX={initialX}
          initialZ={initialZ}
          initialZoom={mapDefinition.initialZoom ?? 20}
        />

        <KeyboardCameraControls
          speed={keyboardControlsSpeed}
          enabled={keyboardControlsEnabled}
        />

        <Suspense fallback={null}>
          <MapScene
            mapDefinition={mapDefinition}
            entities={entities}
            interactionState={interactionState}
            onEntitySelected={handleEntitySelected}
            onEntityHovered={handleEntityHovered}
          />
        </Suspense>

        {children}
      </Canvas>

      <Suspense fallback={<LoadingFallback />}>
        <div />
      </Suspense>

      <DevConsole
        isOpen={consoleOpen}
        onToggle={handleConsoleToggle}
        onClose={handleConsoleClose}
      />
    </div>
  );
}
