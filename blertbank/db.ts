import postgres from 'postgres';

import logger from './log';

let connectionOptions: postgres.Options<Record<string, never>> | undefined =
  undefined;

if (['development', 'test'].includes(process.env.NODE_ENV!)) {
  connectionOptions = {
    debug: (_, query, params) => logger.debug('%s %o', query, params),
  };
}

if (process.env.BLERTBANK_DATABASE_URI === undefined) {
  logger.error('BLERTBANK_DATABASE_URI must be set');
  process.exit(1);
}

const sql = postgres(process.env.BLERTBANK_DATABASE_URI, connectionOptions);
export default sql;
