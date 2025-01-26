'use client';

import dynamic from 'next/dynamic';
import type { SwaggerUIProps } from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';

const SwaggerUI = dynamic<SwaggerUIProps>(() => import('swagger-ui-react'), {
  ssr: false,
});

import styles from './style.module.scss';

const spec = {
  openapi: '3.0.0',
  info: {
    title: 'Blert API',
    version: '1.0.0',
    description: 'API documentation for Blert',
  },
  components: {
    schemas: {
      NpcInfo: {
        type: 'object',
        properties: {
          type: {
            type: 'integer',
            description: 'NPC type',
          },
          roomId: {
            type: 'integer',
            description: 'Room ID',
          },
          spawnNpcId: {
            type: 'integer',
            description: 'Spawn NPC ID',
          },
          spawnTick: {
            type: 'integer',
            description: 'Spawn tick',
          },
          spawnPoint: {
            type: 'object',
            properties: {
              x: {
                type: 'integer',
                description: 'X coordinate',
              },
              y: {
                type: 'integer',
                description: 'Y coordinate',
              },
            },
          },
          deathTick: {
            type: 'integer',
            description: 'Death tick',
          },
          deathPoint: {
            type: 'object',
            properties: {
              x: {
                type: 'integer',
                description: 'X coordinate',
              },
              y: {
                type: 'integer',
                description: 'Y coordinate',
              },
            },
          },
        },
      },
      TobStats: {
        type: 'object',
        properties: {
          maidenDeaths: {
            type: 'integer',
            description: 'Deaths at Maiden',
          },
          maidenFullLeaks: {
            type: 'integer',
            nullable: true,
            description: 'Number of full leaks at Maiden',
          },
          maidenScuffedSpawns: {
            type: 'boolean',
            description: 'Whether Maiden had scuffed spawns',
          },
          bloatDeaths: {
            type: 'integer',
            description: 'Deaths at Bloat',
          },
          bloatFirstDownHpPercent: {
            type: 'integer',
            nullable: true,
            description: 'Bloat HP percentage on first down',
          },
          nylocasDeaths: {
            type: 'integer',
            description: 'Deaths at Nylocas',
          },
          nylocasPreCapStalls: {
            type: 'integer',
            nullable: true,
            description: 'Pre-cap stalls at Nylocas',
          },
          nylocasPostCapStalls: {
            type: 'integer',
            nullable: true,
            description: 'Post-cap stalls at Nylocas',
          },
          nylocasStalls: {
            type: 'array',
            items: {
              type: 'integer',
            },
            minItems: 31,
            maxItems: 31,
            description:
              'Number of stalls for each wave at Nylocas (31 waves total)',
            example: [
              0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0,
            ],
          },
          nylocasMageSplits: {
            type: 'integer',
            description: 'Mage splits at Nylocas',
          },
          nylocasRangedSplits: {
            type: 'integer',
            description: 'Ranged splits at Nylocas',
          },
          nylocasMeleeSplits: {
            type: 'integer',
            description: 'Melee splits at Nylocas',
          },
          nylocasBossMage: {
            type: 'integer',
            description: 'Boss mage splits at Nylocas',
          },
          nylocasBossRanged: {
            type: 'integer',
            description: 'Boss ranged splits at Nylocas',
          },
          nylocasBossMelee: {
            type: 'integer',
            description: 'Boss melee splits at Nylocas',
          },
          sotetsegDeaths: {
            type: 'integer',
            description: 'Deaths at Sotetseg',
          },
          xarpusDeaths: {
            type: 'integer',
            description: 'Deaths at Xarpus',
          },
          xarpusHealing: {
            type: 'integer',
            nullable: true,
            description: 'Healing at Xarpus',
          },
          verzikDeaths: {
            type: 'integer',
            description: 'Deaths at Verzik',
          },
          verzikRedsCount: {
            type: 'integer',
            nullable: true,
            description: 'Number of red crabs at Verzik',
          },
          verzikBounces: {
            type: 'integer',
            nullable: true,
            description: 'Number of bounces at Verzik',
          },
        },
      },
    },
  },
  paths: {
    '/api/v1/players/{username}/pbs': {
      get: {
        summary: 'Get personal bests for a player',
        parameters: [
          {
            name: 'username',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
            },
            description: 'Username of the player',
          },
          {
            name: 'split',
            in: 'query',
            schema: {
              type: 'string',
              pattern: '^\\d+(,\\d+)*$',
            },
            description: 'Comma-separated list of split type IDs to filter by',
          },
          {
            name: 'scale',
            in: 'query',
            schema: {
              type: 'string',
              pattern: '^\\d+(,\\d+)*$',
            },
            description: 'Comma-separated list of scales (1-8) to filter by',
          },
        ],
        responses: {
          '200': {
            description: 'List of personal bests',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      cid: {
                        type: 'string',
                        format: 'uuid',
                        description: 'Challenge ID',
                      },
                      type: {
                        type: 'integer',
                        description: 'Split type ID',
                        example: 1,
                      },
                      scale: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 8,
                        description: 'Challenge scale',
                        example: 4,
                      },
                      ticks: {
                        type: 'integer',
                        description: 'Time in game ticks',
                        example: 1000,
                      },
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid parameters provided',
          },
          '404': {
            description:
              'Player not found or no personal bests match the criteria',
          },
          '500': {
            description: 'Internal server error',
          },
        },
      },
    },
    '/api/v1/raids/tob/{id}': {
      get: {
        summary: 'Get details of a Theatre of Blood raid',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              format: 'uuid',
            },
            description: 'Raid ID',
          },
        ],
        responses: {
          '200': {
            description: 'Raid details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    uuid: {
                      type: 'string',
                      format: 'uuid',
                      description: 'Raid ID',
                    },
                    type: {
                      type: 'integer',
                      description: 'Raid type',
                      example: 1,
                    },
                    stage: {
                      type: 'integer',
                      description: 'Current raid stage',
                      example: 15,
                    },
                    startTime: {
                      type: 'string',
                      format: 'date-time',
                      description: 'When the raid started',
                    },
                    status: {
                      type: 'integer',
                      description: 'Raid status',
                      example: 1,
                    },
                    mode: {
                      type: 'integer',
                      description: 'Raid mode',
                      example: 11,
                    },
                    scale: {
                      type: 'integer',
                      minimum: 1,
                      maximum: 5,
                      description: 'Team size',
                      example: 1,
                    },
                    challengeTicks: {
                      type: 'integer',
                      description: 'Challenge ticks',
                      example: 1632,
                    },
                    overallTicks: {
                      type: 'integer',
                      description: 'Overall ticks',
                      example: 2040,
                    },
                    totalDeaths: {
                      type: 'integer',
                      description: 'Total deaths in the raid',
                      example: 3,
                    },
                    party: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          username: {
                            type: 'string',
                            description:
                              'Player username at the time of the raid',
                            example: 'blert',
                          },
                          currentUsername: {
                            type: 'string',
                            description: 'Current player username',
                            example: 'blert',
                          },
                          primaryGear: {
                            type: 'integer',
                            description: 'Main armor type the player was using',
                            example: 1,
                          },
                        },
                      },
                    },
                    splits: {
                      type: 'object',
                      additionalProperties: {
                        type: 'integer',
                        description: 'Split time in ticks',
                      },
                      description:
                        'Map of split type IDs to completion times in ticks. Any split type may be present.',
                      example: {
                        '1': 204,
                        '6': 1632,
                      },
                    },
                    tobRooms: {
                      type: 'object',
                      properties: {
                        maiden: {
                          type: 'object',
                          properties: {
                            stage: {
                              type: 'integer',
                              description: 'Room stage (Stage.TOB_MAIDEN)',
                              example: 10,
                            },
                            ticksLost: {
                              type: 'integer',
                              description: 'Ticks lost in the room',
                            },
                            deaths: {
                              type: 'array',
                              items: {
                                type: 'string',
                              },
                              description: 'Players who died in the room',
                              example: ['blert'],
                            },
                            npcs: {
                              type: 'object',
                              additionalProperties: {
                                allOf: [
                                  { $ref: '#/components/schemas/NpcInfo' },
                                  {
                                    type: 'object',
                                    properties: {
                                      maidenCrab: {
                                        type: 'object',
                                        properties: {
                                          spawn: {
                                            type: 'integer',
                                            description: 'Spawn number',
                                          },
                                          position: {
                                            type: 'integer',
                                            description: 'Position',
                                          },
                                          scuffed: {
                                            type: 'boolean',
                                            description:
                                              'Whether the spawn was scuffed',
                                          },
                                        },
                                      },
                                    },
                                  },
                                ],
                              },
                              description:
                                'Map of NPC room IDs to NPC information',
                              example: {
                                '32451': {
                                  type: 1,
                                  roomId: 32451,
                                  spawnNpcId: 8360,
                                  spawnTick: 0,
                                  spawnPoint: { x: 3162, y: 4444 },
                                  deathTick: 204,
                                  deathPoint: { x: 3162, y: 4444 },
                                  maidenCrab: {
                                    spawn: 1,
                                    position: 2,
                                    scuffed: false,
                                  },
                                },
                                '32456': {
                                  type: 1,
                                  roomId: 32456,
                                  spawnNpcId: 8361,
                                  spawnTick: 40,
                                  spawnPoint: { x: 3176, y: 4437 },
                                  deathTick: 180,
                                  deathPoint: { x: 3176, y: 4437 },
                                  maidenCrab: {
                                    spawn: 1,
                                    position: 2,
                                    scuffed: false,
                                  },
                                },
                              },
                            },
                          },
                        },
                        bloat: {
                          type: 'object',
                          properties: {
                            stage: {
                              type: 'integer',
                              description: 'Room stage (Stage.TOB_BLOAT)',
                              example: 11,
                            },
                            ticksLost: {
                              type: 'integer',
                              description: 'Ticks lost in the room',
                            },
                            deaths: {
                              type: 'array',
                              items: {
                                type: 'string',
                              },
                              description: 'Players who died in the room',
                              example: [],
                            },
                            downTicks: {
                              type: 'array',
                              items: {
                                type: 'integer',
                              },
                              description: 'Ticks when Bloat went down',
                            },
                            npcs: {
                              type: 'object',
                              additionalProperties: {
                                $ref: '#/components/schemas/NpcInfo',
                              },
                              description:
                                'Map of NPC room IDs to NPC information',
                              example: {
                                '41235': {
                                  type: 0,
                                  roomId: 41235,
                                  spawnNpcId: 8359,
                                  spawnTick: 0,
                                  spawnPoint: { x: 3287, y: 4440 },
                                  deathTick: 408,
                                  deathPoint: { x: 3287, y: 4440 },
                                },
                              },
                            },
                          },
                        },
                        nylocas: {
                          type: 'object',
                          properties: {
                            stage: {
                              type: 'integer',
                              description: 'Room stage (Stage.TOB_NYLOCAS)',
                              example: 12,
                            },
                            ticksLost: {
                              type: 'integer',
                              description: 'Ticks lost in the room',
                            },
                            deaths: {
                              type: 'array',
                              items: {
                                type: 'string',
                              },
                              description: 'Players who died in the room',
                              example: ['blert'],
                            },
                            stalledWaves: {
                              type: 'array',
                              items: {
                                type: 'integer',
                              },
                              description: 'Wave numbers that were stalled',
                            },
                            npcs: {
                              type: 'object',
                              additionalProperties: {
                                allOf: [
                                  { $ref: '#/components/schemas/NpcInfo' },
                                  {
                                    type: 'object',
                                    properties: {
                                      nylo: {
                                        type: 'object',
                                        properties: {
                                          wave: {
                                            type: 'integer',
                                            description: 'Wave number',
                                          },
                                          parentRoomId: {
                                            type: 'integer',
                                            description: 'Parent room ID',
                                          },
                                          big: {
                                            type: 'boolean',
                                            description:
                                              'Whether this is a big nylocas',
                                          },
                                          style: {
                                            type: 'integer',
                                            description:
                                              'Combat style (0: Melee, 1: Range, 2: Magic)',
                                          },
                                          spawnType: {
                                            type: 'integer',
                                            description: 'Spawn type',
                                          },
                                        },
                                      },
                                    },
                                  },
                                ],
                              },
                              description:
                                'Map of NPC room IDs to NPC information',
                              example: {
                                '45123': {
                                  type: 2,
                                  roomId: 45123,
                                  spawnNpcId: 8355,
                                  spawnTick: 20,
                                  spawnPoint: { x: 3420, y: 4444 },
                                  deathTick: 40,
                                  deathPoint: { x: 3420, y: 4444 },
                                  nylo: {
                                    wave: 1,
                                    parentRoomId: 0,
                                    big: false,
                                    style: 0,
                                    spawnType: 1,
                                  },
                                },
                              },
                            },
                          },
                        },
                        sotetseg: {
                          type: 'object',
                          properties: {
                            stage: {
                              type: 'integer',
                              description: 'Room stage (Stage.TOB_SOTETSEG)',
                              example: 13,
                            },
                            ticksLost: {
                              type: 'integer',
                              description: 'Ticks lost in the room',
                            },
                            deaths: {
                              type: 'array',
                              items: {
                                type: 'string',
                              },
                              description: 'Players who died in the room',
                              example: [],
                            },
                            maze1Pivots: {
                              type: 'array',
                              items: {
                                type: 'integer',
                              },
                              description: 'First maze pivot points',
                            },
                            maze2Pivots: {
                              type: 'array',
                              items: {
                                type: 'integer',
                              },
                              description: 'Second maze pivot points',
                            },
                            npcs: {
                              type: 'object',
                              additionalProperties: {
                                $ref: '#/components/schemas/NpcInfo',
                              },
                              description:
                                'Map of NPC room IDs to NPC information',
                              example: {
                                '47891': {
                                  type: 0,
                                  roomId: 47891,
                                  spawnNpcId: 8388,
                                  spawnTick: 0,
                                  spawnPoint: { x: 3280, y: 4306 },
                                  deathTick: 1020,
                                  deathPoint: { x: 3280, y: 4306 },
                                },
                              },
                            },
                          },
                        },
                        xarpus: {
                          type: 'object',
                          properties: {
                            stage: {
                              type: 'integer',
                              description: 'Room stage (Stage.TOB_XARPUS)',
                              example: 14,
                            },
                            ticksLost: {
                              type: 'integer',
                              description: 'Ticks lost in the room',
                            },
                            deaths: {
                              type: 'array',
                              items: {
                                type: 'string',
                              },
                              description: 'Players who died in the room',
                              example: ['blert'],
                            },
                            npcs: {
                              type: 'object',
                              additionalProperties: {
                                $ref: '#/components/schemas/NpcInfo',
                              },
                              description:
                                'Map of NPC room IDs to NPC information',
                              example: {
                                '49123': {
                                  type: 0,
                                  roomId: 49123,
                                  spawnNpcId: 8338,
                                  spawnTick: 0,
                                  spawnPoint: { x: 3169, y: 4380 },
                                  deathTick: 1224,
                                  deathPoint: { x: 3169, y: 4380 },
                                },
                              },
                            },
                          },
                        },
                        verzik: {
                          type: 'object',
                          properties: {
                            stage: {
                              type: 'integer',
                              description: 'Room stage (Stage.TOB_VERZIK)',
                              example: 15,
                            },
                            ticksLost: {
                              type: 'integer',
                              description: 'Ticks lost in the room',
                            },
                            deaths: {
                              type: 'array',
                              items: {
                                type: 'string',
                              },
                              description: 'Players who died in the room',
                              example: [],
                            },
                            redsSpawnCount: {
                              type: 'integer',
                              description: 'Number of red crabs spawned',
                            },
                            npcs: {
                              type: 'object',
                              additionalProperties: {
                                $ref: '#/components/schemas/NpcInfo',
                              },
                              description:
                                'Map of NPC room IDs to NPC information',
                              example: {
                                '50789': {
                                  type: 0,
                                  roomId: 50789,
                                  spawnNpcId: 8369,
                                  spawnTick: 0,
                                  spawnPoint: { x: 3167, y: 4324 },
                                  deathTick: 1632,
                                  deathPoint: { x: 3167, y: 4324 },
                                },
                                '50804': {
                                  type: 3,
                                  roomId: 50804,
                                  spawnNpcId: 8385,
                                  spawnTick: 1200,
                                  spawnPoint: { x: 3167, y: 4324 },
                                  deathTick: 1220,
                                  deathPoint: { x: 3167, y: 4324 },
                                  verzikCrab: {
                                    phase: 2,
                                    spawn: 1,
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                    tobStats: {
                      $ref: '#/components/schemas/TobStats',
                    },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Raid not found',
          },
          '500': {
            description: 'Internal server error',
          },
        },
      },
    },
  },
};

export default function ApiDocs() {
  return (
    <div className={styles.container}>
      <SwaggerUI url="" spec={spec} />
    </div>
  );
}
