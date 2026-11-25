# Kyu

## Local development

Use the Node.js version in `.nvmrc`, Yarn 4 (via Corepack), and Docker with Compose.

```sh
yarn install
cp .env.example .env
docker compose up -d --wait
yarn db:migrate
yarn dev
```

Compose runs PostgreSQL 18 on `127.0.0.1:5432`. The `kyu` database, user, and password
are for local development only. Data is stored in a named Docker volume.

If port 5432 is occupied, change `POSTGRES_PORT` in `.env` (for example to `5433`)
and update the port in `DATABASE_URL` to match before starting Compose.

### Database access and migrations

Import `db` from `@/db` only in server-side code, such as Server Components,
Server Actions, and Route Handlers. The module is protected by `server-only` and
requires `DATABASE_URL`; never expose the URL through a `NEXT_PUBLIC_` variable.

Drizzle Kit loads `.env` and `.env.local` using Next.js environment-file precedence.
Exported environment variables take priority. Compose reads `.env`, not `.env.local`.

Define application tables in `db/schema.ts`, then generate, review, and apply SQL:

```sh
yarn db:generate
yarn db:migrate
```

Commit schema changes together with the generated SQL and metadata in `drizzle/`.
The initial schema is empty: generation reports no changes, and migration only
initializes Drizzle's migration ledger without creating application tables.
Migrations are explicit and do not run on application startup.

- `db:generate` – generate SQL migrations from the schema; no running database required
- `db:migrate` – apply pending migrations to `DATABASE_URL`
- `db:push` – apply the schema directly, for disposable local experimentation only;
  this bypasses migration history and is not a production migration workflow
- `db:studio` – open Drizzle Studio to inspect the configured database

To stop PostgreSQL while keeping its data:

```sh
docker compose down
```

To reset the local database, `docker compose down -v` **deletes its stored data**.
Start Compose again and run `yarn db:migrate` to recreate the schema.

## npm scripts

### Build and dev scripts

- `dev` – start dev server
- `build` – bundle application for production
- `analyze` – analyzes application bundle with [@next/bundle-analyzer](https://www.npmjs.com/package/@next/bundle-analyzer)

### Testing scripts

- `typecheck` – checks TypeScript types
- `lint` – runs oxlint and stylelint
- `knip` – checks for unused files, exports and dependencies
- `format:test` – checks files with oxfmt
- `jest` – runs jest tests
- `jest:watch` – starts jest watch
- `test` – generates Next.js types, then runs `format:test`, `lint`, `typecheck`, `knip` and `jest`

### Other scripts

- `storybook` – starts storybook dev server
- `storybook:build` – build production storybook bundle to `storybook-static`
- `format:write` – formats all files with oxfmt
