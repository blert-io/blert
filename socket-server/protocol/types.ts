/**
 * Wire format for client communication.
 */
export enum MessageFormat {
  PROTOBUF = 'protobuf',
  JSON = 'json',
}

/**
 * WebSocket subprotocol identifiers for wire format negotiation.
 */
export const SUBPROTOCOL_PROTOBUF = 'blert-protobuf';
export const SUBPROTOCOL_JSON = 'blert-json';

/**
 * All supported WebSocket subprotocols.
 */
export const SUPPORTED_SUBPROTOCOLS = [
  SUBPROTOCOL_PROTOBUF,
  SUBPROTOCOL_JSON,
] as const;

export type SupportedSubprotocol = (typeof SUPPORTED_SUBPROTOCOLS)[number];

/**
 * Returns the message format for a given subprotocol.
 * Defaults to PROTOBUF for unknown or missing subprotocols.
 *
 * @param subprotocol WebSocket subprotocol.
 * @returns Message format.
 */
export function subprotocolToFormat(
  subprotocol: string | undefined,
): MessageFormat {
  if (subprotocol === SUBPROTOCOL_JSON) {
    return MessageFormat.JSON;
  }
  return MessageFormat.PROTOBUF;
}

/**
 * Returns the subprotocol string for a given message format.
 *
 * @param format Message format.
 * @returns Subprotocol string.
 */
export function formatToSubprotocol(
  format: MessageFormat,
): SupportedSubprotocol {
  if (format === MessageFormat.JSON) {
    return SUBPROTOCOL_JSON;
  }
  return SUBPROTOCOL_PROTOBUF;
}
