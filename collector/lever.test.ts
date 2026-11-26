/** @jest-environment node */

import { collectBoard } from './boards';
import { boardUrl } from './config';
import { ProviderHttp, type HttpOptions } from './http';
import type { Board } from './types';

type Data = Record<string, unknown>;
type Route = unknown | (() => unknown | Promise<unknown>);
const pageUrl = (skip = 0, limit = 100, slug = 'acme') =>
  `https://api.lever.co/v0/postings/${slug}?mode=json&skip=${skip}&limit=${limit}`;

function board(slug = 'acme'): Board {
  return {
    provider: 'lever',
    slug,
    company: 'Acme',
    boardUrl: boardUrl('lever', slug),
    enabled: true,
    provenance: {
      url: 'https://example.com/directory',
      commit: null,
      lastCrawled: null,
      license: null,
    },
  };
}

// Every request is fixture-backed, including retries. Unexpected URLs never
// fall through to the network, and reported job/application links are not read.
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
  return { http: new ProviderHttp({ retries: 0, ...options, fetch: fetcher }), fetcher };
}

function posting(patch: Data = {}): Data {
  return {
    id: 'lever-1',
    text: 'Software Engineer',
    categories: {
      location: 'Berlin',
      allLocations: ['Berlin', 'Paris', 'Toronto, Canada', 'San Francisco, CA'],
      commitment: 'Full-time',
      team: 'Engineering',
    },
    country: 'DE',
    workplaceType: 'hybrid',
    opening: '<p>Welcome.</p>',
    openingPlain: 'Welcome.',
    description: '<p>Welcome.</p><p>Build &amp; learn.</p>',
    descriptionPlain: 'Welcome. Build & learn.',
    descriptionBody: '<p>Build &amp; learn.</p>',
    descriptionBodyPlain: 'Build & learn.',
    lists: [
      { text: 'Requirements', content: '<li>Write code.</li><li>Review code.</li>' },
      { text: 'Benefits', content: '<li>Take time off.</li>' },
    ],
    additional: '<p>Everyone is welcome.</p>',
    additionalPlain: 'Everyone is welcome.',
    salaryRange: { currency: 'EUR', interval: 'per-year-salary', min: 81000, max: 97000 },
    salaryDescription: '<p>Plus equity &amp; benefits.</p>',
    salaryDescriptionPlain: 'Plus equity & benefits.',
    hostedUrl: 'https://jobs.lever.co/acme/lever-1',
    applyUrl: 'https://jobs.lever.co/acme/lever-1/apply',
    ...patch,
  };
}

function postings(start: number, length: number): Data[] {
  return Array.from({ length }, (_, index) => ({
    id: `job-${start + index}`,
    text: 'Software Engineer',
  }));
}

describe('Lever public posting facts', () => {
  it('preserves original vs application links, every description section, locations and reported pay', async () => {
    const raw = posting();
    const { http, fetcher } = fixtureHttp({ [pageUrl()]: [raw] });
    const result = await collectBoard(board(), http);
    expect(result).toMatchObject({ complete: true, fetched: 1, message: null });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toEqual({
      provider: 'lever',
      source: 'lever:acme',
      sourceJobId: 'lever-1',
      title: 'Software Engineer',
      company: 'Acme',
      jobUrl: 'https://jobs.lever.co/acme/lever-1',
      applicationUrl: 'https://jobs.lever.co/acme/lever-1/apply',
      descriptionHtml: [
        raw.description,
        '<li>Write code.</li><li>Review code.</li>',
        '<li>Take time off.</li>',
        raw.additional,
        raw.salaryDescription,
      ].join('\n'),
      descriptionText: [
        'Welcome. Build & learn.',
        'Requirements',
        'Write code.\nReview code.',
        'Benefits',
        'Take time off.',
        'Everyone is welcome.',
        'Plus equity & benefits.',
      ].join('\n\n'),
      descriptionComplete: true,
      locations: [
        { text: 'Berlin', city: null, region: null, country: 'DE' },
        { text: 'Paris', city: null, region: null, country: null },
        { text: 'Toronto, Canada', city: null, region: null, country: 'CA' },
        { text: 'San Francisco, CA', city: null, region: null, country: null },
      ],
      workArrangement: 'hybrid',
      reportedWorkArrangement: 'hybrid',
      employmentType: 'Full-time',
      compensation: [
        {
          min: 81000,
          max: 97000,
          currency: 'EUR',
          period: 'per-year-salary',
          kind: null,
          summary: 'Plus equity & benefits.',
        },
      ],
      reportedCompensation: raw.salaryRange,
      sourcePostedAt: null,
      sourceUpdatedAt: null,
      upstreamSource: null,
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([pageUrl()]);
  });

  it('reconstructs opening/body when combined content is absent and decodes each HTML-only section', async () => {
    const raw = posting({
      description: undefined,
      descriptionPlain: undefined,
      openingPlain: undefined,
      descriptionBodyPlain: undefined,
      additionalPlain: undefined,
      salaryDescriptionPlain: undefined,
    });
    const { http } = fixtureHttp({ [pageUrl()]: [raw] });
    const job = (await collectBoard(board(), http)).jobs[0];
    expect(job.descriptionHtml).toBe(
      [
        raw.opening,
        raw.descriptionBody,
        '<li>Write code.</li><li>Review code.</li>',
        '<li>Take time off.</li>',
        raw.additional,
        raw.salaryDescription,
      ].join('\n')
    );
    expect(job.descriptionText).toBe(
      [
        'Welcome.',
        'Build & learn.',
        'Requirements',
        'Write code.\nReview code.',
        'Benefits',
        'Take time off.',
        'Everyone is welcome.',
        'Plus equity & benefits.',
      ].join('\n\n')
    );
    expect(job.descriptionComplete).toBe(true);
    expect(job.compensation[0].summary).toBe('Plus equity & benefits.');
  });

  it('preserves source HTML verbatim without interpolating untrusted list headings into it', async () => {
    const html = '\n  <p>Original.</p><script>notForDisplay()</script>  \n';
    const heading = '<img src=x onerror=alert(1)>Requirements';
    const content = '  <li>Source list.</li>\n';
    const { http } = fixtureHttp({
      [pageUrl()]: [
        { id: 'raw', text: 'Role', description: html, lists: [{ text: heading, content }] },
      ],
    });
    const job = (await collectBoard(board(), http)).jobs[0];
    expect(job.descriptionHtml).toBe(`${html}\n${content}`);
    expect(job.descriptionHtml).not.toContain(heading);
    expect(job.descriptionText).toBe(`Original.\n\n${heading}\n\nSource list.`);
  });

  it('keeps plain-only content and unknown facts unknown, without invented careers links or dates', async () => {
    const { http } = fixtureHttp({
      [pageUrl()]: [
        { id: 'minimal', text: 'No reported facts' },
        {
          id: 'plain',
          text: 'Plain role',
          descriptionPlain: 'Main content.',
          additionalPlain: 'Closing content.',
          salaryDescriptionPlain: 'Pay depends on experience.',
          // Undocumented generic date-like fields are not posting/update facts.
          createdAt: 1700000000000,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    const { jobs } = await collectBoard(board(), http);
    expect(jobs[0]).toMatchObject({
      jobUrl: null,
      applicationUrl: null,
      descriptionHtml: null,
      descriptionText: null,
      descriptionComplete: false,
      locations: [],
      workArrangement: null,
      reportedWorkArrangement: null,
      employmentType: null,
      compensation: [],
      reportedCompensation: null,
      sourcePostedAt: null,
      sourceUpdatedAt: null,
    });
    expect(jobs[1]).toMatchObject({
      descriptionHtml: null,
      descriptionText: 'Main content.\n\nClosing content.\n\nPay depends on experience.',
      descriptionComplete: true,
      sourcePostedAt: null,
      sourceUpdatedAt: null,
      compensation: [
        {
          min: null,
          max: null,
          currency: null,
          period: null,
          kind: null,
          summary: 'Pay depends on experience.',
        },
      ],
    });
  });

  it('preserves zero-valued salary amounts and leaves unreported interval/currency unknown', async () => {
    const range = { min: 0, max: 100 };
    const { http } = fixtureHttp({
      [pageUrl()]: [{ id: 'pay', text: 'Role', salaryRange: range }],
    });
    expect((await collectBoard(board(), http)).jobs[0]).toMatchObject({
      compensation: [{ min: 0, max: 100, currency: null, period: null, kind: null, summary: null }],
      reportedCompensation: range,
    });
  });

  it('keeps country-only primary facts separate from allLocations and never guesses from cities', async () => {
    const { http } = fixtureHttp({
      [pageUrl()]: [
        { id: 'country', text: 'Role', country: 'NA', categories: { allLocations: ['Paris'] } },
        {
          id: 'unknown',
          text: 'Role',
          country: null,
          categories: {
            location: 'San Francisco, CA',
            allLocations: ['Toronto', 'Remote - Canada'],
          },
        },
      ],
    });
    const { jobs } = await collectBoard(board(), http);
    expect(jobs[0].locations).toEqual([
      { text: null, city: null, region: null, country: 'NA' },
      { text: 'Paris', city: null, region: null, country: null },
    ]);
    expect(jobs[1].locations).toEqual([
      { text: 'San Francisco, CA', city: null, region: null, country: null },
      { text: 'Toronto', city: null, region: null, country: null },
      { text: 'Remote - Canada', city: null, region: null, country: 'CA' },
    ]);
  });

  it.each([
    ['remote', 'remote'],
    ['hybrid', 'hybrid'],
    ['on-site', 'onsite'],
    ['unspecified', null],
    ['Distributed', null],
    [null, null],
    [undefined, null],
  ])(
    'uses explicit workplaceType %p without inventing geographic eligibility',
    async (workplaceType, expected) => {
      const { http } = fixtureHttp({
        [pageUrl()]: [{ id: 'workplace', text: 'Role', workplaceType }],
      });
      const job = (await collectBoard(board(), http)).jobs[0];
      expect(job.workArrangement).toBe(expected);
      expect(job.reportedWorkArrangement).toBe(workplaceType ?? null);
      expect(job.locations).toEqual([]);
    }
  );

  it.each([
    undefined,
    null,
    '',
    'not a URL',
    ['java', 'script:alert(1)'].join(''),
    'data:text/html,unsafe',
    'https://user:secret@jobs.lever.co/acme/id',
    '//jobs.lever.co/acme/id',
  ])(
    'discards unsafe/missing links independently, without an invented fallback %p',
    async (unsafe) => {
      const { http, fetcher } = fixtureHttp({
        [pageUrl()]: [
          {
            id: 'original',
            text: 'Role',
            hostedUrl: unsafe,
            applyUrl: 'https://example.com/apply',
          },
          {
            id: 'application',
            text: 'Role',
            hostedUrl: 'https://example.com/job',
            applyUrl: unsafe,
          },
        ],
      });
      const { jobs } = await collectBoard(board(), http);
      expect(jobs[0]).toMatchObject({ jobUrl: null, applicationUrl: 'https://example.com/apply' });
      expect(jobs[1]).toMatchObject({ jobUrl: 'https://example.com/job', applicationUrl: null });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );
});

describe('Lever pagination and complete-refresh boundary', () => {
  it('revalidates empty boards on every invocation', async () => {
    const { http, fetcher } = fixtureHttp({ [pageUrl()]: [] });
    for (let count = 0; count < 2; count += 1) {
      expect(await collectBoard(board(), http)).toEqual({
        jobs: [],
        complete: true,
        fetched: 0,
        message: null,
      });
    }
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([pageUrl(), pageUrl()]);
  });

  it.each([0, 2])('follows a full page with a terminal page of %i postings', async (lastLength) => {
    const { http, fetcher } = fixtureHttp({
      [pageUrl()]: postings(0, 100),
      [pageUrl(100)]: postings(100, lastLength),
    });
    const result = await collectBoard(board(), http);
    expect(result).toMatchObject({ complete: true, fetched: 100 + lastLength, message: null });
    expect(result.jobs.map((job) => job.sourceJobId)).toEqual(
      postings(0, 100 + lastLength).map((job) => job.id)
    );
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([pageUrl(), pageUrl(100)]);
  });

  it.each([0, 1])(
    'uses one single-posting lookahead at an exact-full configured cap (extra %i)',
    async (extra) => {
      const { http, fetcher } = fixtureHttp({
        [pageUrl(0, 2)]: postings(0, 2),
        [pageUrl(2, 1)]: postings(2, extra),
      });
      const result = await collectBoard(board(), http, { maxJobs: 2 });
      expect(result).toMatchObject({ complete: extra === 0, fetched: 2 + extra });
      expect(result.message).toBe(
        extra === 0 ? null : 'Board job limit reached; board refresh is incomplete.'
      );
      expect(result.jobs).toHaveLength(2);
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([pageUrl(0, 2), pageUrl(2, 1)]);
    }
  );

  it('shrinks the last retained page without skipping postings or exceeding maxJobs', async () => {
    const { http, fetcher } = fixtureHttp({
      [pageUrl()]: postings(0, 100),
      [pageUrl(100, 50)]: postings(100, 50),
      [pageUrl(150, 1)]: postings(150, 1),
    });
    const result = await collectBoard(board(), http, { maxJobs: 150 });
    expect(result).toMatchObject({ complete: false, fetched: 151 });
    expect(result.jobs).toHaveLength(150);
    expect(result.jobs[149].sourceJobId).toBe('job-149');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      pageUrl(),
      pageUrl(100, 50),
      pageUrl(150, 1),
    ]);
  });

  it.each([undefined, 10000])(
    'hard caps retention at 2000 with at most one bounded lookahead (requested %p)',
    async (maxJobs) => {
      for (const extra of [0, 1]) {
        const routes: Record<string, Route> = {};
        for (let skip = 0; skip < 2000; skip += 100) {
          routes[pageUrl(skip)] = postings(skip, 100);
        }
        routes[pageUrl(2000, 1)] = postings(2000, extra);
        const { http, fetcher } = fixtureHttp(routes);
        const result = await collectBoard(board(), http, { maxJobs });
        expect(result).toMatchObject({ complete: extra === 0, fetched: 2000 + extra });
        expect(result.jobs).toHaveLength(2000);
        expect(fetcher).toHaveBeenCalledTimes(21);
        expect(fetcher.mock.calls[20][0]).toBe(pageUrl(2000, 1));
      }
    }
  );

  it.each([
    ['duplicate across pages', [postings(0, 1)[0]]],
    ['repeated full page', postings(0, 100)],
    ['duplicate within later short page', [postings(100, 1)[0], postings(100, 1)[0]]],
  ])(
    'retains only validated earlier pages for %s, never declaring closure',
    async (_name, later) => {
      const { http, fetcher } = fixtureHttp({
        [pageUrl()]: postings(0, 100),
        [pageUrl(100)]: later,
      });
      const result = await collectBoard(board(), http);
      expect(result).toMatchObject({ complete: false, fetched: 100 + later.length });
      expect(result.jobs).toHaveLength(100);
      expect(result.message).toMatch(/incomplete/);
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    null,
    {},
    { jobs: [] },
    [null],
    [postings(100, 1)[0], { id: 'bad', text: '' }],
    [{ id: 'bad', text: 'Role', categories: { allLocations: {} } }],
    postings(100, 101),
    () => new Response('{bad JSON'),
    () => new Response('untrusted error body', { status: 503 }),
    () => new Response('untrusted error body', { status: 404 }),
    () => {
      throw new Error('untrusted network error');
    },
  ])(
    'keeps validated earlier jobs incomplete after a malformed or failed later page %#',
    async (later) => {
      const { http, fetcher } = fixtureHttp({
        [pageUrl()]: postings(0, 100),
        [pageUrl(100)]: later,
      });
      const result = await collectBoard(board(), http);
      expect(result.complete).toBe(false);
      expect(result.jobs).toHaveLength(100);
      expect(result.jobs[99].sourceJobId).toBe('job-99');
      expect(result.fetched).toBe(100 + (Array.isArray(later) ? later.length : 0));
      expect(result.message).toBe(
        'Lever posting pagination failed or could not be validated; board refresh is incomplete.'
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    [{ id: 'job-0', text: 'Duplicate lookahead' }],
    [null],
    postings(2, 2),
    () => new Response('failure', { status: 500 }),
  ])(
    'never claims completion when the single lookahead is duplicate, malformed or failed %#',
    async (later) => {
      const { http, fetcher } = fixtureHttp({
        [pageUrl(0, 2)]: postings(0, 2),
        [pageUrl(2, 1)]: later,
      });
      const result = await collectBoard(board(), http, { maxJobs: 2 });
      expect(result.complete).toBe(false);
      expect(result.jobs).toHaveLength(2);
      expect(result.message).toMatch(/incomplete/);
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    null,
    {},
    { jobs: [] },
    { data: [], next: null },
    [null],
    [[]],
    [{ id: '../bad', text: 'Role' }],
    [{ id: '', text: 'Role' }],
    [{ text: 'No ID', hostedUrl: 'https://jobs.lever.co/acme/id' }],
    [{ id: 'no-title' }],
    [{ id: 'title', text: 42 }],
    [posting({ categories: [] })],
    [posting({ categories: { allLocations: [42] } })],
    [posting({ lists: {} })],
    [posting({ lists: [null] })],
    [posting({ lists: [{ text: 42 }] })],
    [posting({ lists: [{ content: {} }] })],
    [posting({ descriptionPlain: 42 })],
    [posting({ additional: {} })],
    [posting({ salaryDescription: [] })],
    [posting({ workplaceType: true })],
    [posting({ country: {} })],
    [posting({ salaryRange: [] })],
    [posting({ salaryRange: { min: '81000' } })],
    [posting({ salaryRange: { currency: 42 } })],
    [posting(), posting()],
    postings(0, 101),
    () => new Response('not found', { status: 404 }),
    () => new Response('{invalid JSON'),
  ])('fails an invalid first page instead of returning any closure evidence %#', async (first) => {
    const { http, fetcher } = fixtureHttp({ [pageUrl()]: first });
    await expect(collectBoard(board(), http)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { concurrency: 0 },
    { concurrency: 5 },
    { concurrency: 1.5 },
    { maxJobs: 0 },
    { maxJobs: -1 },
    { maxJobs: 1.5 },
    { maxJobs: Infinity },
  ])('validates shared collection options before requesting Lever %#', async (options) => {
    const { http, fetcher } = fixtureHttp({});
    await expect(collectBoard(board(), http, options)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { slug: '../evil' },
    { slug: 'acme?redirect=evil' },
    { boardUrl: 'https://evil.test/acme' },
    { boardUrl: 'https://jobs.eu.lever.co/acme' },
  ])('validates global board identity before taking the Lever branch %#', async (patch) => {
    const { http, fetcher } = fixtureHttp({});
    await expect(collectBoard({ ...board(), ...patch }, http)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps provider IDs scoped to the validated board, not returned links', async () => {
    const { http } = fixtureHttp({
      [pageUrl()]: [posting()],
      [pageUrl(0, 100, 'other')]: [posting()],
    });
    const first = (await collectBoard(board(), http)).jobs[0];
    const second = (await collectBoard(board('other'), http)).jobs[0];
    expect([first.source, second.source]).toEqual(['lever:acme', 'lever:other']);
    expect([first.sourceJobId, second.sourceJobId]).toEqual(['lever-1', 'lever-1']);
  });

  it('uses shared bounded GET retries for Lever without following reported links', async () => {
    let calls = 0;
    const sleep = jest.fn(async () => {});
    const { http, fetcher } = fixtureHttp(
      {
        [pageUrl()]: () =>
          ++calls === 1
            ? new Response('limited', { status: 429, headers: { 'retry-after': '1' } })
            : [posting()],
      },
      { retries: 2, sleep }
    );
    expect(await collectBoard(board(), http)).toMatchObject({ complete: true, fetched: 1 });
    expect(sleep.mock.calls).toEqual([[1000]]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([pageUrl(), pageUrl()]);
  });
});
