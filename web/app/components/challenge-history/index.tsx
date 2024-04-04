import { loadRecentChallenges } from '../../actions/challenge';

import ChallengeHistoryCore, {
  ChallengeHistoryProps as CoreProps,
} from './challenge-history';

type ChallengeHistoryProps = Omit<CoreProps, 'initialChallenges'>;

export default async function ChallengeHistory(props: ChallengeHistoryProps) {
  const initialChallenges = await loadRecentChallenges(
    props.count,
    props.type,
    props.username,
  );
  return (
    <ChallengeHistoryCore {...props} initialChallenges={initialChallenges} />
  );
}
