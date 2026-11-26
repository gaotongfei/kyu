# Kyu

A self-hosted resume editor with one freely editable Markdown document per resume.

There is no authentication. Run only on a private machine/network with one trusted operator.

## Local development

Use Node.js from `.nvmrc`, Yarn 4 via Corepack, and Docker Compose.

```sh
yarn install
test -f .env || cp .env.example .env
docker compose up -d --wait
yarn db:migrate
yarn dev --hostname 127.0.0.1
```

Create `.env` only if it does not already exist. Open `/resumes`.

The initial migration expects a **fresh database**. It does not convert the former section-based schema. Use a new database for this version; do not reset an existing database or volume to run tests.

## Editing and exports

Create, select, rename and delete named resumes. Edit the entire source in one textarea; headings and fences are ordinary Markdown, not application-managed sections. Autosave is version-checked, and switching or exporting waits for pending edits. Failed saves retain local edits with explicit retry and an unsaved Markdown backup.

The live HTML preview updates locally, including unsaved edits. Markdown downloads contain the stored source; PDF rendering happens only when explicitly exporting. Both renderers share safe Markdown parsing, the Classic theme and bundled Lato fonts. The preview is continuous, not an exact paginated PDF proof. Unsupported syntax stays readable; HTML and unsafe links are not executed.

Imports are reviewed and editable before creating a new resume, never replacements for the current document:

- **Markdown:** strict UTF-8, up to 500,000 UTF-16 units, including empty documents. Unedited imports preserve whitespace, BOM and CRLF through export. Editing uses normal browser textarea behavior.
- **PDF:** up to 10 MiB and 20 pages, with selectable text. Extraction is local and produces a Markdown draft; no OCR, layout recovery or original-file retention.

## Checks

```sh
yarn test
yarn test:db
yarn build
KYU_BASE_URL=http://127.0.0.1:3017 yarn test:e2e
```

`test:db` requires Docker and creates/removes only its own ephemeral PostgreSQL container, applying the migration twice to verify safe reapplication. Browser tests require an app server and a separate test database; they create and modify sample resumes. Keep user-owned databases and environment files out of verification.
