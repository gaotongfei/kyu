---
id: kyu-database
type: module-design
status: draft
title: PostgreSQL runtime and schema boundary
parent: kyu-architecture
---

## Runtime boundary

PostgreSQL is accessed through Drizzle and postgres-js. The Next adapter exposes lazy `getDb()`: importing it creates no client and needs no configuration; first use validates `DATABASE_URL`, creates/caches the module's database and reuses the development pool across reloads. The `server-only` guard remains. Trusted standalone server programs can explicitly create/close a pool through the shared core. Browser code must not import either database implementation; Next callers use the guarded adapter.

The core does not load environment files or connect merely because it is imported. Entry points own configuration and connection lifetime. This lets CLI help and production builds work without connecting to PostgreSQL while preserving the web protection.

## Schema and migration ownership

`db/schema.ts` and generated `db/migrations/` are authoritative. Collection owns only the `collection_*` tables: normalized source records and observation/lifecycle state; board outcomes; run/configuration snapshots; conservative monthly usage/reservation audit; and content-free deletion suppressions. Matching and lifecycle decisions belong to `kyu-collection`, not generic database helpers.

Provider identity is unique within its source scope. Quota amounts are database-constrained to the local free ceiling, and reservations reference their runs. API keys are never stored: accounting uses a one-way key fingerprint. Configuration/report snapshots project allowed fields rather than passing arbitrary objects or provider responses into JSON columns.

The editor owns the `resumes` table and its published `0000_resume_documents` migration; collection adds its six tables without altering that migration, snapshot or resume data. No profile, authentication or MCP tables are part of collection.

## Migration history across branches

Drizzle configuration uses `migrations.prefix: 'timestamp'` for new SQL and snapshot filenames. Existing applied migrations retain their names and contents. Timestamp filenames reduce numeric collisions, but the shared journal and snapshot parent IDs still require reconciliation; two branches can also generate within the same second. Unique filenames are not independent migration histories.

Rebase onto current main before generating a feature's final, unapplied migration. Rebuild only pending feature artifacts against the combined schema, preserving main's history and chronological journal order, rather than hand-merging competing snapshot children or appending older applied timestamps. Keep divergent development branches on separate databases. `drizzle-kit check`, a no-drift generation check and both isolated database gates verify the result.

The forward path from an editor-only database is additive: apply the collection migration and preserve every resume field/version/timestamp. A code rollback can leave collection tables intact because the editor does not depend on them; dropping tables or rewriting migration history is a separate destructive operation, never an implicit rebase step. Databases that applied older unpublished branch migrations need explicit operator reconciliation.

## Isolation proof

The explicit PostgreSQL integration command creates a uniquely labeled disposable PostgreSQL 18 container on a random loopback port, uses temporary storage, and verifies ownership before cleanup. It never accepts an existing user database or volume as a cleanup target. Default unit tests and builds neither start services nor contact providers.
