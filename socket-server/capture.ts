/**
 * Records the control-command stream the socket server exchanges with the
 * challenge server so it can be replayed offline.
 */

/** Redis stream holding the captured command corpus. */
export const CAPTURE_COMMANDS_KEY = 'capture:commands';

/** Redis flag toggling capture. */
export const CAPTURE_ENABLED_KEY = 'capture:enabled';

/** The kind of control command recorded in the capture stream. */
export enum CaptureOp {
  START = 'start',
  JOIN = 'join',
  UPDATE = 'update',
  FINISH = 'finish',
  STATUS = 'status',
  SERVER_UPDATE = 'server-update',
}

/** A single entry in the capture stream. */
export type CaptureRecord = {
  /** Event timestamp. */
  ts: number;
  op: CaptureOp;
  /** Challenge to which the command belongs, if known. */
  challengeUuid: string | null;
  clientId: number | null;
  userId: number | null;
  /** The request body or event payload. */
  request: unknown;
  http: {
    /** Whether the challenge server accepted the request. */
    ok: boolean;
    statusCode: number;
    response: unknown;
  } | null;
};
