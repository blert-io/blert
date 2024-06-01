import postgres from 'postgres';

let connectionOptions: postgres.Options<{}> | undefined = undefined;

if (['development', 'test'].includes(process.env.NODE_ENV)) {
  connectionOptions = {
    debug: (_, query, params) => console.log(query, params),
    idle_timeout: 15,
    max_lifetime: 1,
  };
}
if (process.env.NODE_ENV === 'production') {
  connectionOptions = {
    ssl: 'require',
  };
}

export const sql = postgres(process.env.BLERT_DATABASE_URI!, connectionOptions);
