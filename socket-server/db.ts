import postgres from 'postgres';

import logger from './log';

const connectionOptions: postgres.Options<{
  bigint: postgres.PostgresType<bigint>;
}> = {
  types: {
    bigint: postgres.BigInt,
  },
};

if (['development', 'test'].includes(process.env.NODE_ENV!)) {
  connectionOptions.debug = (_, query, params) =>
    logger.debug('sql_query', {
      query,
      params: params.map((p) =>
        typeof p === 'bigint' ? p.toString() : (p as unknown),
      ),
    });
}

if (process.env.BLERT_DATABASE_URI === undefined) {
  logger.error('environment_missing', { variable: 'BLERT_DATABASE_URI' });
  process.exit(1);
}

const sql = postgres(process.env.BLERT_DATABASE_URI, connectionOptions);
export default sql;
