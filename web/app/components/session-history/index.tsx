import { loadSessions } from '@/actions/challenge';

import SessionHistoryCore, {
  SessionHistoryProps as CoreProps,
} from './session-history';

export const ClientSessionHistory = SessionHistoryCore;

type SessionHistoryProps = Omit<CoreProps, 'initialSessions'>;

export default async function SessionHistory(props: SessionHistoryProps) {
  const initialSessions = await loadSessions(props.count, {
    type: props.type ? ['==', props.type] : undefined,
    mode: props.mode,
    scale: props.scale ? ['==', props.scale] : undefined,
    status: props.status
      ? ['in', Array.isArray(props.status) ? props.status : [props.status]]
      : undefined,
    party: props.username ? [props.username] : undefined,
  });

  return <SessionHistoryCore {...props} initialSessions={initialSessions} />;
}
