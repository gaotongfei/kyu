import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { connectDatabase } from '../db/core';
import {
  collectionBoards,
  collectionJobs,
  collectionReservations,
  collectionRuns,
  collectionSuppressions,
  collectionUsage,
  resumes,
} from '../db/schema';
import { queryCatalog } from '../jobs/catalog';
import { catalogFilters } from '../jobs/filters';
import { loadConfig } from './config';
import { normalizeHirebase } from './hirebase';
import { ProviderHttp } from './http';
import { runCollection } from './run';
import { PostgresCollectionStore } from './store';
import type { CollectedJob, CollectionConfig, RunReport, SavedSearch } from './types';

const owner = randomUUID();
const container = `kyu-collection-test-${owner}`;
const password = randomUUID();
const root = process.cwd();
let connection: ReturnType<typeof connectDatabase>;
let store: PostgresCollectionStore;
let databaseUrl: string;
let preservedResume: typeof resumes.$inferSelect;
let created = false;
const search: SavedSearch = {
  id: 'fixture',
  name: 'Fixture Canadian software roles',
  enabled: true,
  titlePhrases: ['software engineer'],
  countries: ['CA'],
  locationPhrases: [],
  allowUnknownLocation: false,
  workArrangements: [],
  allowUnknownWorkArrangement: false,
};
const config: CollectionConfig = {
  boards: loadConfig()
    .boards.filter((board) =>
      ['ashby:ashby', 'greenhouse:figma'].includes(`${board.provider}:${board.slug}`)
    )
    .map((board) => ({ ...board, enabled: true })),
  searches: [search],
};
const at = (day: number) => new Date(`2026-11-${String(day).padStart(2, '0')}T12:00:00Z`);
function report(): RunReport {
  return {
    id: randomUUID(),
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sources: [],
    hirebase: {
      requestedBudget: 0,
      reserved: 0,
      returned: 0,
      uncertain: 0,
      providerRemaining: null,
      period: new Date().toISOString().slice(0, 7),
    },
  };
}
function job(source: string, id: string, changes: Partial<CollectedJob> = {}): CollectedJob {
  const provider =
    source === 'hirebase' ? 'hirebase' : source.startsWith('ashby:') ? 'ashby' : 'greenhouse';
  return {
    ...normalizeHirebase({
      _id: id,
      job_title: 'Fixture Software Engineer',
      company_name: 'Fixture Company (test data)',
      description_raw: '<p>Fixture description, not a live listing.</p>',
      application_link: `https://example.test/apply/${id}`,
      locations: [{ city: 'Toronto', region: 'Ontario', country: 'Canada' }],
    }),
    source,
    provider,
    ...changes,
  };
}
const scope = (source: string, complete = false, day = 24) => ({
  source,
  complete,
  searches: [search],
  observedAt: at(day),
});
async function rows() {
  return connection.db
    .select()
    .from(collectionJobs)
    .orderBy(collectionJobs.source, collectionJobs.sourceJobId);
}
function docker(...args: string[]): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

before(
  async () => {
    docker(
      'run',
      '--detach',
      '--rm',
      '--pull=missing',
      '--name',
      container,
      '--label',
      `kyu.collection-test=${owner}`,
      '--tmpfs',
      '/var/lib/postgresql:rw,noexec,nosuid',
      '-e',
      'POSTGRES_DB=kyu_collection_test',
      '-e',
      'POSTGRES_USER=kyu_test',
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-p',
      '127.0.0.1::5432',
      'postgres:18-alpine'
    );
    created = true;
    for (let attempt = 0; ; attempt += 1) {
      try {
        docker(
          'exec',
          container,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'kyu_test',
          '-d',
          'kyu_collection_test'
        );
        break;
      } catch {
        if (attempt >= 59) {
          throw new Error('Owned PostgreSQL test container did not become ready');
        }
        await new Promise((done) => setTimeout(done, 200));
      }
    }
    const mapping = docker('port', container, '5432/tcp');
    assert.match(mapping, /^127\.0\.0\.1:\d+$/);
    databaseUrl = `postgresql://kyu_test:${password}@${mapping}/kyu_collection_test`;
    connection = connectDatabase(databaseUrl);
    store = new PostgresCollectionStore(connection.db, connection.client);
    const baseline = mkdtempSync(join(tmpdir(), 'kyu-editor-migration-'));
    try {
      const journal = JSON.parse(
        readFileSync(join(root, 'db/migrations/meta/_journal.json'), 'utf8')
      );
      const initial = journal.entries[0];
      assert.equal(initial.tag, '0000_resume_documents');
      mkdirSync(join(baseline, 'meta'));
      writeFileSync(
        join(baseline, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: [initial] })
      );
      writeFileSync(
        join(baseline, `${initial.tag}.sql`),
        readFileSync(join(root, 'db/migrations', `${initial.tag}.sql`))
      );
      await migrate(connection.db, { migrationsFolder: baseline });
      [preservedResume] = await connection.db
        .insert(resumes)
        .values({
          name: 'Migration preservation fixture',
          contentMarkdown: '\ufeff# Exact source\r\n\r\nKeep whitespace.  \r\n',
          version: 7,
        })
        .returning();
      await migrate(connection.db, { migrationsFolder: './db/migrations' });
    } finally {
      rmSync(baseline, { recursive: true, force: true });
    }
  },
  { timeout: 60000 }
);

after(async () => {
  await connection?.client.end({ timeout: 5 });
  if (created) {
    assert.equal(
      docker('inspect', '--format', '{{index .Config.Labels "kyu.collection-test"}}', container),
      owner
    );
    docker('stop', '--time', '5', container);
  }
});

beforeEach(async () => {
  await connection.db.delete(collectionReservations);
  await connection.db.delete(collectionRuns);
  await connection.db.delete(collectionJobs);
  await connection.db.delete(collectionBoards);
  await connection.db.delete(collectionSuppressions);
  await connection.db.delete(collectionUsage);
  store = new PostgresCollectionStore(connection.db, connection.client);
});

test('editor-only database upgrades without changing resume data and migrations are idempotent', async () => {
  await migrate(connection.db, { migrationsFolder: './db/migrations' });
  const [retained] = await connection.db
    .select()
    .from(resumes)
    .where(eq(resumes.id, preservedResume.id));
  assert.deepEqual(retained, preservedResume);
  const tables =
    await connection.client`select tablename from pg_tables where schemaname='public' and tablename like 'collection_%'`;
  assert.equal(tables.length, 6);
});

test('repeat ingestion preserves identity, first observed and separate cross-source provenance', async () => {
  await store.persistSource([job('ashby:ashby', 'same')], scope('ashby:ashby'));
  await store.persistSource(
    [job('ashby:ashby', 'same', { title: 'Fixture Senior Software Engineer' })],
    scope('ashby:ashby', false, 25)
  );
  await store.persistSource([job('greenhouse:figma', 'same')], scope('greenhouse:figma'));
  const stored = await rows();
  assert.equal(stored.length, 2);
  assert.equal(stored[0].firstObservedAt.toISOString(), at(24).toISOString());
  assert.equal(stored[0].lastObservedAt.toISOString(), at(25).toISOString());
  assert.equal(stored[0].title, 'Fixture Senior Software Engineer');
});

test('Lever preserves original and application links through catalog reads, lifecycle and purge', async () => {
  const source = 'lever:fixture';
  const posting = job(source, 'one', {
    provider: 'lever',
    jobUrl: 'https://jobs.lever.co/fixture/one',
    applicationUrl: 'https://jobs.lever.co/fixture/one/apply',
  });
  await store.persistSource([posting], scope(source, true));
  const catalog = await queryCatalog(connection.db, catalogFilters({}));
  assert.equal(catalog.jobs[0].job.jobUrl, posting.jobUrl);
  assert.equal(catalog.jobs[0].job.applicationUrl, posting.applicationUrl);
  await store.persistSource([], scope(source, false, 25));
  assert.equal((await rows())[0].active, true);
  await store.persistSource([], scope(source, true, 25));
  assert.equal((await rows())[0].active, false);
  await store.persistSource([posting], scope(source, true, 26));
  assert.equal((await rows())[0].firstObservedAt.toISOString(), at(24).toISOString());
  assert.equal((await rows())[0].active, true);
  await store.purge(source, 'one');
  await store.persistSource([posting], scope(source, true, 26));
  assert.equal((await rows()).length, 0);
});

test('only matches persist, retaining all reported locations and unknown facts', async () => {
  await store.persistSource(
    [
      job('hirebase', 'multi', {
        locations: [
          { text: 'London, UK', city: 'London', region: null, country: 'UK' },
          { text: 'Toronto, Canada', city: 'Toronto', region: 'Ontario', country: 'CA' },
        ],
      }),
      job('hirebase', 'foreign', {
        locations: [{ text: 'London, UK', city: 'London', region: null, country: 'UK' }],
      }),
      job('hirebase', 'unknown', { locations: [], workArrangement: 'remote' }),
    ],
    scope('hirebase')
  );
  const stored = await rows();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].payload.locations.length, 2);
  assert.equal(stored[0].payload.workArrangement, null);
  assert.deepEqual(stored[0].matchedSearchIds, ['fixture']);
});

test('only complete matching board scopes close absent jobs; Hirebase never closes by absence', async () => {
  for (const source of ['ashby:ashby', 'greenhouse:figma', 'hirebase']) {
    await store.persistSource([job(source, 'old')], scope(source));
  }
  assert.equal((await store.persistSource([], scope('ashby:ashby', false, 25))).deactivated, 0);
  assert.equal((await store.persistSource([], scope('ashby:ashby', true, 25))).deactivated, 1);
  assert.equal((await store.persistSource([], scope('hirebase', true, 25))).deactivated, 0);
  const stored = await rows();
  assert.equal(stored.find((row) => row.source === 'ashby:ashby')?.active, false);
  assert.equal(stored.find((row) => row.source === 'greenhouse:figma')?.active, true);
  assert.equal(stored.find((row) => row.source === 'hirebase')?.active, true);
  assert.equal(stored[0].lastObservedAt.toISOString(), at(24).toISOString());
  await store.persistSource([job('ashby:ashby', 'old')], scope('ashby:ashby', true, 26));
  const [reactivated] = await rows();
  assert.equal(reactivated.active, true);
  assert.equal(reactivated.inactiveAt, null);
  assert.equal(reactivated.firstObservedAt.toISOString(), at(24).toISOString());
});

test('search edits remove out-of-scope content without falsely closing jobs', async () => {
  await store.persistSource(
    [job('ashby:ashby', 'one'), job('ashby:ashby', 'two')],
    scope('ashby:ashby')
  );
  await store.persistSource(
    [job('ashby:ashby', 'two', { title: 'Fixture Accountant' })],
    scope('ashby:ashby')
  );
  assert.equal((await rows()).length, 1);
  const changed = { ...search, id: 'replacement' };
  assert.equal(await store.prune([changed]), 0);
  assert.deepEqual((await rows())[0].matchedSearchIds, ['replacement']);
  assert.equal(await store.prune([{ ...changed, enabled: false }]), 1);
  assert.equal((await rows()).length, 0);
});

test('purge is source-specific and suppression prevents content re-ingestion', async () => {
  await store.persistSource([job('ashby:ashby', 'one')], scope('ashby:ashby'));
  await store.persistSource([job('greenhouse:figma', 'one')], scope('greenhouse:figma'));
  await store.purge('ashby:ashby', 'one');
  await store.persistSource([job('ashby:ashby', 'one')], scope('ashby:ashby'));
  assert.equal((await rows()).length, 1);
  assert.equal((await rows())[0].source, 'greenhouse:figma');
  assert.equal((await connection.db.select().from(collectionSuppressions)).length, 1);
});

test('failed pay details preserve earlier compensation and board verification times', async () => {
  const comp = [
    { min: 100, max: 200, currency: 'CAD', period: 'yearly', kind: 'Salary', summary: null },
  ];
  await store.persistSource(
    [
      job('greenhouse:figma', 'pay', {
        compensation: comp,
        reportedCompensation: { fixture: true },
      }),
    ],
    scope('greenhouse:figma')
  );
  await store.persistSource(
    [job('greenhouse:figma', 'pay', { detailsComplete: false })],
    scope('greenhouse:figma', false, 25)
  );
  assert.deepEqual((await rows())[0].payload.compensation, comp);
  assert.equal((await rows())[0].payload.detailsComplete, false);
  const board = config.boards.find((entry) => entry.provider === 'greenhouse')!;
  await store.noteBoard(
    board,
    { status: 'success', message: null, verified: true, successful: true },
    at(24)
  );
  await store.noteBoard(
    board,
    { status: 'failed', message: 'Provider failed', verified: false, successful: false },
    at(25)
  );
  const [saved] = await connection.db.select().from(collectionBoards);
  assert.equal(saved.verifiedAt?.toISOString(), at(24).toISOString());
  assert.equal(saved.lastSuccessAt?.toISOString(), at(24).toISOString());
  assert.equal(saved.lastStatus, 'failed');
});

test('a failing source leaves earlier rows untouched while another source commits', async () => {
  await store.persistSource([job('greenhouse:figma', 'old')], scope('greenhouse:figma'));
  const http = new ProviderHttp({
    retries: 0,
    fetch: async (url) =>
      String(url).includes('ashbyhq')
        ? new Response(
            JSON.stringify({
              apiVersion: '1',
              jobs: [
                {
                  id: 'new',
                  title: 'Fixture Software Engineer',
                  location: 'Toronto, Canada',
                  isListed: true,
                  descriptionPlain: 'Fixture content',
                },
              ],
            })
          )
        : new Response('{}', { status: 503 }),
  });
  const result = await runCollection(store, config, { http, hirebaseBudget: 2 });
  assert.equal(result.status, 'partial');
  assert.deepEqual(
    result.sources.map((source) => source.status),
    ['success', 'failed', 'skipped']
  );
  assert.equal((await rows()).length, 2);
  const previous = (await rows()).find((row) => row.source === 'greenhouse:figma')!;
  assert.equal(previous.lastObservedAt.toISOString(), at(24).toISOString());
  assert.equal(previous.active, true);
  assert.equal((await connection.db.select().from(collectionRuns))[0].status, 'partial');
});

test('batched runs persist progress and do not refresh or close boards outside the batch', async () => {
  await store.persistSource([job('greenhouse:figma', 'untouched')], scope('greenhouse:figma'));
  const result = await runCollection(store, config, {
    hirebaseBudget: 0,
    boardLimit: 1,
    http: new ProviderHttp({
      fetch: async () => new Response(JSON.stringify({ apiVersion: '1', jobs: [] })),
    }),
  });
  assert.deepEqual(result.boardBatch, {
    totalEnabled: 2,
    offset: 0,
    limit: 1,
    attempted: 1,
    nextOffset: 1,
  });
  const [savedRun] = await connection.db.select().from(collectionRuns);
  assert.deepEqual(savedRun.report.boardBatch, result.boardBatch);
  const [untouched] = await rows();
  assert.equal(untouched.source, 'greenhouse:figma');
  assert.equal(untouched.active, true);
  assert.equal(untouched.lastObservedAt.toISOString(), at(24).toISOString());
  const boards = await connection.db.select().from(collectionBoards);
  assert.deepEqual(
    boards.map((board) => board.source),
    ['ashby:ashby']
  );
});

test('advisory lock rejects a separate connection and releases for the next invocation', async () => {
  const second = connectDatabase(databaseUrl);
  const other = new PostgresCollectionStore(second.db, second.client);
  const release = await store.acquireLock();
  try {
    await assert.rejects(other.acquireLock(), /already active/);
  } finally {
    await release();
  }
  const unlock = await other.acquireLock();
  await unlock();
  await second.client.end({ timeout: 5 });
});

test(
  'disconnect during a fetch fences the old run before a newer complete refresh can be overwritten',
  { timeout: 15000 },
  async () => {
    const newer = connectDatabase(databaseUrl);
    const other = new PostgresCollectionStore(newer.db, newer.client);
    const boardOnly = {
      boards: config.boards.filter((board) => board.provider === 'ashby'),
      searches: [search],
    };
    let oldRequests = 0;
    const oldHttp = new ProviderHttp({
      retries: 0,
      fetch: async () => {
        oldRequests += 1;
        const [lock] =
          await newer.client`select pid from pg_locks where locktype='advisory' and classid=0 and objid=1264145731::oid and objsubid=1 and granted`;
        assert(lock);
        await newer.client`select pg_terminate_backend(${lock.pid})`;
        const freshHttp = new ProviderHttp({
          retries: 0,
          fetch: async () =>
            new Response(
              JSON.stringify({
                apiVersion: '1',
                jobs: [
                  {
                    id: 'newer',
                    title: 'Fixture Software Engineer',
                    location: 'Toronto, Canada',
                    isListed: true,
                  },
                ],
              })
            ),
        });
        const fresh = await runCollection(other, boardOnly, { http: freshHttp, hirebaseBudget: 0 });
        assert.equal(fresh.status, 'success');
        return new Response(JSON.stringify({ apiVersion: '1', jobs: [] }));
      },
    });
    try {
      await assert.rejects(
        runCollection(store, boardOnly, { http: oldHttp, hirebaseBudget: 0 }),
        /lease was lost|fenced/
      );
      assert.equal(oldRequests, 1);
      const stored = await rows();
      assert.equal(stored.length, 1);
      assert.equal(stored[0].sourceJobId, 'newer');
      assert.equal(stored[0].active, true);
      const runs = await connection.db.select().from(collectionRuns);
      assert.deepEqual(runs.map((run) => run.status).sort(), ['interrupted', 'success']);
    } finally {
      await newer.client.end({ timeout: 5 });
    }
  }
);

test(
  'startup revalidates ownership after serialization and cannot interrupt a newer healthy run',
  { timeout: 15000 },
  async () => {
    const otherConnection = connectDatabase(databaseUrl);
    const other = new PostgresCollectionStore(otherConnection.db, otherConnection.client);
    let resume!: () => void;
    let paused!: () => void;
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const preflight = new Promise<void>((resolve) => {
      paused = resolve;
    });
    const check = store.assertLock.bind(store);
    let first = true;
    store.assertLock = async () => {
      await check();
      if (first) {
        first = false;
        paused();
        await resumed;
      }
    };
    const release = await store.acquireLock();
    let releaseOther: (() => Promise<void>) | undefined;
    const old = report();
    const starting = store.startRun(old, config);
    const rejected = assert.rejects(starting, /lease was lost/);
    try {
      await preflight;
      const [lock] =
        await otherConnection.client`select pid from pg_locks where locktype='advisory' and classid=0 and objid=1264145731::oid and objsubid=1 and granted`;
      await otherConnection.client`select pg_terminate_backend(${lock.pid})`;
      releaseOther = await other.acquireLock();
      const newer = report();
      await other.startRun(newer, config);
      resume();
      await rejected;
      const runs = await connection.db.select().from(collectionRuns);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].id, newer.id);
      assert.equal(runs[0].status, 'running');
    } finally {
      resume();
      await release();
      await releaseOther?.();
      await otherConnection.client.end({ timeout: 5 });
    }
  }
);

test('run-row fencing rejects stale mutations even if the lease preflight appears healthy', async () => {
  const release = await store.acquireLock();
  try {
    const run = report();
    await store.startRun(run, config);
    await connection.db
      .update(collectionRuns)
      .set({ status: 'interrupted' })
      .where(eq(collectionRuns.id, run.id));
    await store.assertLock();
    await assert.rejects(
      store.persistSource([job('ashby:ashby', 'stale')], scope('ashby:ashby', true)),
      /fenced/
    );
    assert.equal((await rows()).length, 0);
  } finally {
    await release();
  }
});

test('transactional reservations reconcile actual results and retain uncertain spending', async () => {
  const run = report();
  await store.startRun(run, config);
  const ledger = await store.ledger('a'.repeat(64), '2026-11', run.id);
  const first = await ledger.reserve(10, search.id);
  await ledger.settle(first, 3);
  assert.equal(ledger.used, 3);
  await assert.rejects(ledger.settle(first, 3), /not pending/);
  const uncertain = await ledger.reserve(2, search.id);
  await ledger.settle(uncertain, null);
  assert.equal(ledger.used, 5);
  assert.equal((await store.ledger('a'.repeat(64), '2026-11', run.id)).used, 5);
  const audit = await connection.db.select().from(collectionReservations);
  assert.deepEqual(audit.map((row) => row.status).sort(), ['settled', 'uncertain']);
});

test('concurrent quota reservations cannot overshoot and failed inserts roll back spending', async () => {
  const run = report();
  await store.startRun(run, config);
  const account = 'b'.repeat(64);
  const first = await store.ledger(account, '2026-11', run.id);
  for (const amount of [100, 100, 100, 100, 50]) {
    await first.reserve(amount, search.id);
  }
  const second = await store.ledger(account, '2026-11', run.id);
  const attempts = await Promise.allSettled([
    first.reserve(40, search.id),
    second.reserve(40, search.id),
  ]);
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await store.ledger(account, '2026-11', run.id)).used, 490);
  await assert.rejects(first.reserve(11, search.id), /exhausted/);
  const invalid = await store.ledger(account, '2026-11', 'missing-run');
  await assert.rejects(invalid.reserve(5, search.id), /could not be reserved/);
  assert.equal((await store.ledger(account, '2026-11', run.id)).used, 490);
});

test('interrupted runs recover pending reservations without resetting the monthly ledger', async () => {
  const old = report();
  await store.startRun(old, config);
  const ledger = await store.ledger('c'.repeat(64), '2026-11', old.id);
  await ledger.reserve(3, search.id);
  const next = report();
  await store.startRun(next, { ...config, boards: [] });
  const [previous] = await connection.db
    .select()
    .from(collectionRuns)
    .where(eq(collectionRuns.id, old.id));
  assert.equal(previous.status, 'interrupted');
  assert.equal(previous.report.status, 'interrupted');
  assert.equal((await connection.db.select().from(collectionReservations))[0].status, 'uncertain');
  assert.equal((await store.ledger('c'.repeat(64), '2026-11', next.id)).used, 3);
});

test('a source transaction rolls back every row on database failure', async () => {
  const invalid = job('ashby:ashby', 'invalid');
  Reflect.set(invalid, 'company', null);
  await assert.rejects(
    store.persistSource([job('ashby:ashby', 'valid'), invalid], scope('ashby:ashby')),
    /could not be persisted/
  );
  assert.equal((await rows()).length, 0);
});

test('read-only catalog filtering, literal wildcards, stable pagination and inactive inclusion use PostgreSQL', async () => {
  const fixtures = Array.from({ length: 30 }, (_, index) =>
    job('ashby:ashby', `job-${String(index).padStart(2, '0')}`)
  );
  fixtures.push(job('ashby:ashby', 'literal', { title: 'Fixture 100% Software Engineer' }));
  await store.persistSource(fixtures, scope('ashby:ashby'));
  const pageOne = await queryCatalog(connection.db, catalogFilters({}));
  assert.equal(pageOne.total, 31);
  assert.equal(pageOne.jobs.length, 25);
  const pageTwo = await queryCatalog(connection.db, catalogFilters({ page: '99999' }));
  assert.equal(pageTwo.page, 2);
  assert.equal(pageTwo.jobs.length, 6);
  assert.equal((await queryCatalog(connection.db, catalogFilters({ q: '100%' }))).total, 1);
  assert.equal(
    (await queryCatalog(connection.db, catalogFilters({ location: '%Canada' }))).total,
    0
  );
  await store.persistSource(fixtures.slice(0, 1), scope('ashby:ashby', true, 25));
  assert.equal((await queryCatalog(connection.db, catalogFilters({}))).total, 1);
  assert.equal((await queryCatalog(connection.db, catalogFilters({ inactive: '1' }))).total, 31);
});

test('repeat Hirebase runs charge returned duplicates, not unique persisted jobs', async () => {
  let returned = 0;
  const key = 'fixture-api-key-never-live';
  const http = new ProviderHttp({
    fetch: async (url, init) => {
      if (String(url).endsWith('/summary')) {
        return new Response(
          JSON.stringify({
            billing_source: 'stripe_v2',
            subscription_status: null,
            plan_lookup_keys: [],
            period_start: null,
            period_end: null,
            meters: [
              {
                event_name: 'm_jobs_api_calls',
                included: 500,
                used: returned,
                remaining: 500 - returned,
                overage_mode: 'block',
                overage_used: 0,
              },
            ],
          })
        );
      }
      const body = JSON.parse(init!.body as string);
      returned += 1;
      return new Response(
        JSON.stringify({
          jobs: [
            {
              _id: 'duplicate',
              job_title: 'Fixture Software Engineer',
              company_name: 'Fixture Employer',
              locations: [{ country: 'Canada' }],
            },
          ],
          page: body.page,
          limit: body.limit,
          total_count: 1,
          total_pages: 1,
        }),
        { headers: { 'Hirebase-Usage-Included-Remaining': String(500 - returned) } }
      );
    },
  });
  for (let index = 0; index < 2; index += 1) {
    const result = await runCollection(
      new PostgresCollectionStore(connection.db, connection.client),
      { boards: [], searches: [search] },
      { hirebaseBudget: 1, hirebaseKey: key, http }
    );
    assert.equal(result.status, 'success');
    assert.equal(result.hirebase.returned, 1);
  }
  assert.equal((await rows()).length, 1);
  const account = createHash('sha256').update(key).digest('hex');
  const [usage] = await connection.db
    .select()
    .from(collectionUsage)
    .where(eq(collectionUsage.account, account));
  assert.equal(usage.used, 2);
  assert(!JSON.stringify(await connection.db.select().from(collectionRuns)).includes(key));
});

test('ordinary CLI runs independently under Node and reports no-enabled-searches without live requests', () => {
  const folder = mkdtempSync(join(tmpdir(), 'kyu-collection-cli-'));
  try {
    mkdirSync(join(folder, 'collector'));
    writeFileSync(
      join(folder, 'collector', 'employers.json'),
      readFileSync(join(root, 'collector', 'employers.json'))
    );
    writeFileSync(join(folder, 'collector', 'searches.json'), '[]');
    const cli = spawnSync(
      process.execPath,
      [
        resolve(root, 'node_modules/tsx/dist/cli.mjs'),
        resolve(root, 'collector/cli.ts'),
        '--hirebase-budget',
        '0',
      ],
      {
        cwd: folder,
        env: { ...process.env, DATABASE_URL: databaseUrl, HIREBASE_API_KEY: '' },
        encoding: 'utf8',
        timeout: 30000,
      }
    );
    assert.equal(cli.status, 2, cli.stderr);
    const result = JSON.parse(cli.stdout);
    assert.equal(result.status, 'failed');
    assert.match(result.sources[0].message, /No enabled saved searches/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
