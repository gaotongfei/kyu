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
