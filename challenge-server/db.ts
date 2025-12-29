import postgres from 'postgres';

import logger from './log';

let connectionOptions: postgres.Options<Record<string, any>> | undefined =
  undefined;

if (['development', 'test'].includes(process.env.NODE_ENV!)) {
  connectionOptions = {
    debug: (_, query, params) => logger.debug('sql_query', { query, params }),
  };
}

if (process.env.BLERT_DATABASE_URI === undefined) {
  logger.error('environment_missing', { variable: 'BLERT_DATABASE_URI' });
  process.exit(1);
}

const sql = postgres(process.env.BLERT_DATABASE_URI, connectionOptions);
export default sql;
