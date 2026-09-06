import postgres, { TransactionSql } from 'postgres';

import logger from './log';

export type Sql =
  postgres.Sql<{ bigint: bigint }> | TransactionSql<{ bigint: bigint }>;

/**
 * SQLSTATE error classes which may be transient and succeed on retry.
 * Connection exception, transaction rollback (serialization failure, deadlock),
 * insufficient resources, operator intervention (including statement timeout).
 */
const TRANSIENT_SQLSTATE_CLASSES = ['08', '40', '53', '57'];

/** Client-side connection failures raised by `postgres`. */
const CONNECTION_ERROR_CODES = new Set([
  'CONNECTION_DESTROYED',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
]);

/**
 * Determines whether an error is a database error which may succeed if retried.
 * @param error The thrown error.
 * @returns True if the error is a transient database failure.
 */
export function isTransientDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }
  const { code } = error;
  if (typeof code !== 'string') {
    return false;
  }
  if (error instanceof postgres.PostgresError) {
    return TRANSIENT_SQLSTATE_CLASSES.some((cls) => code.startsWith(cls));
  }
  return CONNECTION_ERROR_CODES.has(code);
}

/**
 * Opens a connection pool to the database at `uri`.
 * @param uri Postgres connection URI.
 * @returns The connected client.
 */
export function connect(uri: string) {
  const connectionOptions: postgres.Options<{
    bigint: postgres.PostgresType<bigint>;
  }> = {
    types: {
      bigint: postgres.BigInt,
    },
  };

  if (['development', 'test'].includes(process.env.NODE_ENV!)) {
    connectionOptions.debug = (_, query, params) =>
      logger.debug(
        '%s %o',
        query,
        params.map((p) =>
          typeof p === 'bigint' ? p.toString() : (p as unknown),
        ),
      );
  }

  return postgres(uri, connectionOptions);
}
