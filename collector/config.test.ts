/** @jest-environment node */
/* eslint-disable no-script-url -- Malicious URLs are intentional rejection fixtures. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boardKey, boardUrl, loadConfig, parseConfig } from './config';
import type { Board, BoardProvider, SavedSearch } from './types';

const candidate: Board = {
  provider: 'ashby',
  slug: 'example',
  company: 'Example',
  boardUrl: 'https://jobs.ashbyhq.com/example',
  enabled: false,
  provenance: {
    url: 'https://example.com/directory',
    commit: '2816bfadd65b7bbec23701dd036bcc7496c729db',
    lastCrawled: '2026-07-17',
    license: 'CC BY 4.0',
  },
};
const search: SavedSearch = {
  id: 'software',
  name: 'Software',
  enabled: false,
  titlePhrases: ['software engineer'],
  countries: ['US', 'CA'],
  locationPhrases: [],
  allowUnknownLocation: false,
  workArrangements: [],
  allowUnknownWorkArrangement: false,
};

function candidates(count: number): Board[] {
  return Array.from({ length: count }, (_, index) => {
    const slug = `board-${index}`;
    return { ...candidate, slug, boardUrl: boardUrl('ashby', slug) };
  });
}

function parse(employers: unknown = [candidate], searches: unknown = [search], local?: unknown) {
  return parseConfig(
    JSON.stringify(employers),
    JSON.stringify(searches),
    local === undefined ? undefined : JSON.stringify(local)
  );
}

it('builds canonical keys and URLs from validated provider/slug only', () => {
  expect(boardKey(candidate)).toBe('ashby:example');
  expect(boardUrl('ashby', 'Board_1-safe')).toBe('https://jobs.ashbyhq.com/Board_1-safe');
  expect(boardUrl('greenhouse', 'example')).toBe('https://boards.greenhouse.io/example');
  expect(boardUrl('lever', 'Board_1-safe')).toBe('https://jobs.lever.co/Board_1-safe');
  expect(boardKey({ provider: 'lever', slug: 'example' })).toBe('lever:example');
  expect(parse().boards).toEqual([candidate]);
  const lever = { ...candidate, provider: 'lever', boardUrl: 'https://jobs.lever.co/example' };
  expect(parse([lever], [search], { enabledBoards: ['lever:example'] }).boards).toEqual([
    { ...lever, enabled: true },
  ]);
});

it.each([
  '',
  '.',
  '..',
  'with.dot',
  '../internal',
  'foo/bar',
  'foo\\bar',
  '%2e%2e',
  '%252f',
  'https://127.0.0.1',
  '//169.254.169.254',
  'foo@localhost',
  'example?url=http://localhost',
  'example#fragment',
  'example:443',
  ' example',
  'example ',
  'éxample',
  'a\n',
  'x'.repeat(81),
])('rejects unsafe board slug %p, including in public target helpers', (slug) => {
  expect(() => parse([{ ...candidate, slug }])).toThrow();
  for (const provider of ['ashby', 'greenhouse', 'lever'] as const) {
    expect(() => boardUrl(provider, slug)).toThrow();
    expect(() => boardKey({ provider, slug })).toThrow();
  }
});

it.each(['smartrecruiters', 'lever-eu', 'hirebase', 'Ashby', '', null, 7])(
  'rejects unsupported provider %p',
  (provider) => {
    expect(() => parse([{ ...candidate, provider }])).toThrow('unsupported provider');
    expect(() => boardUrl(provider as BoardProvider, 'example')).toThrow('unsupported provider');
  }
);

it.each([
  'http://jobs.ashbyhq.com/example',
  'https://jobs.ashbyhq.com/example/',
  'https://jobs.ashbyhq.com/example?redirect=https://localhost',
  'https://jobs.ashbyhq.com/example#fragment',
  'https://jobs.ashbyhq.com/%65xample',
  'https://jobs.ashbyhq.com:443/example',
  'https://JOBS.ASHBYHQ.COM/example',
  'https://jobs.ashbyhq.com.evil.test/example',
  'https://jobs.ashbyhq.com@127.0.0.1/example',
  'https://boards.greenhouse.io/example',
  'https://127.0.0.1/example',
  'http://169.254.169.254/latest/meta-data',
  'file:///etc/passwd',
  'javascript:alert(1)',
])('rejects noncanonical contributed URL %p', (url) => {
  expect(() => parse([{ ...candidate, boardUrl: url }])).toThrow('canonical');
});

it.each([
  'https://jobs.eu.lever.co/example',
  'https://api.lever.co/v0/postings/example',
  'http://jobs.lever.co/example',
  'https://jobs.lever.co/example/',
  'https://jobs.lever.co/with.dot',
  'https://jobs.lever.co/%65xample',
  'https://jobs.lever.co:443/example',
  'https://JOBS.LEVER.CO/example',
  'https://jobs.lever.co/example?mode=json',
  'https://jobs.lever.co/example#fragment',
  'https://jobs.lever.co.evil.test/example',
  'https://jobs.lever.co@127.0.0.1/example',
])('rejects noncanonical or nonglobal Lever URL %p', (url) => {
  expect(() => parse([{ ...candidate, provider: 'lever', boardUrl: url }])).toThrow('canonical');
});

it('rejects duplicate board keys and search IDs, but scopes board keys by provider', () => {
  expect(() => parse([candidate, { ...candidate, company: 'Other' }])).toThrow('duplicate');
  expect(() => parse([candidate], [search, { ...search, name: 'Other' }])).toThrow('duplicate');
  expect(
    parse([
      candidate,
      { ...candidate, provider: 'greenhouse', boardUrl: boardUrl('greenhouse', 'example') },
      { ...candidate, provider: 'lever', boardUrl: boardUrl('lever', 'example') },
    ]).boards
  ).toHaveLength(3);
});

it('rejects duplicate raw JSON keys, including escaped keys and nested metadata', () => {
  const json = JSON.stringify([candidate]);
  expect(() =>
    parseConfig(json.replace('"slug":"example"', '"slug":"bad","slug":"example"'), '[]')
  ).toThrow('duplicate JSON');
  expect(() =>
    parseConfig(json.replace('"license":"CC BY 4.0"', '"license":null,"license":"CC BY 4.0"'), '[]')
  ).toThrow('duplicate JSON');
  expect(() => parseConfig('[]', '[{"id":"one","\\u0069d":"two"}]')).toThrow('duplicate JSON');
  expect(() => parseConfig('[]', '[]', '{"enabledBoards":[],"enabledBoards":[]}')).toThrow(
    'duplicate JSON'
  );
});

it('keeps candidates disabled and enables only the exact local subset', () => {
  const other = { ...candidate, slug: 'other', boardUrl: boardUrl('ashby', 'other') };
  expect(parse([candidate, other]).boards.every((board) => !board.enabled)).toBe(true);
  const config = parse([candidate, other], [search], { enabledBoards: ['ashby:other'] });
  expect(config.boards).toEqual([candidate, { ...other, enabled: true }]);
  expect(config.searches).toEqual([search]);
  expect(parse([candidate], [search], { enabledBoards: [] }).boards[0].enabled).toBe(false);
  expect(() => parse([{ ...candidate, enabled: true }])).toThrow('candidates must be disabled');
});

it.each([
  { enabledBoards: ['ashby:missing'] },
  { enabledBoards: ['lever:example'] },
  { enabledBoards: ['ashby:example', 'ashby:example'] },
  { enabledBoards: ['ASHBY:example'] },
  { enabledBoards: ['https://jobs.ashbyhq.com/example'] },
  { enabledBoards: [null] },
  { enabledBoards: 'ashby:example' },
  { enabledBoards: null },
  { searches: [] },
  { enabledBoards: [], unknown: true },
  null,
])('rejects invalid/duplicate/unknown local selections %p', (local) => {
  expect(() => parse([candidate], [search], local)).toThrow();
});

it('fully replaces local searches and preserves every search field', () => {
  const override = {
    ...search,
    id: 'my-ai-search',
    enabled: true,
    titlePhrases: ['AI', 'machine learning'],
    countries: ['USA', 'Canada'],
    locationPhrases: ['Toronto'],
    allowUnknownLocation: true,
    workArrangements: ['remote', 'hybrid'],
    allowUnknownWorkArrangement: true,
  };
  expect(
    parse([candidate], [search], { enabledBoards: [], searches: [override] }).searches
  ).toEqual([{ ...override, countries: ['US', 'CA'] }]);
  expect(parse([candidate], [search], { enabledBoards: [], searches: [] }).searches).toEqual([]);
  expect(() => parse([candidate], [search], { enabledBoards: [], searches: null })).toThrow();
  expect(() =>
    parse([candidate], [search], { enabledBoards: [], searches: [override, override] })
  ).toThrow('duplicate');
});

it('defaults only the optional work-style group and preserves explicit unrestricted geography', () => {
  const { workArrangements, allowUnknownWorkArrangement, ...required } = search;
  expect(parse([candidate], [required]).searches).toEqual([search]);
  expect(
    parse([candidate], [{ ...search, countries: [], locationPhrases: [] }]).searches[0]
  ).toEqual({
    ...search,
    countries: [],
  });
});

it.each([
  ['usa', ' canada '],
  ['United States', 'CAN'],
  ['United States of America', 'CA'],
])('normalizes supported exact country aliases %p', (...countries) => {
  expect(parse([candidate], [{ ...search, countries }]).searches[0].countries).toEqual([
    'US',
    'CA',
  ]);
});

it.each([
  { id: '../bad' },
  { id: 'a'.repeat(81) },
  { id: null },
  { name: '' },
  { enabled: 'true' },
  { titlePhrases: [] },
  { titlePhrases: [''] },
  { titlePhrases: ['...'] },
  { titlePhrases: ['AI', 'ai'] },
  { titlePhrases: ['software-engineer', 'software engineer'] },
  { titlePhrases: ['a'.repeat(121)] },
  { titlePhrases: Array.from({ length: 31 }, (_, index) => `role ${index}`) },
  { countries: ['GB'] },
  { countries: ['US remote'] },
  { countries: ['US', 'United States'] },
  { countries: ['US', 'CA', 'USA'] },
  { countries: null },
  { locationPhrases: null },
  { locationPhrases: ['Toronto', 'toronto'] },
  { allowUnknownLocation: null },
  { workArrangements: ['remote', 'remote'] },
  { workArrangements: ['flexible'] },
  { workArrangements: null },
  { allowUnknownWorkArrangement: 'yes' },
  { extra: 'unsupported' },
])('rejects invalid search fields %p', (patch) => {
  expect(() => parse([candidate], [{ ...search, ...patch }])).toThrow();
});

it.each([
  'id',
  'name',
  'enabled',
  'titlePhrases',
  'countries',
  'locationPhrases',
  'allowUnknownLocation',
])('requires search field %s', (field) => {
  const incomplete: Record<string, unknown> = { ...search };
  delete incomplete[field];
  expect(() => parse([candidate], [incomplete])).toThrow();
});

it.each([
  { company: '' },
  { company: 'a'.repeat(201) },
  { enabled: 0 },
  { extra: true },
  { provenance: null },
  { provenance: { ...candidate.provenance, commit: 'short' } },
  { provenance: { ...candidate.provenance, lastCrawled: '2026-02-30' } },
  { provenance: { ...candidate.provenance, lastCrawled: 'July 17, 2026' } },
  { provenance: { ...candidate.provenance, license: 42 } },
  { provenance: { ...candidate.provenance, url: 'javascript:alert(1)' } },
  { provenance: { ...candidate.provenance, url: 'https://secret@example.com' } },
])('strictly validates board metadata %p', (patch) => {
  expect(() => parse([{ ...candidate, ...patch }])).toThrow();
});

it('allows nullable provenance facts, but rejects missing fields', () => {
  const provenance = {
    url: candidate.provenance.url,
    commit: null,
    lastCrawled: null,
    license: null,
  };
  expect(parse([{ ...candidate, provenance }]).boards[0].provenance).toEqual(provenance);
  for (const key of Object.keys(candidate)) {
    const incomplete: Record<string, unknown> = { ...candidate };
    delete incomplete[key];
    expect(() => parse([incomplete])).toThrow();
  }
});

it('accepts up to 15000 boards and explicit local selections without enabling candidates by default', () => {
  const employers = candidates(15000);
  const employersJson = JSON.stringify(employers);
  expect(Buffer.byteLength(employersJson)).toBeGreaterThan(1024 * 1024);
  const defaults = parseConfig(employersJson, JSON.stringify([search]));
  expect(defaults.boards).toHaveLength(15000);
  expect(defaults.boards.every((board) => !board.enabled)).toBe(true);
  const config = parseConfig(
    employersJson,
    JSON.stringify([search]),
    JSON.stringify({ enabledBoards: employers.map(boardKey) })
  );
  expect(config.boards).toHaveLength(15000);
  expect(config.boards.every((board) => board.enabled)).toBe(true);
  expect(config.searches).toEqual([search]);
  expect(() =>
    parse(employers, [search], { enabledBoards: Array(15001).fill('ashby:example') })
  ).toThrow('15000');
});

it('bounds each parsed JSON file independently', () => {
  expect(() => parseConfig(' '.repeat(8 * 1024 * 1024 + 1), '[]')).toThrow('8 MiB');
  expect(() => parseConfig('[]', ' '.repeat(1024 * 1024 + 1))).toThrow('1 MiB');
  expect(() => parseConfig('[]', '[]', ' '.repeat(1024 * 1024 + 1))).toThrow('1 MiB');
  // Bounds are UTF-8 bytes, not JavaScript string length.
  expect(() => parseConfig('[]', `"${'é'.repeat(512 * 1024)}"`)).toThrow('1 MiB');
});

it('bounds nesting, record counts and top-level shapes', () => {
  expect(() => parseConfig(`${'['.repeat(18)}0${']'.repeat(18)}`, '[]')).toThrow('nesting');
  expect(() => parse(Array(15001).fill(candidate))).toThrow('15000');
  expect(() => parse([candidate], Array(51).fill(search))).toThrow('50');
  for (const value of [null, {}, true, 'not an array']) {
    expect(() => parse(value)).toThrow();
    expect(() => parse([candidate], value)).toThrow();
  }
  expect(() => parseConfig('[', '[]')).toThrow('invalid JSON');
  expect(() => parseConfig('[]', '[{"__proto__":{}}]')).toThrow('unexpected field');
});

describe('fixture-only file loading', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kyu-config-'));
    mkdirSync(join(root, 'collector'));
    writeFileSync(join(root, 'collector', 'employers.json'), JSON.stringify([candidate]));
    writeFileSync(join(root, 'collector', 'searches.json'), JSON.stringify([search]));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads defaults and optionally the project-root local override', () => {
    expect(loadConfig(root)).toEqual(parse());
    writeFileSync(
      join(root, 'collector.local.json'),
      JSON.stringify({ enabledBoards: ['ashby:example'], searches: [{ ...search, enabled: true }] })
    );
    expect(loadConfig(root).boards[0].enabled).toBe(true);
    expect(loadConfig(root).searches[0].enabled).toBe(true);
  });

  it('fails closed on malformed/unreadable overrides and missing base files', () => {
    writeFileSync(join(root, 'collector.local.json'), '{');
    expect(() => loadConfig(root)).toThrow('invalid JSON');
    rmSync(join(root, 'collector.local.json'));
    mkdirSync(join(root, 'collector.local.json'));
    expect(() => loadConfig(root)).toThrow();
    rmSync(join(root, 'collector.local.json'), { recursive: true });
    rmSync(join(root, 'collector', 'searches.json'));
    expect(() => loadConfig(root)).toThrow();
  });

  it('loads an employer file larger than 1 MiB with more than 5000 disabled boards', () => {
    const employers = candidates(5001);
    const json = JSON.stringify(employers);
    expect(Buffer.byteLength(json)).toBeGreaterThan(1024 * 1024);
    writeFileSync(join(root, 'collector', 'employers.json'), json);
    const config = loadConfig(root);
    expect(config.boards).toHaveLength(5001);
    expect(config.boards.every((board) => !board.enabled)).toBe(true);
  });

  it.each([
    ['collector/employers.json', 8],
    ['collector/searches.json', 1],
    ['collector.local.json', 1],
  ] as const)('bounds %s before reading JSON at %i MiB', (path, limit) => {
    writeFileSync(join(root, path), ' '.repeat(limit * 1024 * 1024 + 1));
    expect(() => loadConfig(root)).toThrow(`${limit} MiB`);
  });
});

it('ships the full compatible pinned directory disabled, preserving the seven original seeds', () => {
  // Read the committed fixtures, not an operator override that might exist on the test host.
  const config = parseConfig(
    readFileSync(join(__dirname, 'employers.json'), 'utf8'),
    readFileSync(join(__dirname, 'searches.json'), 'utf8')
  );
  expect(config.boards).toHaveLength(9904);
  expect(new Set(config.boards.map(boardKey)).size).toBe(9904);
  expect(
    Object.fromEntries(
      (['ashby', 'greenhouse', 'lever'] as const).map((provider) => [
        provider,
        config.boards.filter((board) => board.provider === provider).length,
      ])
    )
  ).toEqual({ ashby: 2855, greenhouse: 4966, lever: 2083 });
  expect(
    config.boards
      .slice(0, 7)
      .map((board) => [boardKey(board), board.company, board.provenance.lastCrawled])
  ).toEqual([
    ['ashby:ashby', 'Ashby', '2026-07-12'],
    ['ashby:linear', 'Linear', '2026-07-17'],
    ['ashby:notion', 'Notion', '2026-07-17'],
    ['ashby:openai', 'OpenAI', '2026-07-17'],
    ['greenhouse:anthropic', 'Anthropic', '2026-07-17'],
    ['greenhouse:figma', 'Figma', '2026-07-17'],
    ['greenhouse:stripe', 'Stripe', '2026-07-17'],
  ]);
  const crawlDates: Record<string, number> = {};
  for (const board of config.boards) {
    const date = board.provenance.lastCrawled ?? 'missing';
    crawlDates[date] = (crawlDates[date] ?? 0) + 1;
    expect(board.enabled).toBe(false);
    expect(board.provenance).toMatchObject({
      commit: '2816bfadd65b7bbec23701dd036bcc7496c729db',
      license: 'CC BY 4.0',
      url: 'https://github.com/fyrosofttech/lastroundai-hiring-data/blob/2816bfadd65b7bbec23701dd036bcc7496c729db/ats-directory/lastroundai-ats-company-directory-2026-08.csv',
    });
  }
  expect(crawlDates).toEqual({
    '2026-07-11': 285,
    '2026-07-12': 640,
    '2026-07-17': 4999,
    '2026-08-01': 3980,
  });
  expect(config.searches.map((entry) => entry.id)).toEqual([
    'software-us-ca',
    'data-us-ca',
    'ai-us-ca',
  ]);
  expect(config.searches.every((entry) => !entry.enabled && !entry.allowUnknownLocation)).toBe(
    true
  );
  expect(config.searches.every((entry) => entry.countries.join(',') === 'US,CA')).toBe(true);
});
