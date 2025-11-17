import postgres from 'postgres';

import logger from './log';

let connectionOptions: postgres.Options<Record<string, any>> | undefined =
  undefined;

if (['development', 'test'].includes(process.env.NODE_ENV!)) {
  connectionOptions = {
    debug: (_, query, params) => console.log(query, params),
  };
}

if (process.env.BLERT_DATABASE_URI === undefined) {
  logger.error('BLERT_DATABASE_URI must be set');
  process.exit(1);
}

const sql = postgres(process.env.BLERT_DATABASE_URI, connectionOptions);
export default sql;
