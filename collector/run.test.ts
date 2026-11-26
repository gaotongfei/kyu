/** @jest-environment node */
import { loadConfig } from './config';
import { ProviderHttp } from './http';
import { runCollection } from './run';
import type { CollectionStore } from './store-contract';
import type { CollectionConfig, SavedSearch } from './types';

const search: SavedSearch = {
  id: 'software',
  name: 'Software',
  enabled: true,
  titlePhrases: ['software engineer'],
  countries: ['CA'],
  locationPhrases: [],
  allowUnknownLocation: false,
  workArrangements: [],
  allowUnknownWorkArrangement: false,
};
function fixtureConfig(): CollectionConfig {
  const config = loadConfig();
  return {
    boards: [
      config.boards.find((board) => board.provider === 'ashby')!,
      config.boards.find((board) => board.provider === 'greenhouse')!,
    ].map((board) => ({ ...board, enabled: true })),
    searches: [search],
  };
}
function fixtureStore() {
  const release = jest.fn(async () => {});
  const store: jest.Mocked<CollectionStore> = {
    acquireLock: jest.fn(async () => release),
    startRun: jest.fn<
      ReturnType<CollectionStore['startRun']>,
      Parameters<CollectionStore['startRun']>
    >(async () => {}),
    saveReport: jest.fn<
      ReturnType<CollectionStore['saveReport']>,
      Parameters<CollectionStore['saveReport']>
    >(async () => {}),
    prune: jest.fn<ReturnType<CollectionStore['prune']>, Parameters<CollectionStore['prune']>>(
      async () => 0
    ),
    persistSource: jest.fn<
      ReturnType<CollectionStore['persistSource']>,
      Parameters<CollectionStore['persistSource']>
    >(async (jobs) => ({ retained: jobs.length, deactivated: 0 })),
    noteBoard: jest.fn<
      ReturnType<CollectionStore['noteBoard']>,
      Parameters<CollectionStore['noteBoard']>
    >(async () => {}),
    ledger: jest.fn<ReturnType<CollectionStore['ledger']>, Parameters<CollectionStore['ledger']>>(
      async () => ({
        used: 0,
        reserve: jest.fn(async () => 'reservation'),
        settle: jest.fn(async () => {}),
      })
    ),
    purge: jest.fn<ReturnType<CollectionStore['purge']>, Parameters<CollectionStore['purge']>>(
      async () => {}
    ),
  };
  return { store, release };
}
const ashby = {
  apiVersion: '1',
  jobs: [
    {
      id: 'job-one',
      title: 'Software Engineer',
      descriptionPlain: 'Fixture text',
      location: 'Toronto, Canada',
      address: { postalAddress: { addressCountry: 'CAN' } },
      isListed: true,
    },
  ],
};

test('retains independent successes and reports failed/unconfigured sources without leaking secrets', async () => {
  const { store, release } = fixtureStore();
  const fetcher = jest.fn(async (url) => {
    if (String(url).includes('ashbyhq')) {
      return new Response(JSON.stringify(ashby));
    }
    throw new Error('provider error with a secret');
  });
  const report = await runCollection(store, fixtureConfig(), {
    hirebaseBudget: 2,
    http: new ProviderHttp({ fetch: fetcher, sleep: async () => {} }),
  });
  expect(report.status).toBe('partial');
  expect(report.sources.map((source) => source.status)).toEqual(['success', 'failed', 'skipped']);
  expect(store.persistSource).toHaveBeenCalledTimes(1);
  expect(store.noteBoard).toHaveBeenLastCalledWith(
    expect.any(Object),
    expect.objectContaining({ verified: false, successful: false }),
    expect.any(Date)
  );
  expect(JSON.stringify(report)).not.toContain('secret');
  expect(release).toHaveBeenCalledTimes(1);
});

test('no enabled searches is an explicit failure without provider requests', async () => {
  const { store, release } = fixtureStore();
  const fetcher = jest.fn();
  const config = fixtureConfig();
  config.searches = [];
  const report = await runCollection(store, config, {
    hirebaseBudget: 2,
    http: new ProviderHttp({ fetch: fetcher }),
  });
  expect(report.status).toBe('failed');
  expect(report.sources[0].message).toContain('No enabled saved searches');
  expect(fetcher).not.toHaveBeenCalled();
  expect(store.prune).toHaveBeenCalledWith([]);
  expect(release).toHaveBeenCalled();
});

test('zero budget is intentional board-only collection, never Hirebase work', async () => {
  const { store } = fixtureStore();
  const config = fixtureConfig();
  config.boards = config.boards.slice(0, 1);
  const fetcher = jest.fn(async () => new Response(JSON.stringify(ashby)));
  const report = await runCollection(store, config, {
    hirebaseBudget: 0,
    hirebaseKey: 'never-used',
    http: new ProviderHttp({ fetch: fetcher }),
  });
  expect(report.status).toBe('success');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(store.ledger).not.toHaveBeenCalled();
});

test('verifies Hirebase Free allowance before search and persists only non-closing scope', async () => {
  const { store } = fixtureStore();
  const config = fixtureConfig();
  config.boards = [];
  const fetcher = jest.fn(async (url, init) => {
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
              used: 0,
              remaining: 500,
              overage_mode: 'block',
              overage_used: 0,
            },
          ],
        })
      );
    }
    const body = JSON.parse(init!.body as string);
    return new Response(
      JSON.stringify({
        jobs: [
          {
            _id: 'one',
            job_title: 'Software Engineer',
            company_name: 'Fixture',
            locations: [{ country: 'Canada' }],
          },
        ],
        page: body.page,
        limit: body.limit,
        total_count: 1,
        total_pages: 1,
      })
    );
  });
  const report = await runCollection(store, config, {
    hirebaseBudget: 1,
    hirebaseKey: 'server-only-key',
    http: new ProviderHttp({ fetch: fetcher }),
  });
  expect(report.status).toBe('success');
  expect(report.hirebase).toMatchObject({ returned: 1, reserved: 1, uncertain: 0 });
  expect(store.persistSource).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({ source: 'hirebase', complete: false })
  );
  expect(store.ledger.mock.calls[0][0]).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(report)).not.toContain('server-only-key');
});

test('rejects invalid budgets or overlapping collectors before side effects', async () => {
  const { store } = fixtureStore();
  await expect(runCollection(store, fixtureConfig(), { hirebaseBudget: 501 })).rejects.toThrow(
    'budget'
  );
  expect(store.acquireLock).not.toHaveBeenCalled();
  store.acquireLock.mockRejectedValue(new Error('Collector lock is busy'));
  await expect(runCollection(store, fixtureConfig(), { hirebaseBudget: 0 })).rejects.toThrow(
    'busy'
  );
  expect(store.startRun).not.toHaveBeenCalled();
});
