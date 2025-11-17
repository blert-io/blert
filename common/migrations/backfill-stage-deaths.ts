import postgres from 'postgres';
import { parseArgs } from 'util';

import {
  dataRepositoryFromEnv,
  forEachChallengeWithData,
} from './script-helpers';
import { ChallengeStatus, ChallengeType, Stage, TobRooms } from '../challenge';

// Historic one-off migration script, will never be run again.
/* eslint-disable */

export async function scriptMain(sql: postgres.Sql, args: string[]) {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'batch-size': { type: 'string', default: '100' },
      'start-id': { type: 'string' },
      'end-id': { type: 'string' },
    },
    args,
  });

  const dryRun = values['dry-run'];

  const dataRepository = dataRepositoryFromEnv();

  const options = {
    batchSize: parseInt(values['batch-size']),
    startId: values['start-id'] ? parseInt(values['start-id']) : undefined,
    endId: values['end-id'] ? parseInt(values['end-id']) : undefined,
  };

  await forEachChallengeWithData(
    sql,
    dataRepository,
    async (challenge, data) => {
      const players = await sql`
        SELECT challenge_id, player_id, username
        FROM challenge_players
        WHERE challenge_id = ${challenge.id}
      `;

      if (players.length !== challenge.scale) {
        console.warn(
          `Challenge ${challenge.id} has ${players.length} players, expected ${challenge.scale}; skipping`,
        );
        return;
      }

      const playerDeaths = players.reduce(
        (acc, player) => {
          acc[player.username] = [];
          return acc;
        },
        {} as Record<string, Stage[]>,
      );

      if (challenge.type === ChallengeType.COLOSSEUM) {
        if (challenge.status === ChallengeStatus.WIPED) {
          playerDeaths[players[0].username].push(challenge.stage);
        }
      } else if (challenge.type === ChallengeType.TOB) {
        const rooms = data as TobRooms;
        Object.values(rooms).forEach((room) => {
          if (room !== null) {
            for (const username of room.deaths) {
              if (username in playerDeaths) {
                playerDeaths[username].push(room.stage);
              } else {
                console.warn(
                  `Challenge ${challenge.uuid}: Player ${username} not found in players:`,
                  players.map((p) => p.username),
                );
              }
            }
          }
        });
      }

      for (const player of players) {
        if (dryRun) {
          console.log(
            `Setting stage deaths for (${player.challenge_id}, ${player.player_id})` +
              ` [${player.username}] to`,
            playerDeaths[player.username],
          );
        } else {
          await sql`
            UPDATE challenge_players
            SET stage_deaths = ${playerDeaths[player.username]}
            WHERE (challenge_id, player_id) = (${player.challenge_id}, ${player.player_id})
          `;
        }
      }
    },
    options,
  );
}
