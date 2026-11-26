# Kyu

A self-hosted Markdown resume editor, manually collected job catalog, and optional application-writing assistant. There is no authentication: run only on a private machine/network with one trusted operator.

## Local development

Use Node.js from `.nvmrc`, Yarn 4 via Corepack, and Docker Compose.

```sh
yarn install
test -f .env || cp .env.example .env
docker compose up -d --wait
yarn db:migrate
yarn dev --hostname 127.0.0.1
```

Create `.env` only if it does not already exist. `/` redirects to `/jobs`; the editor remains at `/resumes`. If another workspace uses port 5432, choose a free port and update both `POSTGRES_PORT` and `DATABASE_URL`. Use a distinct Compose project name per workspace; never reset another workspace's containers or volumes.

The initial resume migration expects a **fresh database** and does not convert the former section-based schema. A database already using that migration can apply the additive collection migration without resetting its resumes. Databases that exercised unpublished feature-branch migrations require explicit reconciliation, not an automatic reset.

## Editing and exports

Create, select, rename and delete named resumes. Edit the entire source in one textarea; headings and fences are ordinary Markdown, not application-managed sections. Autosave is version-checked, and switching or exporting waits for pending edits. Failed saves retain local edits with explicit retry and an unsaved Markdown backup.

The live HTML preview updates locally, including unsaved edits. Markdown downloads contain the stored source; PDF rendering happens only when explicitly exporting. Both renderers share safe Markdown parsing, the Classic theme and bundled Lato fonts. The preview is continuous, not an exact paginated PDF proof. Unsupported syntax stays readable; HTML and unsafe links are not executed.

Imports are reviewed and editable before creating a new resume, never replacements for the current document:

- **Markdown:** strict UTF-8, up to 500,000 UTF-16 units, including empty documents. Unedited imports preserve whitespace, BOM and CRLF through export. Editing uses normal browser textarea behavior.
- **PDF:** up to 10 MiB and 20 pages, with selectable text. Extraction is local and produces a Markdown draft with explicit line breaks for preview and PDF export; no OCR, layout recovery or original-file retention. Existing imported documents are not rewritten—reimport the PDF or add Markdown hard breaks to keep their lines separate.

## Job collection

The `/jobs` catalog reads PostgreSQL only. Browser reads, startup, builds and automated tests never contact job providers. Hirebase, Ashby and Greenhouse are supported; all bundled board/search examples remain disabled until explicitly selected.

```sh
test -f collector.local.json || cp collector.local.example.json collector.local.json
# Edit enabledBoards and searches before collection.
yarn collect:config validate
yarn collect --hirebase-budget 0           # enabled boards only
yarn collect --hirebase-budget 2           # at most two returned Hirebase records
```

Add `HIREBASE_API_KEY` only to this workspace's server environment for Hirebase. Free currently allows 500 **returned records** per UTC month, including duplicates/nonmatches. Persistent accounting, provider capacity and the explicit invocation cap all apply. No plan is upgraded. Live Hirebase verification remains outstanding; no key/request was used during implementation.

See [collector operations](collector/README.md) for budgets, partial-source behavior, pruning/purge and verification limits, and [directory/configuration rules](collector/DIRECTORY.md) for matching, attribution and reviewed contributions.

## Application drafts

From a collected job, open **Prepare drafts**, select a saved resume, and generate a tailored resume and cover letter. Review/edit both drafts; save the resume as a **new** document or download Markdown. Your original is never overwritten. AI is not used for job matching, and ordinary page reads never generate content.

After `yarn db:migrate`, generate a 32-byte installation key and set it as `KYU_AI_ENCRYPTION_KEY` in the server environment:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Restart Kyu, open `/settings/ai`, connect **OpenAI API** or **OpenRouter**, then explicitly select a connection/model. Keys and tokens are encrypted in PostgreSQL and never returned to the browser. Back up the installation key securely with the database: changing or losing it makes saved connections unreadable. Do not paste credentials into chat or commit them.

Supported same-computer HTTP-loopback installations can also **Continue with ChatGPT** using the official eligible-plan preview. Open the app locally (for example `http://127.0.0.1:3000`); its callback must reach `/auth/callback` on that same loopback port. The same port must be reachable if using a local container. Remote/server visits use API keys; ChatGPT-plan sign-in is not a general remote-hosted integration. Manage usage opens ChatGPT's controls. No Codex installation or existing Codex login is used.

Generation sends the selected saved resume and stored job description to the chosen provider; OpenRouter also routes them to its model provider. Usage charges or plan limits apply, and provider retention rules still apply. No automatic retry or billing fallback occurs. Inputs are limited to 20,000 characters each. API-key requests cap output at 8,000 tokens; ChatGPT's preview instead has local received-output/time limits, not a guaranteed allowance cap. Drafts are transient until saved/downloaded; review all factual claims. Live provider/account acceptance remains an operator check—automated verification uses fixtures, never personal accounts or paid calls.

## Migrations across branches

New migrations use UTC timestamp prefixes for SQL and snapshots:

```sh
yarn db:generate --name descriptive_feature_name
yarn drizzle-kit check
```

The published `0000_resume_documents` migration remains unchanged. Timestamp names reduce filename collisions, but Drizzle still has a shared journal and linked snapshot history. Rebase onto current main before generating the final **unapplied** feature migration; regenerate pending branch artifacts against the combined schema rather than hand-merging parallel snapshots. Never rename/rewrite applied migrations. Keep divergent development branches on separate databases. See [database contract](db/SPEC.md) for preservation and rollback boundaries.

## Checks

```sh
yarn test
yarn test:db
yarn test:assistance          # fixture-only OAuth/JOSE protocol checks; included in yarn test
yarn test:collection:postgres
yarn build
KYU_BASE_URL=http://127.0.0.1:3017 yarn test:e2e
```

Builds and unit/document tests require neither `DATABASE_URL` nor a running database. Runtime storage initializes lazily through `getDb()` and still requires a configured `DATABASE_URL`. CI explicitly builds without database configuration and runs both isolated PostgreSQL gates.

The database runners create/remove only their own ephemeral loopback PostgreSQL containers and reapply migrations to verify idempotency. Collection tests additionally upgrade an editor-only database and assert that existing resume source, versions and timestamps remain unchanged. Browser tests require an app server and a separate test database; they create and modify sample resumes. Keep user-owned databases and environment files out of verification.

Local verification uses installed Node 24.14.1; the `.nvmrc` version, 26.13.1, remains unverified here. No deployment or push is performed by these checks.

Contracts: [product](GOALS.md), [architecture](ARCHITECTURE.md), [resume editor](app/resumes/SPEC.md), [catalog](jobs/SPEC.md), [collector](collector/SPEC.md), [writing assistance](assistance/SPEC.md), [database](db/SPEC.md). Private references remain ignored and are not runtime inputs.
