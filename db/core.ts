import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function databaseFromClient(client: ReturnType<typeof postgres>) {
  return drizzle(client, { schema });
}

/** Trusted server runtimes only. Next.js callers must use the guarded db/index adapter. */
export function connectDatabase(databaseUrl: string) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
  }
  const client = postgres(databaseUrl);
  return { client, db: databaseFromClient(client) };
}

export type Database = PostgresJsDatabase<typeof schema>;
export type DatabaseClient = ReturnType<typeof postgres>;
