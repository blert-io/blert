import postgres from 'postgres';

let connectionOptions: postgres.Options<{}> | undefined = undefined;

if (['development', 'test'].includes(process.env.NODE_ENV!)) {
  // connectionOptions = {
  //   debug: (_, query, params) => console.log(query, params),
  // };
}

if (process.env.BLERT_DATABASE_URI === undefined) {
  console.error('BLERT_DATABASE_URI must be set');
  process.exit(1);
}

const sql = postgres(process.env.BLERT_DATABASE_URI, connectionOptions);
export default sql;
