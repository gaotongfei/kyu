import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  migrations: { prefix: 'timestamp' },
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
