/** @jest-environment node */

import { collectBoard } from './boards';
import { boardUrl } from './config';
import { ProviderHttp, type HttpOptions } from './http';
import type { Board, BoardProvider } from './types';

const ASHBY = 'https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true';
const GREENHOUSE = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true';
const detailUrl = (id: string | number) =>
  `https://boards-api.greenhouse.io/v1/boards/acme/jobs/${id}?pay_transparency=true`;

type Data = Record<string, unknown>;
type Route = unknown | (() => unknown | Promise<unknown>);

function board(provider: BoardProvider): Board {
  return {
    provider,
    slug: 'acme',
    company: 'Acme',
    boardUrl: boardUrl(provider, 'acme'),
    enabled: true,
    provenance: {
      url: 'https://example.com/directory',
      commit: null,
      lastCrawled: null,
      license: null,
    },
  };
}

// Every request is served in memory. An unexpected URL fails rather than ever
// falling back to the real network; the real HTTP layer still handles retries.
function fixtureHttp(routes: Record<string, Route>, options: HttpOptions = {}) {
  const fetcher = jest.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (!Object.hasOwn(routes, url)) {
      throw new Error('Unexpected fixture target');
    }
    const route = routes[url];
    const data = typeof route === 'function' ? await route() : route;
    return data instanceof Response
      ? data
      : new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  });
  const http = new ProviderHttp({ retries: 0, ...options, fetch: fetcher });
  return { http, fetcher };
}

function ashby(patch: Data = {}): Data {
  return {
    id: 'ashby-1',
    title: 'Software Engineer',
    isListed: true,
    location: 'Houston, TX',
    secondaryLocations: [
      {
        location: 'San Francisco',
        address: {
          addressLocality: 'San Francisco',
          addressRegion: 'California',
          addressCountry: 'USA',
        },
      },
      {
        location: 'Toronto, Canada',
        address: {
          postalAddress: {
            addressLocality: 'Toronto',
            addressRegion: 'Ontario',
            addressCountry: 'CAN',
          },
        },
      },
    ],
    address: {
      postalAddress: { addressLocality: 'Houston', addressRegion: 'Texas', addressCountry: 'USA' },
    },
    isRemote: true,
    workplaceType: 'Hybrid',
    descriptionHtml: '<p>Build <strong>great things</strong>.</p>',
    descriptionPlain: 'Build great things.',
    publishedAt: '2026-06-01T12:00:00-04:00',
    updatedAt: '2026-06-02T16:00:00Z',
    employmentType: 'FullTime',
    jobUrl: 'https://jobs.ashbyhq.com/acme/ashby-1',
    applyUrl: 'https://jobs.ashbyhq.com/acme/ashby-1/application',
    ...patch,
  };
}

function ashbyList(jobs: unknown[] = []) {
  return { apiVersion: '1', jobs };
}

function greenhouse(patch: Data = {}): Data {
  return {
    id: 123,
    internal_job_id: 456,
    title: 'Software Engineer',
    location: { name: 'New York, NY' },
    offices: [
      { id: 1, name: 'East Coast', location: 'United States' },
      { id: 2, name: 'Toronto', location: 'Toronto, Canada' },
    ],
    metadata: null,
    content:
      'Join us. &amp;lt;p&amp;gt;Build &amp;lt;strong&amp;gt;great things&amp;lt;/strong&amp;gt;.&amp;lt;/p&amp;gt;',
    absolute_url: 'https://boards.greenhouse.io/acme/jobs/123',
    updated_at: '2026-06-02T12:00:00-04:00',
    ...patch,
  };
}

function greenhouseList(jobs: unknown[] = []) {
  return { jobs, meta: { total: jobs.length } };
}

const salary = {
  compensationType: 'Salary',
  minValue: 81000,
  maxValue: 87000,
  currencyCode: 'USD',
  interval: '1 YEAR',
  summary: '$81K – $87K',
};
const payRange = {
  min_cents: 5000000,
  max_cents: 7500000,
  currency_type: 'USD',
  title: 'NYC Salary Range',
  blurb: 'In order to provide transparency...',
};

describe('Ashby public board', () => {
  it('preserves identity, source dates, content, all locations and per-job summary compensation', async () => {
    const compensation = {
      compensationTierSummary: '$81K – $87K • 0.5% – 1.75%',
      summaryComponents: [
        salary,
        { compensationType: 'EquityPercentage', minValue: 0.5, maxValue: 1.75, interval: 'NONE' },
      ],
      compensationTiers: [{ components: [salary] }],
    };
    const raw = ashby({ compensation });
    const { http, fetcher } = fixtureHttp({ [ASHBY]: ashbyList([raw]) });
    const result = await collectBoard(board('ashby'), http);
    expect(result).toMatchObject({ complete: true, fetched: 1, message: null });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      provider: 'ashby',
      source: 'ashby:acme',
      sourceJobId: 'ashby-1',
      title: 'Software Engineer',
      company: 'Acme',
      jobUrl: raw.jobUrl,
      applicationUrl: raw.applyUrl,
      descriptionHtml: raw.descriptionHtml,
      descriptionText: 'Build great things.',
      descriptionComplete: true,
      workArrangement: 'hybrid',
      reportedWorkArrangement: 'Hybrid',
      employmentType: 'FullTime',
      sourcePostedAt: '2026-06-01T16:00:00.000Z',
      sourceUpdatedAt: '2026-06-02T16:00:00.000Z',
      upstreamSource: null,
      reportedCompensation: compensation,
      locations: [
        { text: 'Houston, TX', city: 'Houston', region: 'Texas', country: 'US' },
        { text: 'San Francisco', city: 'San Francisco', region: 'California', country: 'US' },
        { text: 'Toronto, Canada', city: 'Toronto', region: 'Ontario', country: 'CA' },
      ],
    });
    expect(result.jobs[0].compensation).toEqual([
      {
        min: 81000,
        max: 87000,
        currency: 'USD',
        period: '1 YEAR',
        kind: 'Salary',
        summary: '$81K – $87K',
      },
      {
        min: 0.5,
        max: 1.75,
        currency: null,
        period: 'NONE',
        kind: 'EquityPercentage',
        summary: compensation.compensationTierSummary,
      },
    ]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([ASHBY]);
  });

  it('supports compensation tiers without duplicating summary components or scaling Ashby amounts', async () => {
    const compensation = {
      compensationTiers: [
        { tierSummary: 'Zone A', components: [salary] },
        {
          tierSummary: 'Zone B',
          components: [
            {
              compensationType: 'Bonus',
              minValue: null,
              maxValue: null,
              currencyCode: 'CAD',
              interval: '1 YEAR',
            },
          ],
        },
      ],
      summaryComponents: [],
    };
    const { http } = fixtureHttp({ [ASHBY]: ashbyList([ashby({ compensation })]) });
    const { jobs } = await collectBoard(board('ashby'), http);
    expect(jobs[0].reportedCompensation).toEqual(compensation);
    expect(jobs[0].compensation).toEqual([
      {
        min: 81000,
        max: 87000,
        currency: 'USD',
        period: '1 YEAR',
        kind: 'Salary',
        summary: '$81K – $87K',
      },
      { min: null, max: null, currency: 'CAD', period: '1 YEAR', kind: 'Bonus', summary: 'Zone B' },
    ]);
  });

  it('retains a reported compensation summary even when no component amounts exist', async () => {
    const compensation = { compensationTierSummary: 'Offers Bonus' };
    const { http } = fixtureHttp({ [ASHBY]: ashbyList([ashby({ compensation })]) });
    expect((await collectBoard(board('ashby'), http)).jobs[0].compensation).toEqual([
      { min: null, max: null, currency: null, period: null, kind: null, summary: 'Offers Bonus' },
    ]);
  });

  it.each([
    ['Remote', 'remote'],
    ['Hybrid', 'hybrid'],
    ['OnSite', 'onsite'],
    ['Distributed', null],
    [null, null],
    [undefined, null],
  ])('uses only explicit workplaceType %p, not isRemote', async (workplaceType, expected) => {
    const { http } = fixtureHttp({
      [ASHBY]: ashbyList([ashby({ workplaceType, isRemote: true })]),
    });
    const job = (await collectBoard(board('ashby'), http)).jobs[0];
    expect(job.workArrangement).toBe(expected);
    expect(job.reportedWorkArrangement).toBe(workplaceType ?? null);
  });

  it('preserves unknowns, does not guess countries, and only recognizes explicit free-text country facts', async () => {
    const raw = {
      id: 'minimal',
      title: 'Unknown role',
      location: 'San Francisco, CA',
      isRemote: true,
      secondaryLocations: [
        { location: 'Toronto' },
        { location: 'Remote - Canada' },
        { location: 'Berlin', address: { addressCountry: 'Germany' } },
      ],
    };
    const { http } = fixtureHttp({
      [ASHBY]: ashbyList([raw, { id: 'absent', title: 'No facts' }]),
    });
    const { jobs, complete } = await collectBoard(board('ashby'), http);
    expect(complete).toBe(true);
    expect(jobs[0]).toMatchObject({
      workArrangement: null,
      reportedWorkArrangement: null,
      employmentType: null,
      descriptionHtml: null,
      descriptionText: null,
      descriptionComplete: false,
      sourcePostedAt: null,
      sourceUpdatedAt: null,
      compensation: [],
      reportedCompensation: null,
      jobUrl: null,
      applicationUrl: null,
    });
    expect(jobs[0].locations).toEqual([
      { text: 'San Francisco, CA', city: null, region: null, country: null },
      { text: 'Toronto', city: null, region: null, country: null },
      { text: 'Remote - Canada', city: null, region: null, country: 'CA' },
      { text: 'Berlin', city: null, region: null, country: 'GERMANY' },
    ]);
    expect(jobs[1].locations).toEqual([]);
  });

  it('accepts only an exact same-board job URL as a missing-ID fallback', async () => {
    const raw = ashby({ id: undefined, jobUrl: 'https://jobs.ashbyhq.com/acme/stable-123' });
    const { http } = fixtureHttp({ [ASHBY]: ashbyList([raw]) });
    expect((await collectBoard(board('ashby'), http)).jobs[0].sourceJobId).toBe('stable-123');
  });

  it.each([
    undefined,
    'https://jobs.ashbyhq.com/other/id',
    'https://jobs.ashbyhq.com/acme',
    'https://jobs.ashbyhq.com/acme/id/application',
    'https://jobs.ashbyhq.com/acme/id?x=1',
    'https://jobs.ashbyhq.com/acme/id#fragment',
    'https://jobs.ashbyhq.com/acme/%2Fid',
    'https://jobs.ashbyhq.com/acme/../id',
    'https://jobs.ashbyhq.com.evil/acme/id',
    'https://jobs.ashbyhq.com@evil.test/acme/id',
    'http://jobs.ashbyhq.com/acme/id',
    'https://evil.test/acme/id',
  ])('rejects unsafe or ambiguous missing-ID fallback %p', async (jobUrl) => {
    const { http, fetcher } = fixtureHttp({
      [ASHBY]: ashbyList([ashby({ id: undefined, jobUrl })]),
    });
    await expect(collectBoard(board('ashby'), http)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('ignores unlisted jobs while counting and checking every ID, including unlisted ones', async () => {
    const raw = [ashby(), ashby({ id: 'private', isListed: false })];
    const { http } = fixtureHttp({ [ASHBY]: ashbyList(raw) });
    expect(await collectBoard(board('ashby'), http)).toMatchObject({
      complete: true,
      fetched: 2,
      jobs: [{ sourceJobId: 'ashby-1' }],
    });
    const duplicate = fixtureHttp({ [ASHBY]: ashbyList([ashby(), ashby({ isListed: false })]) });
    await expect(collectBoard(board('ashby'), duplicate.http)).rejects.toThrow('duplicate');
    const unlisted = fixtureHttp({ [ASHBY]: ashbyList([ashby({ isListed: false })]) });
    expect(await collectBoard(board('ashby'), unlisted.http)).toEqual({
      jobs: [],
      complete: true,
      fetched: 1,
      message: null,
    });
  });

  it('decodes HTML when plain text is absent, without following reported links', async () => {
    const { http, fetcher } = fixtureHttp({
      [ASHBY]: ashbyList([
        ashby({
          descriptionPlain: undefined,
          descriptionHtml: '<p>Build &amp; learn.</p>',
          jobUrl: 'https://evil.test/job',
          // eslint-disable-next-line no-script-url -- Fixture verifies unsafe provider links are discarded.
          applyUrl: 'javascript:alert(1)',
        }),
      ]),
    });
    const { jobs } = await collectBoard(board('ashby'), http);
    expect(jobs[0]).toMatchObject({
      descriptionText: 'Build & learn.',
      jobUrl: 'https://evil.test/job',
      applicationUrl: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    [],
    {},
    { apiVersion: '1' },
    { apiVersion: '1', jobs: {} },
    { apiVersion: 1, jobs: [] },
    { apiVersion: '2', jobs: [] },
    { jobs: [] },
    { ...ashbyList(), nextCursor: null },
    { ...ashbyList(), hasMore: false },
    { ...ashbyList(), next: 'https://evil.test/next' },
    { ...ashbyList(), pagination: { total: 100 } },
    { ...ashbyList(), compensation: { summaryComponents: [salary] } },
  ])('rejects unknown, versioned or potentially truncated list envelopes %#', async (response) => {
    const { http } = fixtureHttp({ [ASHBY]: response });
    await expect(collectBoard(board('ashby'), http)).rejects.toThrow();
  });

  it.each([
    null,
    [],
    ashby({ id: '../unsafe' }),
    ashby({ id: '' }),
    ashby({ title: '' }),
    ashby({ title: 42 }),
    ashby({ isListed: 'false' }),
    ashby({ secondaryLocations: {} }),
    ashby({ address: { postalAddress: 'bad' } }),
    ashby({ compensation: { summaryComponents: [{}, null] } }),
    ashby({ compensation: { summaryComponents: [{ minValue: '80000' }] } }),
  ])('rejects malformed job shapes rather than certifying the list %#', async (raw) => {
    const { http } = fixtureHttp({ [ASHBY]: ashbyList([raw]) });
    await expect(collectBoard(board('ashby'), http)).rejects.toThrow();
  });
});

describe('Greenhouse public board', () => {
  it('uses job-post IDs, fetches structured pay, and preserves full content, office locations and dates', async () => {
    const raw = greenhouse();
    const ranges = [
      payRange,
      { min_cents: 0, max_cents: 12345, currency_code: 'CAD', title: 'Canada' },
    ];
    const { http, fetcher } = fixtureHttp({
      [GREENHOUSE]: greenhouseList([raw]),
      [detailUrl(123)]: {
        id: 123,
        company_name: 'Acme Inc.',
        first_published: '2026-05-01T12:00:00Z',
        pay_input_ranges: ranges,
      },
    });
    const { jobs, ...result } = await collectBoard(board('greenhouse'), http);
    expect(result).toEqual({ complete: true, fetched: 1, message: null });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      provider: 'greenhouse',
      source: 'greenhouse:acme',
      sourceJobId: '123',
      company: 'Acme Inc.',
      title: 'Software Engineer',
      jobUrl: raw.absolute_url,
      applicationUrl: raw.absolute_url,
      descriptionHtml: raw.content,
      descriptionText: 'Join us. Build great things.',
      descriptionComplete: true,
      workArrangement: null,
      reportedWorkArrangement: null,
      employmentType: null,
      sourcePostedAt: '2026-05-01T12:00:00.000Z',
      sourceUpdatedAt: '2026-06-02T16:00:00.000Z',
      upstreamSource: null,
      reportedCompensation: ranges,
      locations: [
        { text: 'New York, NY', city: null, region: null, country: null },
        { text: 'United States', city: null, region: null, country: 'US' },
        { text: 'Toronto, Canada', city: null, region: null, country: 'CA' },
      ],
    });
    expect(jobs[0].compensation).toEqual([
      {
        min: 50000,
        max: 75000,
        currency: 'USD',
        period: null,
        kind: 'NYC Salary Range',
        summary: 'In order to provide transparency...',
      },
      { min: 0, max: 123.45, currency: 'CAD', period: null, kind: 'Canada', summary: null },
    ]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([GREENHOUSE, detailUrl(123)]);
  });

  it('does not infer remote from location or country from city/state and preserves all absent facts', async () => {
    const { http } = fixtureHttp({
      [GREENHOUSE]: greenhouseList([
        { id: 123, title: 'Unknown', location: { name: 'Remote - San Francisco, CA' } },
      ]),
      [detailUrl(123)]: { id: 123 },
    });
    const { jobs, complete } = await collectBoard(board('greenhouse'), http);
    expect(complete).toBe(true);
    expect(jobs[0]).toMatchObject({
      jobUrl: null,
      applicationUrl: null,
      workArrangement: null,
      reportedWorkArrangement: null,
      employmentType: null,
      descriptionHtml: null,
      descriptionText: null,
      descriptionComplete: false,
      compensation: [],
      reportedCompensation: null,
      sourcePostedAt: null,
      sourceUpdatedAt: null,
      locations: [{ text: 'Remote - San Francisco, CA', city: null, region: null, country: null }],
    });
  });

  it.each([
    [{ workplace_type: 'Remote' }, 'remote', 'Remote', null],
    [{ workplaceType: 'Hybrid' }, 'hybrid', 'Hybrid', null],
    [{ work_arrangement: 'OnSite' }, 'onsite', 'OnSite', null],
    [
      { metadata: [{ name: 'Workplace Type', value_type: 'text', value: 'Remote' }] },
      'remote',
      'Remote',
      null,
    ],
    [
      {
        metadata: [{ name: 'Work Arrangement', value_type: 'single_select', value: 'Distributed' }],
      },
      null,
      'Distributed',
      null,
    ],
    [{ metadata: [{ name: 'Notes', value_type: 'text', value: 'Remote' }] }, null, null, null],
    [
      { metadata: [{ name: 'Workplace Type', value_type: 'boolean', value: true }] },
      null,
      null,
      null,
    ],
    [
      { metadata: [{ name: 'Employment Type', value_type: 'text', value: 'Contract' }] },
      null,
      null,
      'Contract',
    ],
  ])(
    'reads only explicitly named and typed work-style/employment fields %#',
    async (patch, work, reported, employment) => {
      const { http } = fixtureHttp({
        [GREENHOUSE]: greenhouseList([greenhouse(patch as Data)]),
        [detailUrl(123)]: { id: 123 },
      });
      expect((await collectBoard(board('greenhouse'), http)).jobs[0]).toMatchObject({
        workArrangement: work,
        reportedWorkArrangement: reported,
        employmentType: employment,
      });
    }
  );

  it('preserves explicitly unknown structured pay amounts and currency without guessing a period', async () => {
    const ranges = [{ min_cents: null, max_cents: null, currency_type: null, title: 'Salary' }];
    const { http } = fixtureHttp({
      [GREENHOUSE]: greenhouseList([greenhouse()]),
      [detailUrl(123)]: { id: 123, pay_input_ranges: ranges },
    });
    const result = await collectBoard(board('greenhouse'), http);
    expect(result.complete).toBe(true);
    expect(result.jobs[0].reportedCompensation).toEqual(ranges);
    expect(result.jobs[0].compensation).toEqual([
      { min: null, max: null, currency: null, period: null, kind: 'Salary', summary: null },
    ]);
  });

  it('keeps distinct post IDs even when they share an internal job ID', async () => {
    const { http } = fixtureHttp({
      [GREENHOUSE]: greenhouseList([greenhouse(), greenhouse({ id: 124 })]),
      [detailUrl(123)]: { id: 123, pay_input_ranges: [] },
      [detailUrl(124)]: { id: 124, pay_input_ranges: [] },
    });
    expect(
      (await collectBoard(board('greenhouse'), http)).jobs.map((job) => job.sourceJobId)
    ).toEqual(['123', '124']);
  });

  it.each([
    () => new Response('not found', { status: 404 }),
    () => new Response('unavailable', { status: 503 }),
    () => new Response('{broken json'),
    () => ({ id: 999, pay_input_ranges: [payRange] }),
    () => ({ internal_job_id: 123, pay_input_ranges: [payRange] }),
    () => ({ id: 123, pay_input_ranges: {} }),
    () => ({ id: 123, pay_input_ranges: [null] }),
    () => ({ id: 123, pay_input_ranges: [{}] }),
    () => ({ id: 123, pay_input_ranges: [{ min: 50000, max: 75000, currency: 'USD' }] }),
    () => ({ id: 123, pay_input_ranges: [{ ...payRange, min_cents: '5000000' }] }),
    () => ({ id: 123, pay_input_ranges: [{ ...payRange, currency_type: 123 }] }),
    () => ({ id: 123, title: null, pay_input_ranges: [payRange] }),
  ])(
    'retains list data and other successful jobs when detail fails validation %#',
    async (failedDetail) => {
      const raw = greenhouse({ content: '<p>Full list content stays.</p>' });
      const { http } = fixtureHttp({
        [GREENHOUSE]: greenhouseList([raw, greenhouse({ id: 124 })]),
        [detailUrl(123)]: failedDetail,
        [detailUrl(124)]: { id: 124, pay_input_ranges: [payRange] },
      });
      const result = await collectBoard(board('greenhouse'), http);
      expect(result).toMatchObject({
        complete: false,
        fetched: 2,
        message: 'Some Greenhouse job details could not be validated; board refresh is incomplete.',
      });
      expect(result.jobs[0]).toMatchObject({
        sourceJobId: '123',
        descriptionHtml: raw.content,
        descriptionText: 'Full list content stays.',
        compensation: [],
        reportedCompensation: null,
      });
      expect(result.jobs[1].compensation[0].min).toBe(50000);
    }
  );

  it('never surfaces arbitrary detail errors or follows a reported absolute URL', async () => {
    const { http, fetcher } = fixtureHttp({
      // eslint-disable-next-line no-script-url -- Fixture verifies unsafe provider links are discarded.
      [GREENHOUSE]: greenhouseList([greenhouse({ absolute_url: 'javascript:alert(1)' })]),
      [detailUrl(123)]: () => {
        throw new Error('secret upstream credentials at https://evil.test');
      },
    });
    const result = await collectBoard(board('greenhouse'), http);
    expect(result.complete).toBe(false);
    expect(result.message).not.toMatch(/secret|evil|credentials/);
    expect(result.jobs[0]).toMatchObject({ jobUrl: null, applicationUrl: null });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([GREENHOUSE, detailUrl(123)]);
  });

  it.each([
    null,
    [],
    {},
    { jobs: [] },
    { jobs: [], meta: null },
    { jobs: {}, meta: { total: 0 } },
    { jobs: [], meta: { total: '0' } },
    { jobs: [], meta: { total: -1 } },
    { jobs: [], meta: { total: 0.5 } },
    { jobs: [], meta: { total: 1 } },
    { jobs: [greenhouse()], meta: { total: 2 } },
    { jobs: [greenhouse()], meta: { total: 0 } },
    { ...greenhouseList(), next: null },
    { ...greenhouseList(), apiVersion: '2' },
    { jobs: [], meta: { total: 0, next_page: 2 } },
    { jobs: [], meta: { total: 0, has_more: false } },
  ])(
    'rejects unrecognized, inconsistent or potentially truncated list envelopes %#',
    async (response) => {
      const { http, fetcher } = fixtureHttp({ [GREENHOUSE]: response });
      await expect(collectBoard(board('greenhouse'), http)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    [null],
    [greenhouse(), greenhouse()],
    [greenhouse({ id: '../unsafe' })],
    [greenhouse({ id: undefined })],
    [greenhouse({ id: 1.5 })],
    [greenhouse({ title: '' })],
    [greenhouse({ location: 'Remote' })],
    [greenhouse({ content: {} })],
    [greenhouse({ offices: {} })],
  ])(
    'validates required job shapes and all post IDs before making detail requests %#',
    async (...jobs) => {
      const { http, fetcher } = fixtureHttp({ [GREENHOUSE]: greenhouseList(jobs) });
      await expect(collectBoard(board('greenhouse'), http)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it.each([undefined, 1, 4])(
    'bounds detail concurrency at two (requested %p) and preserves list ordering',
    async (concurrency) => {
      let active = 0;
      let peak = 0;
      const ids = [5, 2, 8, 1, 9];
      const routes: Record<string, Route> = {
        [GREENHOUSE]: greenhouseList(ids.map((id) => greenhouse({ id }))),
      };
      for (const id of ids) {
        routes[detailUrl(id)] = async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise<void>((resolve) => setImmediate(resolve));
          active -= 1;
          return { id, pay_input_ranges: [] };
        };
      }
      const { http } = fixtureHttp(routes);
      const result = await collectBoard(board('greenhouse'), http, { concurrency });
      expect(result.complete).toBe(true);
      expect(result.jobs.map((job) => job.sourceJobId)).toEqual(ids.map(String));
      expect(peak).toBe(concurrency === 1 ? 1 : 2);
    }
  );
});

describe('board safety and bounded collection', () => {
  it.each(['ashby', 'greenhouse'] as const)(
    'revalidates the complete %s list on every invocation, including empty boards',
    async (provider) => {
      const { http, fetcher } = fixtureHttp(
        provider === 'ashby' ? { [ASHBY]: ashbyList() } : { [GREENHOUSE]: greenhouseList() }
      );
      for (let count = 0; count < 2; count += 1) {
        expect(await collectBoard(board(provider), http)).toEqual({
          jobs: [],
          complete: true,
          fetched: 0,
          message: null,
        });
      }
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );

  it.each(['ashby', 'greenhouse'] as const)(
    'preserves the complete original %s HTML, including surrounding whitespace',
    async (provider) => {
      const content = '\n  <p>Full content.</p>  \n';
      const routes =
        provider === 'ashby'
          ? { [ASHBY]: ashbyList([ashby({ descriptionHtml: content })]) }
          : {
              [GREENHOUSE]: greenhouseList([greenhouse({ content })]),
              [detailUrl(123)]: { id: 123 },
            };
      const { http } = fixtureHttp(routes);
      expect((await collectBoard(board(provider), http)).jobs[0].descriptionHtml).toBe(content);
    }
  );

  it.each(['ashby', 'greenhouse'] as const)(
    'keeps %s identity scoped to the validated board, not returned URLs',
    async (provider) => {
      const other = { ...board(provider), slug: 'other', boardUrl: boardUrl(provider, 'other') };
      const routes =
        provider === 'ashby'
          ? {
              [ASHBY]: ashbyList([ashby({ id: '123' })]),
              'https://api.ashbyhq.com/posting-api/job-board/other?includeCompensation=true':
                ashbyList([ashby({ id: '123' })]),
            }
          : {
              [GREENHOUSE]: greenhouseList([greenhouse()]),
              [detailUrl(123)]: { id: 123 },
              'https://boards-api.greenhouse.io/v1/boards/other/jobs?content=true': greenhouseList([
                greenhouse(),
              ]),
              'https://boards-api.greenhouse.io/v1/boards/other/jobs/123?pay_transparency=true': {
                id: 123,
              },
            };
      const { http } = fixtureHttp(routes);
      const first = (await collectBoard(board(provider), http)).jobs[0];
      const second = (await collectBoard(other, http)).jobs[0];
      expect([first.source, second.source]).toEqual([`${provider}:acme`, `${provider}:other`]);
      expect([first.sourceJobId, second.sourceJobId]).toEqual(['123', '123']);
    }
  );

  it.each(['ashby', 'greenhouse'] as const)(
    'throws for a whole-list %s 404 rather than declaring closure',
    async (provider) => {
      const url = provider === 'ashby' ? ASHBY : GREENHOUSE;
      const { http } = fixtureHttp({ [url]: () => new Response('not found', { status: 404 }) });
      await expect(collectBoard(board(provider), http)).rejects.toThrow('HTTP 404');
    }
  );

  it.each([
    { provider: 'unsupported-ats' },
    { slug: '../evil' },
    { slug: 'acme/extra' },
    { slug: 'acme?redirect=evil' },
    { slug: 'acme%2fevil' },
    { slug: '' },
    { boardUrl: 'https://evil.test/acme' },
    { boardUrl: 'https://jobs.ashbyhq.com/other' },
  ])('rejects unsafe contributed board identity before any HTTP request %#', async (patch) => {
    const { http, fetcher } = fixtureHttp({});
    await expect(collectBoard({ ...board('ashby'), ...patch } as Board, http)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['ashby', 'greenhouse'] as const)(
    'limits %s processing to a prefix, counting the full list without claiming completion',
    async (provider) => {
      const routes =
        provider === 'ashby'
          ? {
              [ASHBY]: ashbyList([
                ashby(),
                ashby({ id: 'other' }),
                ashby({ id: 'private', isListed: false }),
              ]),
            }
          : {
              [GREENHOUSE]: greenhouseList([
                greenhouse(),
                greenhouse({ id: 124 }),
                greenhouse({ id: 125 }),
              ]),
              [detailUrl(123)]: { id: 123 },
            };
      const { http, fetcher } = fixtureHttp(routes);
      const result = await collectBoard(board(provider), http, { maxJobs: 1 });
      expect(result).toMatchObject({
        complete: false,
        fetched: 3,
        message: 'Board job limit reached; board refresh is incomplete.',
      });
      expect(result.jobs).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(provider === 'ashby' ? 1 : 2);
    }
  );

  it.each(['ashby', 'greenhouse'] as const)(
    'checks %s IDs even outside the processed prefix',
    async (provider) => {
      const routes =
        provider === 'ashby'
          ? { [ASHBY]: ashbyList([ashby(), ashby({ isListed: false })]) }
          : { [GREENHOUSE]: greenhouseList([greenhouse(), greenhouse()]) };
      const { http, fetcher } = fixtureHttp(routes);
      await expect(collectBoard(board(provider), http, { maxJobs: 1 })).rejects.toThrow(
        'duplicate'
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it.each([undefined, 10000])(
    'hard caps Greenhouse detail sweeps at 2000 jobs (requested %p)',
    async (maxJobs) => {
      const jobs = Array.from({ length: 2001 }, (_, id) => ({ id, title: 'Engineer' }));
      const routes: Record<string, Route> = { [GREENHOUSE]: greenhouseList(jobs) };
      for (let id = 0; id < 2000; id += 1) {
        routes[detailUrl(id)] = { id };
      }
      const { http, fetcher } = fixtureHttp(routes);
      const result = await collectBoard(board('greenhouse'), http, { maxJobs });
      expect(result).toMatchObject({ complete: false, fetched: 2001 });
      expect(result.jobs).toHaveLength(2000);
      expect(fetcher).toHaveBeenCalledTimes(2001);
    }
  );

  it.each([
    { concurrency: 0 },
    { concurrency: 5 },
    { concurrency: 1.5 },
    { concurrency: NaN },
    { maxJobs: 0 },
    { maxJobs: -1 },
    { maxJobs: 1.5 },
    { maxJobs: Infinity },
  ])('rejects invalid bounds before requesting a list %#', async (options) => {
    const { http, fetcher } = fixtureHttp({});
    await expect(collectBoard(board('greenhouse'), http, options)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses shared bounded GET retry behavior for rate-limited lists and details, with fixture-only HTTP', async () => {
    let listCalls = 0;
    let detailCalls = 0;
    const sleep = jest.fn(async () => {});
    const limited = () => new Response('limited', { status: 429, headers: { 'retry-after': '1' } });
    const { http, fetcher } = fixtureHttp(
      {
        [GREENHOUSE]: () => (++listCalls === 1 ? limited() : greenhouseList([greenhouse()])),
        [detailUrl(123)]: () =>
          ++detailCalls === 1 ? limited() : { id: 123, pay_input_ranges: [payRange] },
      },
      { retries: 2, sleep }
    );
    const result = await collectBoard(board('greenhouse'), http);
    expect(result).toMatchObject({ complete: true, fetched: 1, message: null });
    expect(result.jobs[0].compensation[0].min).toBe(50000);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      GREENHOUSE,
      GREENHOUSE,
      detailUrl(123),
      detailUrl(123),
    ]);
    expect(sleep.mock.calls).toEqual([[1000], [1000]]);
  });
});
