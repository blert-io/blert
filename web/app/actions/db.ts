import mongoose from 'mongoose';
import postgres from 'postgres';

declare global {
  namespace globalThis {
    var mongoose: any;
  }
}

let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

export default async function connectToDatabase() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    if (!process.env.DB_CONNECTION_STRING) {
      console.error('No database host is configured');
      process.exit(1);
    }

    console.log('Connecting to database');
    cached.promise = mongoose
      .connect(process.env.DB_CONNECTION_STRING)
      .then((mongoose) => {
        return mongoose;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

let connectionOptions: postgres.Options<{}> | undefined = undefined;

if (['development'].includes(process.env.NODE_ENV)) {
  connectionOptions = {
    debug: (_, query, params) => console.log(query, params),
  };
}

export const sql = postgres(process.env.BLERT_DATABASE_URI!, connectionOptions);
