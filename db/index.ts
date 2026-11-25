import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import 'server-only';
import * as schema from './schema';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
}

const globalForDb = globalThis as unknown as {
  postgresClient?: ReturnType<typeof postgres>;
};

const client = globalForDb.postgresClient ?? postgres(databaseUrl);

if (process.env.NODE_ENV !== 'production') {
  globalForDb.postgresClient = client;
}

export const db = drizzle(client, { schema });
