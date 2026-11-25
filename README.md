# Kyu

A private, self-hosted resume editor. Create named resumes from your own ordered Markdown sections, autosave them to PostgreSQL, review Markdown/PDF imports, and download editable Markdown or Classic Letter PDFs. Preview uses the actual generated PDF, not a separate HTML template.

**There is no authentication or document ownership yet. Use one trusted operator on a private machine/network. Do not expose this app or its upload/download endpoints as an unauthenticated public service.** Keep `.env`, database backups, and resume files private. No resumes are sent to AI services. Next automatic action/request logging is disabled because development traces otherwise serialize document arguments; do not re-enable it when working with personal resumes.

## Local development

Use the Node.js version in `.nvmrc`, Yarn 4 via Corepack, and Docker Compose. The PDF stack requires Node 24 or newer; runtime verification also passes on Node 24.14.1 with the installed Next 16/React 19 stack.

```sh
yarn install
cp .env.example .env
# Change DATABASE_URL/POSTGRES_PORT together if this port is already used.
docker compose up -d --wait
yarn db:migrate
yarn dev --hostname 127.0.0.1
```

Open `/resumes`. The selected document UUID is kept in the URL. Document content is saved only in PostgreSQL; there is no persistent browser recovery copy. If saving fails, leave the page open, retry, or use **Download unsaved Markdown backup** before reloading. A version conflict never overwrites the other tab: back up local edits, reload, then reconcile manually.

For a local production smoke run: `yarn build`, then `yarn start --hostname 127.0.0.1`. A configured `DATABASE_URL` is required. Apply committed migrations before starting a changed schema; do not use `db:push` against valued data. Back up PostgreSQL before database maintenance. Compose's named volume is persistent: do not remove it to reset tests.

## Imports and PDF limits

- `.md` files must be UTF-8. Top-level level-two headings outside code form sections; leading text stays untitled. Bodies keep their whitespace. Application IDs/theme metadata are not part of Markdown export.
- PDF import accepts selectable text only, up to **10 MiB / 20 pages**, and creates a **reviewable draft**. After review it creates a new resume with one imported-content block. It cannot recover original Markdown, layout, or reliable reading order. No OCR, inferred sections, DOCX, or external AI calls. Original PDFs are not retained. Empty-page extraction is reported rather than claimed recovered.
- Classic supports headings, paragraphs, bold/emphasis, lists, links, quotes, rules, and code. Images, tables, raw HTML, task lists, and strikethrough are shown literally with rendering notes. Source remains editable. Markdown cannot fetch external resources.
- PDFs have selectable text and natural Letter pagination. Lato's glyph coverage is not universal; review names and symbols in your PDF. If browser embedding is unavailable, use the visible Open PDF/download-preview links. See the [bundled font license](app/resumes/fonts/OFL.txt) and [library notices](licenses/) for third-party terms.
- Resume bounds: 100 sections, 500-character single-line section titles, 120-character document names, and 500,000 total Markdown UTF-16 units. These are private-instance resource bounds, not public-upload sandboxing.

## Verification

```sh
yarn test        # format, lint, types, unused code, unit tests, document/PDF runtime tests
yarn test:db     # Docker: creates/migrates/tests/removes only its NEW ephemeral PostgreSQL container
yarn build      # production build, including server-only PDF dependencies/font tracing
```

`test:db` uses random loopback ports and a temporary in-memory database mount; it does not use your `.env` database URL or remove existing databases/volumes. It verifies committed migrations, CRUD/order, and competing version writes. The storage test file refuses to run without the explicit isolated-test marker. Do not manually point it at an operator's database.

Browser tests must also run against an **isolated** instance/database because they create and delete fictional resumes. In a separate throwaway local configuration based on `.env.example`, start PostgreSQL on an unused loopback port, apply migrations, then run:

```sh
yarn playwright install chromium
yarn dev --hostname 127.0.0.1 --port 3017
# In another terminal:
yarn test:e2e
# Or KYU_BASE_URL=http://127.0.0.1:<port> yarn test:e2e
```

Browser tests cover CRUD/order/reload, flush-before-switch/export, reviewed imports, actual PDF responses, two-tab conflict preservation, fallback links, keyboard focus, 320px layout, touch targets, reduced motion, and 200% text scaling. Browser screenshots/traces stay under ignored `.thinkrail/context/verification/`. They are not a formal accessibility certification or a claim of every browser's PDF-viewer support.

Other scripts: `db:generate`, `db:migrate`, `typecheck`, `lint`, `format:test`, `format:write`, `knip`, `jest`, `storybook`, `storybook:build`, and `analyze`. Schema/migrations live in `db/`; feature code and its [module contract](app/resumes/SPEC.md) live in `app/resumes/`. Root-level `app/` and `components/` are retained.
