import { useState } from 'react';

import {
  MaidenCrabPosition,
  MaidenCrabSpawn,
  MaidenCrabSpawnEvent,
} from '../../stats';
import { ticksToFormattedSeconds } from '../../tick';

import styles from './style.module.css';

type CrabSpawnProps = {
  crabs: MaidenCrabSpawnEvent[];
  tickDiff?: number;
};

const SPAWN_STRING = {
  [MaidenCrabSpawn.SEVENTIES]: '70s',
  [MaidenCrabSpawn.FIFTIES]: '50s',
  [MaidenCrabSpawn.THIRTIES]: '30s',
};

export function CrabSpawn({ crabs, tickDiff }: CrabSpawnProps) {
  const [open, setOpen] = useState(false);

  const spawns: { [spawn: string]: boolean } = crabs.reduce(
    (prev, crab) => ({
      ...prev,
      [crab.maidenEntity.crab?.position as string]: true,
    }),
    {},
  );

  const spawn = crabs[0].maidenEntity.crab!.spawn;
  const scuffed = crabs[0].maidenEntity.crab!.scuffed;

  return (
    <div className={styles.event}>
      <button onClick={() => setOpen(!open)}>
        <span className={styles.icon}>
          {(open && (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 15.75l7.5-7.5 7.5 7.5"
              />
            </svg>
          )) || (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 8.25l-7.5 7.5-7.5-7.5"
              />
            </svg>
          )}
        </span>
        <span className={styles.title}>{SPAWN_STRING[spawn]}</span>
        <span className={styles.time}>
          {ticksToFormattedSeconds(crabs[0].tick)}
        </span>
        {tickDiff !== undefined && (
          <span className={styles.addendum}>
            +{ticksToFormattedSeconds(tickDiff)}
          </span>
        )}
      </button>
      {open && (
        <table>
          <thead>
            <tr>
              <td>Spawn</td>
              <td>Scuffed?</td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <table className={styles.spawn}>
                  <tbody>
                    <tr>
                      <td>{spawns[MaidenCrabPosition.S1] && 'S1'}</td>
                      <td>{spawns[MaidenCrabPosition.N1] && 'N1'}</td>
                    </tr>
                    <tr>
                      <td>{spawns[MaidenCrabPosition.S2] && 'S2'}</td>
                      <td>{spawns[MaidenCrabPosition.N2] && 'N2'}</td>
                    </tr>
                    <tr>
                      <td>{spawns[MaidenCrabPosition.S3] && 'S3'}</td>
                      <td>{spawns[MaidenCrabPosition.N3] && 'N3'}</td>
                    </tr>
                    <tr>
                      <td>
                        {spawns[MaidenCrabPosition.S4_OUTER] && 'S4'}
                        {spawns[MaidenCrabPosition.S4_INNER] && 'S4'}
                      </td>
                      <td>
                        {spawns[MaidenCrabPosition.N4_INNER] && 'N4'}
                        {spawns[MaidenCrabPosition.N4_OUTER] && 'N4'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td>
                {scuffed ? (
                  <span>Yes</span>
                ) : (
                  <span style={{ color: 'var(--blert-red)' }}>No</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
