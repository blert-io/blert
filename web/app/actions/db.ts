import mongoose from 'mongoose';

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
