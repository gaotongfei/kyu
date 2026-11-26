/** @jest-environment node */
import { downloadCandidates, mergeCandidates, selectedCandidates } from './directory';

const csv =
  'ats_vendor,company_name,board_slug,last_crawled\nashby,"Example, Inc.",example,2026-07-17\ngreenhouse,Example Two,example-two,2026-07-17\nlever,Not Imported,no,2026-07-17\n';

test('imports only selected real identifiers, preserving provenance and disabled status', () => {
  const boards = selectedCandidates(csv, ['ashby:example']);
  expect(boards).toHaveLength(1);
  expect(boards[0]).toMatchObject({
    company: 'Example, Inc.',
    enabled: false,
    boardUrl: 'https://jobs.ashbyhq.com/example',
    provenance: { license: 'CC-BY-4.0', lastCrawled: '2026-07-17' },
  });
  expect(mergeCandidates(boards, boards)).toEqual(boards);
});

test.each(
  [[], ['lever:no'], ['ashby:../etc'], ['ashby:example', 'ashby:example'], ['ashby:missing']].map(
    (keys) => ({ keys })
  )
)('rejects invalid, duplicate, unsupported and absent selections: $keys', ({ keys }) =>
  expect(() => selectedCandidates(csv, keys)).toThrow()
);

test('rejects changed headers and duplicated directory identities', () => {
  expect(() => selectedCandidates('name,slug\nx,y', ['ashby:x'])).toThrow('columns');
  expect(() =>
    selectedCandidates(`${csv}ashby,Duplicate,example,2026-07-17\n`, ['ashby:example'])
  ).toThrow('duplicate');
});

test('does not accept a changed remote snapshot', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(csv));
  try {
    await expect(downloadCandidates(['ashby:example'])).rejects.toThrow('checksum');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/2816bfadd65b7bbec23701dd036bcc7496c729db/'),
      expect.objectContaining({ redirect: 'error' })
    );
  } finally {
    fetchMock.mockRestore();
  }
});
