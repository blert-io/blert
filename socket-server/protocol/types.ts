/**
 * Wire format for client communication.
 */
export enum MessageFormat {
  PROTOBUF = 'protobuf',
  JSON = 'json',
  JSON_DEFLATE = 'json-deflate',
}

/**
 * WebSocket subprotocol identifiers for wire format negotiation.
 */
export const SUBPROTOCOL_PROTOBUF = 'blert-protobuf';
export const SUBPROTOCOL_JSON = 'blert-json';
export const SUBPROTOCOL_JSON_DEFLATE = 'blert-json-deflate';

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
  if (subprotocol === SUBPROTOCOL_JSON_DEFLATE) {
    return MessageFormat.JSON_DEFLATE;
  }
  return MessageFormat.PROTOBUF;
}
