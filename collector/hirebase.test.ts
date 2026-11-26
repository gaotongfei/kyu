/** @jest-environment node */
import {
  alignedPageSize,
  collectHirebase,
  freeUsage,
  normalizeHirebase,
  type UsageLedger,
} from './hirebase';
import { ProviderHttp } from './http';
import { matchedSearchIds } from './matching';
import type { SavedSearch } from './types';

const job = (id = 'fixture') => ({
  _id: id,
  job_title: 'Software Engineer',
  company_name: 'Fixture Employer',
  description: '<p>Short</p>',
  description_raw: '<p>Full &amp; factual</p>',
  application_link: 'https://example.test/jobs/1',
  location_type: 'Remote',
  locations: [{ city: 'Toronto', region: 'Ontario', country: 'Canada' }],
  salary_range: { min: 100, max: 200, currency: 'CAD', period: 'year' },
  platform_job_id: 'upstream',
  job_board: 'ashby',
});
const search = (id: string): SavedSearch => ({
  id,
  name: id,
  enabled: true,
  titlePhrases: ['software engineer'],
  countries: ['CA'],
  locationPhrases: [],
  allowUnknownLocation: false,
  workArrangements: [],
  allowUnknownWorkArrangement: false,
});
const usagePayload = () => ({
  billing_source: 'stripe_v2',
  subscription_status: null,
  plan_lookup_keys: [],
  period_start: null,
  period_end: null,
  meters: [
    {
      event_name: 'm_jobs_api_calls',
      included: 500,
      used: 10,
      remaining: 490,
      overage_mode: 'block',
      overage_used: 0,
    },
  ],
});
const usage = { used: 0, remaining: 500, period: new Date().toISOString().slice(0, 7) };
function ledger(used = 0) {
  const reservations = new Map<string, number>();
  const result: UsageLedger = {
    used,
    reserve: jest.fn(async (amount) => {
      const id = String(reservations.size);
      reservations.set(id, amount);
      result.used += amount;
      return id;
    }),
    settle: jest.fn(async (id, count) => {
      if (count !== null) {
        result.used -= reservations.get(id)! - count;
      }
    }),
  };
  return result;
}
function pagedHttp(counts: Record<string, number>, remainingHeader?: string) {
  const requests: { search: string; page: number; limit: number }[] = [];
  const fetcher = jest.fn(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    const id = JSON.parse(body.job_titles[0]) as string;
    requests.push({ search: id, page: body.page, limit: body.limit });
    const total = counts[id] ?? 0;
    const offset = (body.page - 1) * body.limit;
    const jobs = Array.from(
      { length: Math.max(0, Math.min(body.limit, total - offset)) },
      (_, index) => job(`${id}-${offset + index}`)
    );
    return new Response(
      JSON.stringify({
        jobs,
        page: body.page,
        limit: body.limit,
        total_count: total,
        total_pages: Math.ceil(total / body.limit),
      }),
      { headers: remainingHeader ? { 'Hirebase-Usage-Included-Remaining': remainingHeader } : {} }
    );
  });
  return { http: new ProviderHttp({ fetch: fetcher }), requests, fetcher };
}

test('uses unmetered authenticated usage and rejects unsafe plans or unknown accounting', async () => {
  const fetcher = jest.fn().mockResolvedValue(new Response(JSON.stringify(usagePayload())));
  await expect(
    freeUsage(new ProviderHttp({ fetch: fetcher }), 'local-key', new Date('2026-11-26'))
  ).resolves.toEqual({ used: 10, remaining: 490, period: '2026-11' });
  expect(fetcher).toHaveBeenCalledWith(
    'https://api.hirebase.org/v2/billing/usage/summary',
    expect.objectContaining({ headers: { 'x-api-key': 'local-key' } })
  );
  for (const mutate of [
    (value: ReturnType<typeof usagePayload>) => {
      value.meters[0].overage_mode = 'meter';
    },
    (value: ReturnType<typeof usagePayload>) => {
      value.meters[0].included = 25000;
    },
    (value: ReturnType<typeof usagePayload>) => {
      value.billing_source = 'legacy';
    },
    (value: ReturnType<typeof usagePayload>) => {
      value.meters[0].remaining = 500;
    },
  ]) {
    const value = usagePayload();
    mutate(value);
    await expect(
      freeUsage(
        new ProviderHttp({
          fetch: jest.fn().mockResolvedValue(new Response(JSON.stringify(value))),
        }),
        'key'
      )
    ).rejects.toThrow();
  }
});

test('preserves source fields, complete descriptions, units, unknowns and reported country', () => {
  expect(normalizeHirebase(job())).toMatchObject({
    source: 'hirebase',
    sourceJobId: 'fixture',
    descriptionText: 'Full & factual',
    descriptionComplete: true,
    locations: [{ country: 'CA' }],
    compensation: [{ currency: 'CAD', period: 'yearly' }],
    upstreamSource: { provider: 'ashby', jobId: 'upstream' },
  });
  expect(
    normalizeHirebase({ _id: 'unknown', job_title: 'Engineer', company_name: 'Example' })
  ).toMatchObject({
    descriptionComplete: false,
    compensation: [],
    workArrangement: null,
    sourcePostedAt: null,
  });
  expect(() => normalizeHirebase({ ...job(), _id: '../unsafe' })).toThrow();
});

test('balances searches, counts returned records, redistributes unused shares and preserves page offsets', async () => {
  const searches = ['one', 'two', 'empty'].map((id) => ({ ...search(id), titlePhrases: [id] }));
  const fake = pagedHttp({ one: 100, two: 100, empty: 0 });
  const saved: string[] = [];
  const state = ledger();
  const result = await collectHirebase({
    ...fake,
    key: 'key',
    searches,
    budget: 11,
    usage,
    ledger: state,
    onJobs: async (jobs) => {
      saved.push(...jobs.map((value) => value.sourceJobId));
      return 0;
    },
  });
  expect(result.returned).toBe(11);
  expect(state.used).toBe(11);
  expect(saved).toHaveLength(11);
  expect(new Set(saved).size).toBe(11);
  expect(
    Math.abs(
      saved.filter((id) => id.startsWith('one')).length -
        saved.filter((id) => id.startsWith('two')).length
    )
  ).toBeLessThanOrEqual(1);
  expect(result.sources.find((source) => source.source === 'hirebase:empty')?.complete).toBe(true);
  for (const call of fake.requests) {
    expect(call.limit).toBeLessThanOrEqual(20);
  }
});

test('keeps allocations fair and offsets unique across small and full invocation caps', async () => {
  for (const budget of [1, 2, 3, 4, 5, 7, 10, 19, 20, 21, 49, 50, 101, 499, 500]) {
    const fake = pagedHttp({ one: 1000, two: 1000, three: 1000 });
    const seen: string[] = [];
    await collectHirebase({
      ...fake,
      key: 'key',
      searches: ['one', 'two', 'three'].map((id) => ({ ...search(id), titlePhrases: [id] })),
      budget,
      usage,
      ledger: ledger(),
      onJobs: async (jobs) => {
        seen.push(...jobs.map((value) => value.sourceJobId));
        return 0;
      },
    });
    const counts = ['one', 'two', 'three'].map(
      (id) => seen.filter((value) => value.startsWith(id)).length
    );
    expect(seen).toHaveLength(budget);
    expect(new Set(seen).size).toBe(budget);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  }
});

test('redistributes unevenly exhausted searches toward cumulative under-allocation', async () => {
  const fake = pagedHttp({ a: 1000, b: 1000, c: 22, d: 49 });
  const result = await collectHirebase({
    ...fake,
    key: 'key',
    searches: ['a', 'b', 'c', 'd'].map((id) => ({ ...search(id), titlePhrases: [id] })),
    budget: 200,
    usage,
    ledger: ledger(),
    onJobs: async () => 0,
  });
  const counts = result.sources.map((source) => source.fetched);
  expect(counts.slice(2)).toEqual([22, 49]);
  expect(counts[0] + counts[1]).toBe(129);
  expect(Math.abs(counts[0] - counts[1])).toBeLessThanOrEqual(1);
});

test('an unsafe billing response globally stops remaining metered searches', async () => {
  const fetcher = jest.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        jobs: [job('billed')],
        page: 1,
        limit: 1,
        total_count: 1,
        total_pages: 1,
      }),
      { headers: { 'Hirebase-Usage-Overage-Mode': 'meter' } }
    )
  );
  const state = ledger();
  const onJobs = jest.fn();
  const result = await collectHirebase({
    http: new ProviderHttp({ fetch: fetcher }),
    key: 'key',
    searches: [search('one'), search('two')],
    budget: 2,
    usage,
    ledger: state,
    onJobs,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(state.used).toBe(1);
  expect(result.returned).toBe(1);
  expect(result.sources.map((source) => source.status)).toEqual(['partial', 'partial']);
  expect(onJobs).not.toHaveBeenCalled();
});

test('preserves raw reported location text even with empty or normalized locations', () => {
  const foreign = normalizeHirebase({
    ...job('foreign'),
    location_raw: 'Berlin, Germany',
    locations: [],
  });
  expect(foreign.locations).toEqual([
    { text: 'Berlin, Germany', city: null, region: null, country: null },
  ]);
  expect(matchedSearchIds(foreign, [{ ...search('canada'), allowUnknownLocation: true }])).toEqual(
    []
  );
  expect(matchedSearchIds(foreign, [{ ...search('berlin'), locationPhrases: ['Berlin'] }])).toEqual(
    ['berlin']
  );
  const reported = normalizeHirebase({
    ...job('reported'),
    location_raw: 'Remote within Canada',
    locations: [{ country: 'Canada', address: 'Toronto, Ontario' }],
  });
  expect(reported.locations.map((entry) => entry.text)).toEqual([
    'Toronto, Ontario',
    'Remote within Canada',
  ]);
});

test('caps at provider remaining/local monthly usage and does not call with zero budget', async () => {
  for (const [budget, remaining, monthlyUsed, expected] of [
    [500, 2, 0, 2],
    [500, 500, 499, 1],
    [0, 500, 0, 0],
  ]) {
    const fake = pagedHttp({ 'software engineer': 100 });
    const result = await collectHirebase({
      ...fake,
      key: 'key',
      searches: [search('one')],
      budget,
      usage: { ...usage, remaining },
      ledger: ledger(monthlyUsed),
      onJobs: async () => 0,
    });
    expect(result.returned).toBe(expected);
    expect(fake.fetcher).toHaveBeenCalledTimes(expected ? 1 : 0);
  }
});

test('rotates tiny allocations across invocations rather than starving the final searches', async () => {
  const state = ledger(1);
  const fake = pagedHttp({ one: 100, two: 100, three: 100 });
  await collectHirebase({
    ...fake,
    key: 'key',
    searches: ['one', 'two', 'three'].map((id) => ({ ...search(id), titlePhrases: [id] })),
    budget: 1,
    usage,
    ledger: state,
    onJobs: async () => 0,
  });
  expect(fake.requests[0].search).toBe('two');
});

test('retains ambiguous reservations without replaying a timed-out search', async () => {
  const fetcher = jest.fn().mockRejectedValue(new Error('timeout secret'));
  const state = ledger();
  const result = await collectHirebase({
    http: new ProviderHttp({ fetch: fetcher }),
    key: 'key',
    searches: [search('one'), search('two')],
    budget: 6,
    usage,
    ledger: state,
    onJobs: async () => 0,
  });
  expect(result.uncertain).toBe(3);
  expect(state.used).toBe(3);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(result.sources[0].status).toBe('failed');
  expect(result.sources[1].status).toBe('partial');
});

test('releases definitely rejected requests and does not retry plan-quota errors', async () => {
  const fetcher = jest
    .fn()
    .mockResolvedValue(
      new Response('{}', { status: 429, headers: { 'X-Billing-Code': 'limit_exceeded' } })
    );
  const state = ledger();
  const result = await collectHirebase({
    http: new ProviderHttp({ fetch: fetcher }),
    key: 'key',
    searches: [search('one')],
    budget: 2,
    usage,
    ledger: state,
    onJobs: async () => 0,
  });
  expect(state.used).toBe(0);
  expect(result.returned).toBe(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('counts malformed returned records but does not persist or infer closure', async () => {
  const fetcher = jest
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ jobs: [{}], page: 1, limit: 1, total_count: 1, total_pages: 1 })
      )
    );
  const onJobs = jest.fn();
  const state = ledger();
  const result = await collectHirebase({
    http: new ProviderHttp({ fetch: fetcher }),
    key: 'key',
    searches: [search('one')],
    budget: 1,
    usage,
    ledger: state,
    onJobs,
  });
  expect(state.used).toBe(1);
  expect(result.sources[0]).toMatchObject({ status: 'partial', complete: false, fetched: 1 });
  expect(onJobs).not.toHaveBeenCalled();
});

test('stops at a UTC month boundary rather than misaccounting the reset', async () => {
  const fake = pagedHttp({ 'software engineer': 10 });
  const state = ledger();
  const result = await collectHirebase({
    ...fake,
    key: 'key',
    searches: [search('one')],
    budget: 2,
    usage,
    ledger: state,
    now: () => new Date('2099-01-01'),
    onJobs: async () => 0,
  });
  expect(fake.fetcher).not.toHaveBeenCalled();
  expect(state.used).toBe(0);
  expect(result.sources[0]).toMatchObject({
    status: 'partial',
    message: expect.stringContaining('UTC month changed'),
  });
});

test('honors usage headers and bounded pagination', async () => {
  const fake = pagedHttp({ 'software engineer': 1000 }, '0');
  const result = await collectHirebase({
    ...fake,
    key: 'key',
    searches: [search('one')],
    budget: 50,
    usage,
    ledger: ledger(),
    onJobs: async () => 0,
  });
  expect(result.returned).toBe(20);
  expect(result.providerRemaining).toBe(0);
  expect(alignedPageSize(20, 3)).toBe(2);
  const capped = await collectHirebase({
    ...pagedHttp({ 'software engineer': 1000 }),
    key: 'key',
    searches: [search('one')],
    budget: 50,
    usage,
    ledger: ledger(),
    maxPagesPerSearch: 1,
    onJobs: async () => 0,
  });
  expect(capped.sources[0].status).toBe('partial');
});
