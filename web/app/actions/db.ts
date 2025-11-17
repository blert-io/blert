import postgres, { Sql, TransactionSql } from 'postgres';

let connectionOptions: postgres.Options<{}> | undefined = undefined;

if (process.env.NODE_ENV === 'development') {
  connectionOptions = {
    debug: (_, query, params) => console.log(query, params),
    idle_timeout: 15,
    max_lifetime: 1,
  };
}
if (process.env.NODE_ENV === 'production' && !process.env.CI) {
  connectionOptions = {
    ssl: 'require',
  };
}

export const sql = postgres(process.env.BLERT_DATABASE_URI!, connectionOptions);

export type Db = Sql<{}> | TransactionSql<{}>;
