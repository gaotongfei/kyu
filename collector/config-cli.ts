import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardKey, loadConfig, parseConfig } from './config';
import { downloadCandidates, mergeCandidates } from './directory';

async function main(): Promise<void> {
  const [command = 'validate', ...selected] = process.argv.slice(2);
  if (command === 'validate' && !selected.length) {
    const config = loadConfig();
    process.stdout.write(
      `${JSON.stringify({
        valid: true,
        candidates: config.boards.length,
        enabledBoards: config.boards.filter((board) => board.enabled).map(boardKey),
        enabledSearches: config.searches
          .filter((search) => search.enabled)
          .map((search) => search.id),
      })}\n`
    );
    return;
  }
  if (command !== 'import' || !selected.length) {
    throw new Error(
      'Usage: yarn collect:config validate | import provider:slug [provider:slug ...]'
    );
  }
  const root = process.cwd();
  const employersPath = join(root, 'collector', 'employers.json');
  const searchesJson = readFileSync(join(root, 'collector', 'searches.json'), 'utf8');
  const existing = parseConfig(readFileSync(employersPath, 'utf8'), searchesJson);
  const imported = await downloadCandidates(selected);
  const boards = mergeCandidates(existing.boards, imported);
  const output = `${JSON.stringify(boards, null, 2)}\n`;
  parseConfig(output, searchesJson);
  const temporaryPath = `${employersPath}.tmp`;
  writeFileSync(temporaryPath, output, { flag: 'wx' });
  renameSync(temporaryPath, employersPath);
  process.stdout.write(
    `${JSON.stringify({ added: boards.length - existing.boards.length, enabled: false })}\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Configuration command failed'}\n`
  );
  process.exitCode = 1;
});
