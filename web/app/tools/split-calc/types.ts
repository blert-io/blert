import { ChallengeMode } from '@blert/common';
import { SplitType } from '@blert/common';

export type {
  DistributionBin,
  SplitDistribution,
} from '@/actions/split-distributions';

export type RoomDefinition = {
  key: string;
  label: string;
  splitType: SplitType;
  image: string;
  /** Tick cycle length for the room. Distributions are quantized to this. */
  tickCycle?: number;
};

export const TOB_ROOMS: RoomDefinition[] = [
  {
    key: 'maiden',
    label: 'Maiden',
    splitType: SplitType.TOB_MAIDEN,
    image: '/images/npcs/8360.webp',
  },
  {
    key: 'bloat',
    label: 'Bloat',
    splitType: SplitType.TOB_BLOAT,
    image: '/images/npcs/8359.webp',
  },
  {
    key: 'nylo',
    label: 'Nylocas',
    splitType: SplitType.TOB_NYLO_ROOM,
    image: '/images/npcs/8355.webp',
    tickCycle: 4,
  },
  {
    key: 'sote',
    label: 'Sotetseg',
    splitType: SplitType.TOB_SOTETSEG,
    image: '/images/npcs/8388.webp',
  },
  {
    key: 'xarpus',
    label: 'Xarpus',
    splitType: SplitType.TOB_XARPUS,
    image: '/images/npcs/8340.webp',
  },
  {
    key: 'verzik',
    label: 'Verzik',
    splitType: SplitType.TOB_VERZIK_ROOM,
    image: '/images/npcs/8374.webp',
  },
];

export const TOB_MODES = [
  { mode: ChallengeMode.TOB_REGULAR, label: 'Regular' },
  { mode: ChallengeMode.TOB_HARD, label: 'Hard' },
];

export const TOB_SCALES = [1, 2, 3, 4, 5] as const;

export enum SplitTier {
  STANDARD = 'standard',
  SPEEDRUN = 'speedrun',
}

export type RoomSource = 'user' | 'imported' | 'computed';

export type RoomState = {
  ticks: number | null;
  source: RoomSource;
  locked: boolean;
};
