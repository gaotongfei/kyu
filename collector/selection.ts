import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardKey, loadConfig, parseConfig } from './config';

export function enableBoards(projectRoot: string, selected: string[] | 'all'): number {
  const config = loadConfig(projectRoot);
  const known = new Set(config.boards.map(boardKey));
  if (
    selected !== 'all' &&
    (!selected.length ||
      new Set(selected).size !== selected.length ||
      selected.some((key) => !known.has(key)))
  ) {
    throw new Error('Select distinct configured provider:slug keys, or --all');
  }
  const path = join(projectRoot, 'collector.local.json');
  const local = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { enabledBoards: string[]; searches?: unknown })
    : { enabledBoards: [] };
  const enabled = new Set(config.boards.filter((board) => board.enabled).map(boardKey));
  for (const key of selected === 'all' ? known : selected) {
    enabled.add(key);
  }
  const output = `${JSON.stringify({ ...local, enabledBoards: [...enabled].sort() }, null, 2)}\n`;
  parseConfig(
    readFileSync(join(projectRoot, 'collector', 'employers.json'), 'utf8'),
    readFileSync(join(projectRoot, 'collector', 'searches.json'), 'utf8'),
    output
  );
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, output, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return enabled.size;
}
