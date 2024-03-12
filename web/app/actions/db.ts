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
    let dbAuth = '';
    if (process.env.DB_USERNAME && process.env.DB_PASSWORD) {
      dbAuth = `${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@`;
    }

    if (!process.env.DB_HOST) {
      console.error('No database host is configured');
      process.exit(1);
    }

    const mongoUri = `mongodb://${dbAuth}${process.env.DB_HOST}`;
    console.log('Connecting to database');
    cached.promise = mongoose.connect(mongoUri).then((mongoose) => {
      return mongoose;
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
