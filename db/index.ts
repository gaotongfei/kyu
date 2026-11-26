import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import 'server-only';
import * as schema from './schema';

const globalForDb = globalThis as unknown as {
  postgresClient?: ReturnType<typeof postgres>;
};
let database: PostgresJsDatabase<typeof schema> | undefined;

export function getDb() {
  if (database) {
    return database;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
  }
  const client = globalForDb.postgresClient ?? postgres(databaseUrl);
  if (process.env.NODE_ENV !== 'production') {
    globalForDb.postgresClient = client;
  }
  database = drizzle(client, { schema });
  return database;
}
