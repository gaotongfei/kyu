/** @jest-environment node */
import { databaseFromClient, type DatabaseClient } from '../db/core';
import { normalizeHirebase } from './hirebase';
import { PostgresCollectionStore } from './store';
import type { Board, CollectedJob, CollectionConfig, RunReport, SavedSearch } from './types';

// The client factory is never used: only Drizzle's SQL generation runs in these fixtures.
jest.mock('postgres', () => ({ __esModule: true, default: jest.fn() }));

const observedAt = new Date('2026-11-26T12:00:00Z');
const account = 'a'.repeat(64);
const period = '2026-11';
const search: SavedSearch = {
  id: 'engineer',
  name: 'Engineering',
  enabled: true,
  titlePhrases: ['engineer'],
  countries: [],
  locationPhrases: [],
  allowUnknownLocation: false,
  workArrangements: [],
  allowUnknownWorkArrangement: false,
};
const board: Board = {
  provider: 'greenhouse',
  slug: 'fixture',
  company: 'Fixture',
  enabled: true,
  boardUrl: 'https://boards.greenhouse.io/fixture',
  provenance: {
    url: 'https://example.test/attribution',
    commit: null,
    lastCrawled: null,
    license: null,
  },
};
function job(id = 'one', source = 'ashby:fixture'): CollectedJob {
  return {
    ...normalizeHirebase({ _id: id, job_title: 'Software Engineer', company_name: 'Fixture' }),
    source,
    provider:
      source === 'hirebase' ? 'hirebase' : source.startsWith('ashby:') ? 'ashby' : 'greenhouse',
  };
}
function report(id = 'run'): RunReport {
  return {
    id,
    startedAt: observedAt.toISOString(),
    finishedAt: null,
    status: 'running',
    sources: [],
    hirebase: {
      requestedBudget: 100,
      reserved: 0,
      returned: 0,
      uncertain: 0,
      providerRemaining: null,
      period,
    },
  };
}

type Query = { text: string; params: unknown[] };
/** Real Drizzle SQL generation/mapping, fixture postgres-js replies; no database or network. */
function fixture() {
  const replies: (unknown[][] | Error)[] = [];
  const queries: Query[] = [];
  const events: string[] = [];
  const unsafe = jest.fn((text: string, params: unknown[]) => {
    queries.push({ text, params });
    const reply = replies.shift() ?? [];
    // postgres-js queries are both thenable (execute) and .values() (mapped rows).
    const result = reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    return Object.assign(result, { values: () => result });
  });
  const begin = jest.fn(async (work: (client: unknown) => Promise<unknown>) => {
    events.push('begin');
    try {
      const result = await work(client);
      events.push('commit');
      return result;
    } catch (error) {
      events.push('rollback');
      throw error;
    }
  });
  const session = Object.assign(jest.fn().mockResolvedValue([]), { release: jest.fn() });
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe,
    begin,
    reserve: jest.fn().mockResolvedValue(session),
  };
  const raw = client as unknown as DatabaseClient;
  return {
    store: new PostgresCollectionStore(databaseFromClient(raw), raw),
    queries,
    replies,
    events,
    client,
    session,
  };
}
function query(f: ReturnType<typeof fixture>, pattern: RegExp): Query {
  const found = f.queries.find((entry) => pattern.test(entry.text));
  expect(found).toBeDefined();
  return found!;
}
function jsonParams(entry: Query): Record<string, unknown>[] {
  return entry.params
    .filter((value): value is string => typeof value === 'string' && value.startsWith('{'))
    .map((value) => JSON.parse(value) as Record<string, unknown>);
}
function updateClause(entry: Query): string {
  return entry.text.split('do update set ')[1];
}

// These fixtures verify generated SQL/contracts, not PostgreSQL concurrency or rollback semantics.
test('holds a dedicated session lock while independent source transactions commit, with idempotent release', async () => {
  const f = fixture();
  f.session
    .mockResolvedValueOnce([{ locked: true, pid: 123 }])
    .mockResolvedValue([{ locked: true, pid: 123 }]);
  const release = await f.store.acquireLock();
  expect(f.client.reserve).toHaveBeenCalledTimes(1);
  expect(f.client.begin).not.toHaveBeenCalled();
  expect(f.session.mock.calls[0][0].join('')).toContain('pg_try_advisory_lock');
  await f.store.purge('ashby:fixture', 'one');
  expect(f.events).toEqual(['begin', 'commit']);
  expect(f.session.release).not.toHaveBeenCalled();
  await Promise.all([release(), release()]);
  expect(f.session).toHaveBeenCalledTimes(3);
  expect(f.session.mock.calls[1][0].join('')).toContain('pg_locks');
  expect(f.session.mock.calls[2][0].join('')).toContain('pg_advisory_unlock');
  expect(f.session.mock.calls[2][1]).toBe(f.session.mock.calls[0][1]);
  expect(f.session.release).toHaveBeenCalledTimes(1);
});

test.each([
  { label: 'overlap', failure: false },
  { label: 'driver failure', failure: new Error('postgres://user:password@private-host') },
])('releases a rejected/failed acquisition: $label', async ({ failure }) => {
  const f = fixture();
  if (failure instanceof Error) {
    f.session.mockRejectedValueOnce(failure);
  } else {
    f.session.mockResolvedValueOnce([{ locked: failure }]);
  }
  await expect(f.store.acquireLock()).rejects.toThrow(
    failure === false ? 'already active' : 'could not be acquired'
  );
  expect(f.session.release).toHaveBeenCalledTimes(1);
});

test('releases a session even when unlocking fails, without leaking the driver diagnostic', async () => {
  const f = fixture();
  f.session
    .mockResolvedValueOnce([{ locked: true, pid: 123 }])
    .mockRejectedValueOnce(new Error('secret payload'));
  const release = await f.store.acquireLock();
  await expect(release()).rejects.toThrow('Collector lock could not be released');
  expect(f.session.release).toHaveBeenCalledTimes(1);
  await expect(release()).rejects.toThrow('Collector lock could not be released');
  expect(f.session.release).toHaveBeenCalledTimes(1);
});

test('recovers running reports and only pending reservations without touching persistent usage', async () => {
  const f = fixture();
  const previous = { ...report('old'), startedAt: '2026-11-25T00:00:00Z' };
  f.replies.push([], [['old', previous]], [], [], []);
  const config: CollectionConfig = { boards: [board], searches: [search] };
  await f.store.startRun(
    { ...report(), rawResponse: job() } as RunReport,
    { ...config, apiKey: 'not-stored' } as CollectionConfig
  );
  expect(f.events).toEqual(['begin', 'commit']);
  const reservations = query(f, /^update "collection_reservations"/);
  expect(reservations.params).toEqual(['uncertain', 'old', 'pending']);
  const interrupted = query(f, /^update "collection_runs"/);
  expect(jsonParams(interrupted)[0]).toMatchObject({
    id: 'old',
    status: 'interrupted',
    finishedAt: observedAt.toISOString(),
  });
  const inserted = query(f, /^insert into "collection_runs"/);
  expect(jsonParams(inserted)).toEqual([config, report()]);
  expect(f.queries.some((entry) => entry.text.includes('collection_usage'))).toBe(false);
});

test('saves report JSON and indexed status/times and bounds or replaces unsafe summaries', async () => {
  const f = fixture();
  const completed: RunReport = {
    ...report(),
    status: 'partial',
    finishedAt: '2026-11-26T12:05:00Z',
    removedOutOfScope: 2,
    boardBatch: { totalEnabled: 9904, offset: 100, limit: 100, attempted: 100, nextOffset: 200 },
    sources: [
      {
        source: 'ashby:fixture',
        provider: 'ashby',
        status: 'failed',
        complete: false,
        fetched: 0,
        retained: 0,
        deactivated: 0,
        message: 'x'.repeat(700),
      },
    ],
  };
  await f.store.saveReport(completed);
  const saved = query(f, /^update "collection_runs"/);
  expect(saved.text).toMatch(/"status" = .*"started_at" = .*"finished_at" = .*"report" = /);
  const snapshot = jsonParams(saved)[0] as unknown as RunReport;
  expect(snapshot.sources[0].message).toHaveLength(500);
  expect(snapshot.finishedAt).toBe(completed.finishedAt);
  expect(snapshot.removedOutOfScope).toBe(2);
  expect(snapshot.boardBatch).toEqual(completed.boardBatch);
  completed.sources[0].message = 'Provider returned {"description":"raw job","api_key":"key"}';
  await f.store.saveReport(completed);
  expect(JSON.stringify(jsonParams(f.queries[1]))).not.toContain('raw job');
});

test('accepts scoped Lever identities for persistence and content-free suppression', async () => {
  const f = fixture();
  await f.store.persistSource([{ ...job('one', 'lever:fixture'), provider: 'lever' }], {
    source: 'lever:fixture',
    complete: false,
    searches: [search],
    observedAt,
  });
  expect(query(f, /^insert into "collection_jobs"/).params).toContain('lever');
  await f.store.purge('lever:fixture', 'one');
  expect(query(f, /^insert into "collection_suppressions"/).params).toContain('lever:fixture');
  await expect(f.store.purge('lever:../unsafe', 'one')).rejects.toThrow('Invalid collector source');
});

test('prunes all stored jobs against enabled searches; retained rows change only match IDs', async () => {
  const f = fixture();
  f.replies.push([
    ['ashby:fixture', 'one', job()],
    ['hirebase', 'two', { ...job('two', 'hirebase'), title: 'Accountant' }],
  ]);
  expect(await f.store.prune([search, { ...search, id: 'disabled', enabled: false }])).toBe(1);
  const updated = query(f, /^update "collection_jobs"/);
  expect(updated.text).toMatch(/^update "collection_jobs" set "matched_search_ids" = /);
  expect(updated.text).not.toMatch(/active|observed|payload/);
  expect(updated.params).toEqual([JSON.stringify(['engineer']), 'ashby:fixture', 'one']);
  expect(query(f, /^delete from "collection_jobs"/).params).toEqual(['hirebase', 'two']);
});

test('upserts only matches, deletes present nonmatches, respects suppression, and uses ALL seen IDs for missing detection', async () => {
  const f = fixture();
  const nonmatch = { ...job('no-match'), title: 'Accountant' };
  f.replies.push(
    [],
    [
      ['one', job()],
      ['no-match', job('no-match')],
    ],
    [['purged']],
    [],
    [],
    [['missing']]
  );
  expect(
    await f.store.persistSource([job(), nonmatch, job('purged')], {
      source: 'ashby:fixture',
      complete: true,
      searches: [search],
      observedAt,
    })
  ).toEqual({ retained: 1, deactivated: 1 });
  const inserted = query(f, /^insert into "collection_jobs"/);
  const update = updateClause(inserted);
  expect(update).toContain('"active" =');
  expect(update).toContain('"inactive_at" =');
  expect(update).toContain('"last_observed_at" =');
  expect(update).not.toMatch(/first_observed_at|"provider" =|"source" =|"source_job_id" =/);
  expect(query(f, /^delete from "collection_jobs"/).params).toEqual(['ashby:fixture', 'no-match']);
  expect(
    f.queries.filter((entry) => /^insert into "collection_jobs"/.test(entry.text))
  ).toHaveLength(1);
  const deactivated = query(f, /^update "collection_jobs"/);
  expect(deactivated.text).toContain('not in');
  expect(deactivated.params).toEqual([
    false,
    observedAt.toISOString(),
    'ashby:fixture',
    true,
    'one',
    'no-match',
    'purged',
  ]);
  expect(deactivated.text).not.toContain('last_observed_at');
  expect(f.events).toEqual(['begin', 'commit']);
});

test('keeps prior Greenhouse pay on failed details, but retains false completeness for the UI', async () => {
  const f = fixture();
  const old = {
    ...job('one', 'greenhouse:fixture'),
    compensation: [
      { min: 100, max: 200, currency: 'USD', period: 'yearly', kind: 'salary', summary: null },
    ],
    reportedCompensation: { original: 'pay' },
  };
  f.replies.push([], [['one', old]], []);
  await f.store.persistSource(
    [
      { ...job('one', 'greenhouse:fixture'), detailsComplete: false },
      { ...job('new', 'greenhouse:fixture'), detailsComplete: false },
    ],
    { source: 'greenhouse:fixture', complete: false, searches: [search], observedAt }
  );
  const inserts = f.queries.filter((entry) => /^insert into "collection_jobs"/.test(entry.text));
  expect(jsonParams(inserts[0])[0]).toMatchObject({
    detailsComplete: false,
    compensation: old.compensation,
    reportedCompensation: old.reportedCompensation,
  });
  expect(jsonParams(inserts[1])[0]).toMatchObject({
    detailsComplete: false,
    compensation: [],
    reportedCompensation: null,
  });
});

test.each([
  ['ashby:fixture', true, 2],
  ['greenhouse:fixture', true, 2],
  ['ashby:fixture', false, 0],
  ['greenhouse:fixture', false, 0],
  ['hirebase', true, 0],
])('empty source %s complete=%s deactivates %s rows', async (source, complete, expected) => {
  const f = fixture();
  f.replies.push([], [], [], [['one'], ['two']]);
  expect(
    await f.store.persistSource([], {
      source: source as string,
      complete: complete as boolean,
      searches: [search],
      observedAt,
    })
  ).toEqual({ retained: 0, deactivated: expected });
  const updates = f.queries.filter((entry) => /^update "collection_jobs"/.test(entry.text));
  expect(updates).toHaveLength(expected ? 1 : 0);
  expect(updates.map((entry) => entry.params)).toEqual(
    expected ? [[false, observedAt.toISOString(), source, true]] : []
  );
});

test.each([
  { source: 'ashby:fixture', jobs: [job('one', 'ashby:other')] },
  { source: 'ashby:fixture', jobs: [job(), job()] },
  { source: 'ashby:fixture', jobs: [{ ...job(), provider: 'hirebase' as const }] },
  { source: 'ashby:../unsafe', jobs: [] },
  { source: 'hirebase:search', jobs: [] },
])('validates an entire source before starting any transaction: %s', async ({ source, jobs }) => {
  const f = fixture();
  await expect(
    f.store.persistSource(jobs, { source, complete: true, searches: [search], observedAt })
  ).rejects.toThrow();
  expect(f.client.begin).not.toHaveBeenCalled();
});

test.each([
  [true, true, ['verified_at', 'last_success_at']],
  [true, false, ['verified_at']],
  [false, false, []],
])(
  'board upsert advances only explicitly verified/successful timestamps: %s/%s',
  async (verified, successful, advanced) => {
    const f = fixture();
    await f.store.noteBoard(
      board,
      {
        status: successful ? 'success' : verified ? 'partial' : 'failed',
        message: null,
        verified: verified as boolean,
        successful: successful as boolean,
      },
      observedAt
    );
    const inserted = query(f, /^insert into "collection_boards"/);
    expect(inserted.params[0]).toBe('greenhouse:fixture');
    expect(jsonParams(inserted)[0]).toEqual(board);
    for (const column of ['verified_at', 'last_success_at']) {
      expect(updateClause(inserted).includes(`"${column}" =`)).toBe(
        (advanced as string[]).includes(column)
      );
    }
  }
);

test('a failed board cannot advance timestamps even if outcome flags are inconsistent', async () => {
  const f = fixture();
  await f.store.noteBoard(
    board,
    {
      status: 'failed',
      message: null,
      verified: true,
      successful: true,
    },
    observedAt
  );
  const inserted = query(f, /^insert into "collection_boards"/);
  expect(updateClause(inserted)).not.toMatch(/verified_at|last_success_at/);
});

async function initialLedger(f: ReturnType<typeof fixture>, used: number) {
  f.replies.push([], [[used]]);
  return f.store.ledger(account, period, 'run');
}

test('reserves durably before returning a UUID, then refunds known usage or conservatively settles unknown', async () => {
  const f = fixture();
  const ledger = await initialLedger(f, 490);
  expect(ledger.used).toBe(490);
  f.replies.push([[500]], []);
  const first = await ledger.reserve(10, search.id);
  expect(first).toMatch(/^[a-f0-9-]{36}$/);
  expect(ledger.used).toBe(500);
  expect(f.events).toEqual(['begin', 'commit', 'begin', 'commit']);
  const reserved = query(f, /^update "collection_usage"/);
  expect(reserved.text).toMatch(/"used" \+ \$\d+ <= 500/);
  expect(reserved.params).toEqual([10, account, period, 10]);
  const pending = query(f, /^insert into "collection_reservations"/);
  expect(pending.params).toEqual([
    first,
    'run',
    account,
    period,
    'engineer',
    10,
    null,
    'pending',
    expect.any(String),
  ]);
  expect(pending.text).not.toMatch(/payload|config|report/);
  f.replies.push([[10, 'pending']], [[493]], []);
  await ledger.settle(first, 3);
  expect(ledger.used).toBe(493);
  const settled = query(f, /^update "collection_reservations"/);
  expect(settled.params.slice(0, 2)).toEqual([3, 'settled']);
  const owned = query(f, /^select "reserved"/);
  expect(owned.text).toMatch(/for update$/);
  expect(owned.params).toEqual([first, 'run', account, period]);
  f.replies.push([[498]], []);
  const second = await ledger.reserve(5, search.id);
  f.replies.push([[5, 'pending']], [[498]], []);
  await ledger.settle(second, null);
  expect(ledger.used).toBe(498);
  const last = f.queries.at(-1)!;
  expect(last.params.slice(0, 2)).toEqual([null, 'uncertain']);
  expect(query(f, /^insert into "collection_usage"/).text).toContain('on conflict do nothing');
});

test('cap exhaustion or a reservation insert failure does not change the cached usage', async () => {
  for (const failInsert of [false, true]) {
    const f = fixture();
    const ledger = await initialLedger(f, 499);
    f.replies.push(failInsert ? [[500]] : []);
    if (failInsert) {
      f.replies.push(new Error('raw payload / secret connection'));
    }
    await expect(ledger.reserve(failInsert ? 1 : 2, search.id)).rejects.toThrow(
      failInsert ? 'could not be reserved' : 'allowance exhausted'
    );
    expect(ledger.used).toBe(499);
    expect(f.events.at(-1)).toBe('rollback');
    expect(
      f.queries.some((entry) => /^insert into "collection_reservations"/.test(entry.text))
    ).toBe(failInsert);
  }
});

test.each([
  { rows: [] },
  { rows: [[5, 'settled']] },
  { rows: [[5, 'uncertain']] },
  { rows: [[2, 'pending']] },
])('refuses missing/foreign, repeated, uncertain or excessive settlement: %s', async ({ rows }) => {
  const f = fixture();
  const ledger = await initialLedger(f, 10);
  f.replies.push(rows);
  await expect(ledger.settle('reservation', 3)).rejects.toThrow();
  expect(ledger.used).toBe(10);
  expect(f.queries.some((entry) => /^update /.test(entry.text))).toBe(false);
  expect(f.events.at(-1)).toBe('rollback');
});

test('a known zero count refunds the entire reservation', async () => {
  const f = fixture();
  const ledger = await initialLedger(f, 10);
  f.replies.push([[10, 'pending']], [[0]], []);
  await ledger.settle('reservation', 0);
  expect(ledger.used).toBe(0);
  expect(query(f, /^update "collection_usage"/).params).toEqual([10, account, period, 10]);
});

test('rejects invalid account, period, amounts, search IDs and returned counts before writes', async () => {
  const f = fixture();
  for (const [invalidAccount, invalidPeriod] of [
    ['raw-key', period],
    [account, '2026-13'],
    [account, '2026-1'],
  ]) {
    await expect(f.store.ledger(invalidAccount, invalidPeriod, 'run')).rejects.toThrow();
  }
  expect(f.queries).toHaveLength(0);
  const ledger = await initialLedger(f, 0);
  const count = f.queries.length;
  for (const amount of [0, -1, 1.5, 101, Number.NaN]) {
    await expect(ledger.reserve(amount, search.id)).rejects.toThrow();
  }
  await expect(ledger.reserve(1, '../bad')).rejects.toThrow();
  for (const returned of [-1, 0.5, Number.NaN]) {
    await expect(ledger.settle('reservation', returned)).rejects.toThrow();
  }
  expect(f.queries).toHaveLength(count);
});

test('purges only the stable source/id and upserts a content-free suppression in the same transaction', async () => {
  const f = fixture();
  await f.store.purge('hirebase', 'one');
  expect(query(f, /^delete from "collection_jobs"/).params).toEqual(['hirebase', 'one']);
  const suppression = query(f, /^insert into "collection_suppressions"/);
  expect(suppression.params.slice(0, 2)).toEqual(['hirebase', 'one']);
  expect(suppression.text).toContain('on conflict ("source","source_job_id") do update');
  expect(suppression.text).not.toMatch(/payload|title|company/);
  expect(f.queries[0].text).toContain('pg_advisory_xact_lock');
  expect(f.events).toEqual(['begin', 'commit']);
});
