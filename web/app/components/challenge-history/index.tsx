import { findChallenges } from '@/actions/challenge';

import ChallengeHistoryCore, {
  ChallengeHistoryProps as CoreProps,
} from './challenge-history';

export const ClientChallengeHistory = ChallengeHistoryCore;

type ChallengeHistoryProps = Omit<CoreProps, 'initialChallenges'>;

export default async function ChallengeHistory(props: ChallengeHistoryProps) {
  const initialChallenges = await findChallenges(props.count, {
    type: props.type,
    party: props.username ? [props.username] : undefined,
    mode: props.mode,
    scale: props.scale,
    status: props.status,
  });
  return (
    <ChallengeHistoryCore {...props} initialChallenges={initialChallenges} />
  );
}
