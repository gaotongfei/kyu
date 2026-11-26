/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardKey, boardUrl } from './config';
import { downloadCandidates, mergeCandidates, selectedCandidates } from './directory';
import type { Board } from './types';

const header = 'ats_vendor,company_name,board_slug,last_crawled\n';
const csv = `${header}ashby,"Example, Inc.",example,2026-07-17\ngreenhouse,Example Two,example-two,2026-07-17\nlever,Example Three,example-three,2026-07-12\n`;
const provenance = {
  url: 'https://github.com/fyrosofttech/lastroundai-hiring-data/blob/2816bfadd65b7bbec23701dd036bcc7496c729db/ats-directory/lastroundai-ats-company-directory-2026-08.csv',
  commit: '2816bfadd65b7bbec23701dd036bcc7496c729db',
  license: 'CC BY 4.0',
};

function csvRow(...fields: string[]): string {
  return `${fields.map((field) => `"${field.replace(/"/g, '""')}"`).join(',')}\n`;
}

test('imports only selected real identifiers in selection order, preserving provenance and disabled status', () => {
  const boards = selectedCandidates(csv, ['lever:example-three', 'ashby:example']);
  expect(boards).toEqual([
    {
      provider: 'lever',
      slug: 'example-three',
      company: 'Example Three',
      enabled: false,
      boardUrl: 'https://jobs.lever.co/example-three',
      provenance: { ...provenance, lastCrawled: '2026-07-12' },
    },
    {
      provider: 'ashby',
      slug: 'example',
      company: 'Example, Inc.',
      enabled: false,
      boardUrl: 'https://jobs.ashbyhq.com/example',
      provenance: { ...provenance, lastCrawled: '2026-07-17' },
    },
  ]);
  expect(mergeCandidates(boards, boards)).toEqual(boards);
});

test('all imports compatible supported-provider rows only, with no opt-in side effects', () => {
  const withUnsupported = `${csv}smartrecruiters,,unsupported,not-a-date\nlever-eu,Excluded,eu-only,2026-07-17\n`;
  const boards = selectedCandidates(withUnsupported, 'all');
  expect(boards.map(boardKey)).toEqual([
    'ashby:example',
    'greenhouse:example-two',
    'lever:example-three',
  ]);
  expect(boards.every((board) => !board.enabled)).toBe(true);
  expect(boards[2].provenance).toEqual({ ...provenance, lastCrawled: '2026-07-12' });
  expect(() => selectedCandidates(withUnsupported, ['smartrecruiters:unsupported'])).toThrow();
  expect(() => selectedCandidates(withUnsupported, ['lever-eu:eu-only'])).toThrow();
});

test.each([
  'with.dot',
  '../etc',
  'foo/bar',
  'foo\\bar',
  '%2e%2e',
  '-leading',
  ' leading',
  'trailing ',
  '',
  'x'.repeat(81),
])('filters incompatible slug %p only for all; explicit selections still fail', (slug) => {
  const incompatible = `${csv}${csvRow('lever', 'Excluded', slug, '2026-07-17')}`;
  expect(selectedCandidates(incompatible, 'all')).toHaveLength(3);
  expect(() => selectedCandidates(incompatible, [`lever:${slug}`])).toThrow();
});

test.each(
  [
    [],
    ['smartrecruiters:no'],
    ['ashby:../etc'],
    ['ashby:example', 'ashby:example'],
    ['ashby:missing'],
  ].map((keys) => ({ keys }))
)('rejects invalid, duplicate, unsupported and absent selections: $keys', ({ keys }) =>
  expect(() => selectedCandidates(csv, keys)).toThrow()
);

test('rejects changed headers and duplicated selected directory identities, including all', () => {
  expect(() => selectedCandidates('name,slug\nx,y', ['ashby:x'])).toThrow('columns');
  const selections: Array<string[] | 'all'> = ['all', ['ashby:example']];
  for (const selection of selections) {
    expect(() =>
      selectedCandidates(`${csv}ashby,Duplicate,example,2026-07-17\n`, selection)
    ).toThrow('duplicate');
  }
  // Unselected identities are not imports, and do not interfere with explicit selection.
  expect(
    selectedCandidates(`${csv}ashby,Duplicate,example,2026-07-17\n`, ['lever:example-three'])
  ).toHaveLength(1);
});

test.each(['', 'not-a-date', '2026-02-30', '2026-13-01', '2026-07-17T00:00:00Z'])(
  'does not silently accept or filter bad historical dates %p',
  (date) => {
    const malformed = `${header}${csvRow('lever', 'Example', 'example', date)}`;
    expect(() => selectedCandidates(malformed, 'all')).toThrow('lastCrawled');
    expect(() => selectedCandidates(malformed, ['lever:example'])).toThrow('lastCrawled');
  }
);

test.each(['', '   ', 'x'.repeat(201), 'bad\u0000name', 'bad\u007fname', 'bad\nname', 'bad\r'])(
  'does not silently accept or filter bad company names %p',
  (company) => {
    const malformed = `${header}${csvRow('lever', company, 'example', '2026-07-17')}`;
    expect(() => selectedCandidates(malformed, 'all')).toThrow('company');
    expect(() => selectedCandidates(malformed, ['lever:example'])).toThrow('company');
  }
);

test.each([
  'lever,Example,example\n',
  'lever,Example,example,2026-07-17,extra\n',
  'lever,"Unterminated,example,2026-07-17\n',
  'lever,Unquoted"quote,example,2026-07-17\n',
  'lever,"Closed"extra,example,2026-07-17\n',
])('fails closed on malformed CSV rows %p', (row) => {
  expect(() => selectedCandidates(`${header}${row}`, 'all')).toThrow();
  expect(() => selectedCandidates(`${header}${row}`, ['lever:example'])).toThrow();
});

test('handles escaped quotes and CRLF without altering historical metadata', () => {
  const quoted = `${header}${csvRow('ashby', 'Example "Quoted", Inc.', 'example', '2026-07-12')}`;
  expect(selectedCandidates(quoted.replace(/\n/g, '\r\n'), 'all')[0]).toMatchObject({
    company: 'Example "Quoted", Inc.',
    provenance: { ...provenance, lastCrawled: '2026-07-12' },
  });
});

test('imports more than 5000 explicit keys or all without changing selection order', () => {
  const rows = Array.from({ length: 5001 }, (_, index) =>
    csvRow('lever', `Example ${index}`, `board-${index}`, '2026-07-12')
  );
  const keys = rows.map((_, index) => `lever:board-${index}`).reverse();
  const large = `${header}${rows.join('')}`;
  const explicit = selectedCandidates(large, keys);
  expect(explicit).toHaveLength(5001);
  expect(explicit.map(boardKey)).toEqual(keys);
  const all = selectedCandidates(large, 'all');
  expect(all.map(boardKey)).toEqual([...keys].reverse());
  expect(all.every((board) => !board.enabled)).toBe(true);
  expect(() =>
    selectedCandidates(
      large,
      Array.from({ length: 15001 }, (_, i) => `lever:b${i}`)
    )
  ).toThrow('15000');
});

test('rejects an all import exceeding 15000 compatible boards', () => {
  const rows = Array.from({ length: 15001 }, (_, index) =>
    csvRow('lever', `Example ${index}`, `board-${index}`, '2026-07-12')
  ).join('');
  expect(() => selectedCandidates(`${header}${rows}`, 'all')).toThrow('15000');
});

test('all import round-trips all 9904 bundled candidates with original names, dates and attribution', () => {
  const bundled: Board[] = JSON.parse(readFileSync(join(__dirname, 'employers.json'), 'utf8'));
  const rows = bundled
    .map((board) =>
      csvRow(board.provider, board.company, board.slug, board.provenance.lastCrawled!)
    )
    .join('');
  const directory = `${header}${rows}lever,Excluded,company.example,2026-07-17\nunknown,Excluded,otherwise-safe,2026-07-17\n`;
  const imported = selectedCandidates(directory, 'all');
  expect(imported).toHaveLength(9904);
  expect(imported.filter((board) => board.provider === 'ashby')).toHaveLength(2855);
  expect(imported.filter((board) => board.provider === 'greenhouse')).toHaveLength(4966);
  expect(imported.filter((board) => board.provider === 'lever')).toHaveLength(2083);
  expect(imported).toEqual(bundled);
  expect(imported.every((board) => !board.enabled)).toBe(true);
  expect(new Set(imported.map(boardKey)).size).toBe(imported.length);
  expect(imported.every((board) => board.boardUrl === boardUrl(board.provider, board.slug))).toBe(
    true
  );
});

test.each([{ selection: ['ashby:example'] }, { selection: 'all' as const }])(
  'does not accept a changed remote snapshot for $selection',
  async ({ selection }) => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(csv));
    try {
      await expect(downloadCandidates(selection)).rejects.toThrow('checksum');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/2816bfadd65b7bbec23701dd036bcc7496c729db/'),
        expect.objectContaining({ redirect: 'error' })
      );
    } finally {
      fetchMock.mockRestore();
    }
  }
);
