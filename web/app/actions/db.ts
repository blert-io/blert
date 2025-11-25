import postgres, { Sql, TransactionSql } from 'postgres';

function initPostgres(): Sql<NonNullable<unknown>> {
  if (!process.env.BLERT_DATABASE_URI) {
    throw new Error('BLERT_DATABASE_URI is not set');
  }

  let connectionOptions: postgres.Options<NonNullable<unknown>> | undefined =
    undefined;

  if (process.env.NODE_ENV === 'development') {
    connectionOptions = {
      debug: (_, query, params) => console.log(query, params),
      idle_timeout: 15,
      max_lifetime: 1,
    };
  }

  if (process.env.NODE_ENV === 'production' && !process.env.CI) {
    const maxConnections = process.env.BLERT_DATABASE_MAX_CONNECTIONS
      ? Number.parseInt(process.env.BLERT_DATABASE_MAX_CONNECTIONS)
      : 5;
    connectionOptions = {
      ssl: 'require',
      max: maxConnections,
      idle_timeout: 60,
    };
  }

  return postgres(process.env.BLERT_DATABASE_URI, connectionOptions);
}

declare global {
  var _sql: Sql<NonNullable<unknown>> | undefined;
}

globalThis._sql ??= initPostgres();
export const sql = globalThis._sql;

export type Db =
  | Sql<NonNullable<unknown>>
  | TransactionSql<NonNullable<unknown>>;
