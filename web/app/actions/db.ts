import postgres from 'postgres';

let connectionOptions: postgres.Options<{}> | undefined = undefined;

if (['development', 'test'].includes(process.env.NODE_ENV)) {
  connectionOptions = {
    debug: (_, query, params) => console.log(query, params),
  };
}

export const sql = postgres(process.env.BLERT_DATABASE_URI!, connectionOptions);
