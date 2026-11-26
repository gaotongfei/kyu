/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { boardKey, loadConfig } from './config';
import { enableBoards } from './selection';

const candidates = loadConfig().boards;
const small = ['ashby', 'greenhouse', 'lever'].map((provider) =>
  candidates.find((board) => board.provider === provider)!
);
const roots: string[] = [];
function fixture(boards = small): string {
  const root = mkdtempSync(join(tmpdir(), 'kyu-board-selection-'));
  roots.push(root);
  mkdirSync(join(root, 'collector'));
  writeFileSync(join(root, 'collector', 'employers.json'), JSON.stringify(boards));
  writeFileSync(join(root, 'collector', 'searches.json'), '[]');
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  jest.restoreAllMocks();
});

test('bulk enabling thousands writes only a local selection, without network or activating candidates', () => {
  const root = fixture(candidates);
  const fetcher = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network'));
  const before = readFileSync(join(root, 'collector', 'employers.json'), 'utf8');
  expect(enableBoards(root, 'all')).toBe(9904);
  const config = loadConfig(root);
  expect(config.boards.filter((board) => board.enabled)).toHaveLength(9904);
  expect(config.searches).toEqual([]);
  expect(readFileSync(join(root, 'collector', 'employers.json'), 'utf8')).toBe(before);
  expect(fetcher).not.toHaveBeenCalled();
  expect(enableBoards(root, 'all')).toBe(9904);
});

test('explicit selection adds to existing selections and preserves search overrides exactly', () => {
  const root = fixture();
  const searches = [
    {
      id: 'my-search',
      name: 'My search',
      enabled: true,
      titlePhrases: ['software engineer'],
      countries: ['US'],
      locationPhrases: [],
      allowUnknownLocation: false,
    },
  ];
  writeFileSync(
    join(root, 'collector.local.json'),
    JSON.stringify({
      enabledBoards: [boardKey(small[0])],
      searches,
    })
  );
  expect(enableBoards(root, [boardKey(small[2])])).toBe(2);
  const local = JSON.parse(readFileSync(join(root, 'collector.local.json'), 'utf8'));
  expect(local).toEqual({
    enabledBoards: [boardKey(small[0]), boardKey(small[2])].sort(),
    searches,
  });
  expect(enableBoards(root, [boardKey(small[2])])).toBe(2);
});

test.each([[], ['lever:unknown'], ['ashby:../unsafe'], [boardKey(small[0]), boardKey(small[0])]])(
  'invalid selections do not create a local override: %p',
  (...selected) => {
    const root = fixture();
    expect(() => enableBoards(root, selected)).toThrow();
    expect(existsSync(join(root, 'collector.local.json'))).toBe(false);
  }
);

test.each([
  '{bad',
  '{"enabledBoards":[],"enabledBoards":[]}',
  '{"enabledBoards":[],"unexpected":true}',
])('malformed local configuration fails closed without rewriting it', (local) => {
  const root = fixture();
  writeFileSync(join(root, 'collector.local.json'), local);
  expect(() => enableBoards(root, 'all')).toThrow();
  expect(readFileSync(join(root, 'collector.local.json'), 'utf8')).toBe(local);
});

test('configuration CLI exposes explicit bulk enable and rejects ambiguous --all combinations', () => {
  const root = fixture();
  const cli = [resolve('node_modules/tsx/dist/cli.mjs'), resolve('collector/config-cli.ts')];
  const output = execFileSync(process.execPath, [...cli, 'enable', '--all'], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(JSON.parse(output)).toEqual({ enabledBoards: 3 });
  expect(loadConfig(root).boards.every((board) => board.enabled)).toBe(true);
  const before = readFileSync(join(root, 'collector.local.json'), 'utf8');
  expect(() =>
    execFileSync(process.execPath, [...cli, 'import', '--all', 'ashby:extra'], {
      cwd: root,
      stdio: 'pipe',
    })
  ).toThrow();
  expect(readFileSync(join(root, 'collector.local.json'), 'utf8')).toBe(before);
});
