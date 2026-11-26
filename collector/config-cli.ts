import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardKey, loadConfig, parseConfig } from './config';
import { downloadCandidates, mergeCandidates } from './directory';
import { enableBoards } from './selection';

async function main(): Promise<void> {
  const [command = 'validate', ...selected] = process.argv.slice(2);
  const usage =
    'Usage: yarn collect:config validate | import (--all | provider:slug ...) | enable (--all | provider:slug ...)';
  if (command === '--help' && !selected.length) {
    process.stdout.write(
      `${usage}\nCandidates stay disabled on import. Enable writes only the local board selection, preserving searches.\n`
    );
    return;
  }
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
  const selection = selected.length === 1 && selected[0] === '--all' ? 'all' : selected;
  if (
    !['import', 'enable'].includes(command) ||
    !selected.length ||
    (selection !== 'all' && selected.some((key) => key.startsWith('--')))
  ) {
    throw new Error(usage);
  }
  const root = process.cwd();
  if (command === 'enable') {
    const enabledBoards = enableBoards(root, selection);
    process.stdout.write(`${JSON.stringify({ enabledBoards })}\n`);
    return;
  }
  const employersPath = join(root, 'collector', 'employers.json');
  const searchesJson = readFileSync(join(root, 'collector', 'searches.json'), 'utf8');
  const existing = parseConfig(readFileSync(employersPath, 'utf8'), searchesJson);
  const imported = await downloadCandidates(selection);
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
