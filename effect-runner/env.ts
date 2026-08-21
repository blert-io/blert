import dotenv from 'dotenv';

dotenv.config({ path: ['.env.local', `.env.${process.env.NODE_ENV}`] });
