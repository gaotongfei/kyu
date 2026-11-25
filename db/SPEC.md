---
id: database
type: module-design
title: Database access and local PostgreSQL
status: draft
tags:
  - database
  - drizzle
  - postgresql
---

# Database access and local PostgreSQL

## Boundary

Database access belongs to the Next.js server through Drizzle and PostgreSQL.js.
The exported client is guarded by `server-only`; browser code must not import it
or receive database credentials. Development hot reloads share one connection
pool so module reloads do not multiply pools. A missing `DATABASE_URL` fails when
the database module is imported, not during builds that do not use it.

The schema is deliberately empty: infrastructure does not invent application
entities. Features own the tables they introduce in the shared schema.

## Configuration and schema lifecycle

Drizzle Kit uses Next.js environment loading to avoid divergent credentials
between application and migration commands. Generation and static analysis can
run without a database URL; commands that connect require one. Database changes
are explicit, reviewed, version-controlled SQL migrations, never an application
startup side effect. Direct schema push is only for disposable local databases.

## Local service

Compose owns only a development PostgreSQL service. It binds to loopback because
its documented fixed credentials are not suitable for external exposure or
production. The host port is configurable to coexist with other local databases;
`DATABASE_URL` must use that same port. Compose reads `.env` while Next.js can
also load higher-priority environment files such as `.env.local`.

The named volume is mounted at `/var/lib/postgresql`, the PostgreSQL 18 image's
data root. Stopping or replacing containers preserves data; deleting the volume
is an explicit destructive reset. PostgreSQL major-version upgrades require a
deliberate data migration rather than an image-tag-only change.
