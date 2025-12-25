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
    logger.debug(
      '%s %o',
      query,
      params.map((p) =>
        typeof p === 'bigint' ? p.toString() : (p as unknown),
      ),
    );
}

if (process.env.BLERTBANK_DATABASE_URI === undefined) {
  logger.error('BLERTBANK_DATABASE_URI must be set');
  process.exit(1);
}

const sql = postgres(process.env.BLERTBANK_DATABASE_URI, connectionOptions);
export default sql;
