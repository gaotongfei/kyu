import { fireEvent, render, screen, within } from '@testing-library/react';
import Loading from '../../app/jobs/loading';
import type { RunReport } from '../../collector/types';
import type { CatalogJob, CatalogResult } from '../../jobs/types';
import { JobCatalog } from './JobCatalog';

// Explicit fixture data only. No provider requests, database reads or production sample jobs.
function fixtureJob(): CatalogJob {
  return {
    job: {
      provider: 'ashby',
      source: 'ashby:fixture-board',
      sourceJobId: 'fixture-job-1',
      title: 'Fixture engineer',
      company: 'Fixture employer',
      jobUrl: 'https://example.test/jobs/fixture-job-1',
      applicationUrl: 'https://example.test/apply/fixture-job-1',
      descriptionHtml: '<p>Fixture description HTML.</p>',
      descriptionText: 'Fixture description.\nA second line.',
      descriptionComplete: true,
      detailsComplete: true,
      locations: [
        { text: 'Toronto, Canada', city: 'Toronto', region: 'Ontario', country: 'Canada' },
        { text: 'New York, US', city: 'New York', region: 'New York', country: 'United States' },
      ],
      workArrangement: 'remote',
      reportedWorkArrangement: 'Remote in Canada or the US',
      employmentType: 'Full time',
      compensation: [
        {
          min: 150000,
          max: 190000,
          currency: 'CAD',
          period: 'year',
          kind: 'Base salary',
          summary: null,
        },
      ],
      reportedCompensation: null,
      sourcePostedAt: '2026-11-20T12:00:00Z',
      sourceUpdatedAt: '2026-11-23T12:00:00Z',
      upstreamSource: null,
    },
    active: true,
    firstObservedAt: '2026-11-21T12:00:00Z',
    lastObservedAt: '2026-11-24T12:00:00Z',
    inactiveAt: null,
    refreshStatus: 'success',
    lastBoardSuccessAt: '2026-11-24T12:00:00Z',
  };
}

type Ready = Extract<CatalogResult, { kind: 'ready' }>;
function fixtureCatalog(overrides: Partial<Ready> = {}): Ready {
  return {
    kind: 'ready',
    filters: { q: '', location: '', includeInactive: false, page: 1 },
    jobs: [fixtureJob()],
    total: 1,
    page: 1,
    pageSize: 20,
    lastRun: null,
    ...overrides,
  };
}

function fixtureReport(): RunReport {
  return {
    id: 'fixture-run',
    startedAt: '2026-11-24T12:00:00Z',
    finishedAt: '2026-11-24T12:01:00Z',
    status: 'partial',
    sources: [
      {
        provider: 'ashby',
        source: 'ashby:fixture-board',
        status: 'success',
        complete: true,
        fetched: 3,
        retained: 2,
        deactivated: 1,
        message: null,
      },
      {
        provider: 'greenhouse',
        source: 'greenhouse:fixture-failed',
        status: 'failed',
        complete: false,
        fetched: 0,
        retained: 0,
        deactivated: 0,
        message: 'Board could not be refreshed; prior observations retained.',
      },
      {
        provider: 'greenhouse',
        source: 'greenhouse:fixture-partial',
        status: 'partial',
        complete: false,
        fetched: 1,
        retained: 1,
        deactivated: 0,
        message: 'Some job details could not be validated.',
      },
      {
        provider: 'hirebase',
        source: 'hirebase:fixture-skipped',
        status: 'skipped',
        complete: false,
        fetched: 0,
        retained: 0,
        deactivated: 0,
        message: 'Hirebase key not configured; no requests made.',
      },
    ],
    hirebase: {
      requestedBudget: 2,
      reserved: 0,
      returned: 0,
      uncertain: 0,
      providerRemaining: null,
      period: '2026-11',
    },
  };
}

function disclosure(container: HTMLElement): HTMLElement {
  return container.querySelector('section[aria-labelledby="catalog-heading"] > details > summary')!;
}

function openDetails(container: HTMLElement): HTMLElement {
  const summary = disclosure(container);
  fireEvent.click(summary);
  expect(summary.parentElement).toHaveAttribute('open');
  return summary.parentElement!;
}

describe('JobCatalog', () => {
  it('shows honest loading text without fabricated jobs or skeletons', () => {
    const { container } = render(<Loading />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading catalog… Reading previously collected jobs only.'
    );
    expect(container.querySelector('details')).toBeNull();
    expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Resumes' })).toHaveAttribute('href', '/resumes');
  });

  it('uses shared navigation and labeled native GET filters, active by default', () => {
    const { container } = render(<JobCatalog result={fixtureCatalog()} />);
    expect(screen.queryByText('Your next move.')).not.toBeInTheDocument();
    expect(screen.queryByText('Private instance · Read-only catalog')).not.toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(navigation).getAllByRole('link')).toHaveLength(2);
    expect(within(navigation).getByRole('link', { name: 'Discover' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(navigation).getByRole('link', { name: 'Resumes' })).toHaveAttribute(
      'href',
      '/resumes'
    );
    expect(screen.queryByRole('link', { name: /Saved|Studio|Profile/ })).not.toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Filter collected jobs' });
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/jobs');
    expect(screen.getByRole('searchbox', { name: 'Role or company' })).toHaveAttribute('name', 'q');
    expect(screen.getByRole('searchbox', { name: 'Reported location' })).toHaveAttribute(
      'name',
      'location'
    );
    expect(screen.getByRole('button', { name: 'Filter jobs' })).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('link', { name: 'Reset filters' })).toHaveAttribute('href', '/jobs');
    expect(form.querySelector('[name="inactive"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Include inactive' })).toHaveAttribute(
      'href',
      '/jobs?inactive=1'
    );
    expect(form).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(/Opening or filtering this page/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Roles collected from the searches/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Private, read-only catalog\./)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1 job' })).toBeInTheDocument();
    expect(container.querySelectorAll('details')).toHaveLength(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('preserves text and inactive inclusion on submit, reset and toggle; starts new filters on page one', () => {
    render(
      <JobCatalog
        result={fixtureCatalog({
          filters: { q: 'Data & AI', location: 'Toronto', includeInactive: true, page: 3 },
          page: 3,
          total: 42,
        })}
      />
    );
    const form = screen.getByRole('form', { name: 'Filter collected jobs' }) as HTMLFormElement;
    expect(screen.getByRole('searchbox', { name: 'Role or company' })).toHaveValue('Data & AI');
    expect(screen.getByRole('searchbox', { name: 'Reported location' })).toHaveValue('Toronto');
    expect(Array.from(new FormData(form).entries())).toEqual([
      ['q', 'Data & AI'],
      ['location', 'Toronto'],
      ['inactive', '1'],
    ]);
    expect(form.querySelector('[name="page"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Reset filters' })).toHaveAttribute(
      'href',
      '/jobs?inactive=1'
    );
    expect(screen.getByRole('link', { name: 'Hide inactive' })).toHaveAttribute(
      'href',
      '/jobs?q=Data+%26+AI&location=Toronto'
    );
  });

  it('shows only title, salary and location in the native summary and reveals all other facts on click', () => {
    const { container } = render(<JobCatalog result={fixtureCatalog()} />);
    const summary = disclosure(container);
    expect(summary).toHaveTextContent(
      /^Fixture engineerCAD 150k–190k \/ yearToronto, Canada · New York, US$/
    );
    for (const text of [
      'Fixture employer',
      'Work arrangement',
      'Remote in Canada or the US',
      'Full time',
      'Ashby',
      'ashby:fixture-board',
      'Last observed',
      'Active',
      'Show / hide',
    ]) {
      expect(summary).not.toHaveTextContent(text);
    }
    expect(summary.querySelector('a, button, input')).toBeNull();
    expect(screen.getByText('Open application')).not.toBeVisible();
    expect(screen.getByText('Fixture employer')).not.toBeVisible();
    const details = openDetails(container);
    expect(screen.getByText('Fixture employer')).toBeVisible();
    expect(details).toHaveTextContent('Full time');
    expect(details).toHaveTextContent('Active');
    expect(details).toHaveTextContent('Remote in Canada or the US');
    expect(details).toHaveTextContent('Ashby');
    expect(details).toHaveTextContent('ashby:fixture-board');
    expect(details).toHaveTextContent('Base salary: CAD 150,000–190,000 · year');
    expect(within(details).getByRole('link', { name: 'Open application' })).toHaveAttribute(
      'href',
      'https://example.test/apply/fixture-job-1'
    );
    expect(within(details).getByRole('link', { name: 'Original listing' })).toHaveAttribute(
      'href',
      'https://example.test/jobs/fixture-job-1'
    );
    expect(
      screen.getByText(/Remote work does not establish work authorization/)
    ).toBeInTheDocument();
    expect(screen.getByText('First observed')).toBeInTheDocument();
    expect(screen.getByText('Source posted')).toBeInTheDocument();
    expect(screen.getByText('Source updated')).toBeInTheDocument();
    expect(screen.getByText('fixture-job-1')).toBeInTheDocument();
    expect(details.querySelector('time[datetime="2026-11-21T12:00:00.000Z"]')).not.toBeNull();
    expect(details.querySelector('time[datetime="2026-11-20T12:00:00.000Z"]')).not.toBeNull();
    expect(screen.getByText(/Region: Ontario · Country: Canada/)).toBeInTheDocument();
    fireEvent.click(summary);
    expect(details).not.toHaveAttribute('open');
  });

  it.each([
    [149500, 190250, 'CAD 149.5k–190.25k / year'],
    [0, 0, 'CAD 0 / year'],
    [150000, null, 'CAD From 150k / year'],
    [null, 190000, 'CAD Up to 190k / year'],
    [null, null, 'CAD Amount not reported / year'],
  ] as const)('keeps compact pay exact for bounds %s–%s', (min, max, expected) => {
    const entry = fixtureJob();
    entry.job.compensation[0] = { ...entry.job.compensation[0], min, max };
    const { container } = render(<JobCatalog result={fixtureCatalog({ jobs: [entry] })} />);
    expect(disclosure(container)).toHaveTextContent(expected);
    const details = openDetails(container);
    expect(details).toHaveTextContent('Compensation');
    expect(details).not.toHaveTextContent('USD');
  });

  it('shows Lever provenance with separate original posting and application links', () => {
    const entry = fixtureJob();
    entry.job = {
      ...entry.job,
      provider: 'lever',
      source: 'lever:fixture-board',
      jobUrl: 'https://jobs.lever.co/fixture-board/fixture-job-1',
      applicationUrl: 'https://jobs.lever.co/fixture-board/fixture-job-1/apply',
    };
    const { container } = render(<JobCatalog result={fixtureCatalog({ jobs: [entry] })} />);
    expect(disclosure(container)).not.toHaveTextContent('Lever');
    const details = openDetails(container);
    expect(within(details).getByText('Lever')).toBeVisible();
    expect(within(details).getByText('lever:fixture-board')).toBeVisible();
    expect(within(details).getByRole('link', { name: 'Original listing' })).toHaveAttribute(
      'href',
      entry.job.jobUrl
    );
    expect(within(details).getByRole('link', { name: 'Open application' })).toHaveAttribute(
      'href',
      entry.job.applicationUrl
    );
  });

  it('renders untrusted descriptions as plain text, never injected HTML or script', () => {
    const entry = fixtureJob();
    entry.job.descriptionText =
      '<script>window.fixtureInjected = true</script><img src=x onerror="alert(1)">';
    entry.job.descriptionHtml =
      '<script>window.htmlInjected = true</script><a href="javascript:alert(1)">bad</a>';
    const { container } = render(<JobCatalog result={fixtureCatalog({ jobs: [entry] })} />);
    openDetails(container);
    expect(screen.getByText(entry.job.descriptionText)).toBeInTheDocument();
    expect(container.querySelector('script, img, [onerror]')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container).not.toHaveTextContent('window.htmlInjected');
  });

  it('does not invent missing location, work style, employment, compensation, dates or links', () => {
    const entry = fixtureJob();
    entry.job = {
      ...entry.job,
      locations: [],
      workArrangement: null,
      reportedWorkArrangement: null,
      employmentType: null,
      compensation: [],
      sourcePostedAt: null,
      sourceUpdatedAt: null,
      jobUrl: null,
      applicationUrl: null,
      descriptionText: null,
      descriptionComplete: false,
    };
    entry.lastBoardSuccessAt = null;
    const { container } = render(<JobCatalog result={fixtureCatalog({ jobs: [entry] })} />);
    const summary = disclosure(container);
    expect(summary).toHaveTextContent('Location not specified');
    expect(summary).toHaveTextContent('Salary not listed');
    expect(summary).not.toHaveTextContent('Work arrangement');
    const details = openDetails(container);
    expect(details).toHaveTextContent('Employment type not specified');
    expect(screen.getByText('Work arrangement').nextElementSibling).toHaveTextContent(
      'Not specified'
    );
    expect(screen.getByText('Source work arrangement').nextElementSibling).toHaveTextContent(
      'Not specified'
    );
    expect(screen.getByText('Description not reported.')).toBeInTheDocument();
    expect(screen.getByText('Description may be incomplete.')).toBeInTheDocument();
    expect(screen.getByText('Source posted').nextElementSibling).toHaveTextContent('Not reported');
    expect(screen.getByText('Source updated').nextElementSibling).toHaveTextContent('Not reported');
    expect(screen.getByText('Application link not reported')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open application' })).not.toBeInTheDocument();
  });

  it('preserves Greenhouse period unknown, component kinds and missing currencies; labels potentially stale pay', () => {
    const entry = fixtureJob();
    entry.job.provider = 'greenhouse';
    entry.job.source = 'greenhouse:fixture-board';
    entry.job.detailsComplete = false;
    entry.job.compensation = [
      {
        min: 100000,
        max: 120000,
        currency: 'USD',
        period: null,
        kind: 'Base salary',
        summary: 'Reported range only.',
      },
      { min: 10, max: 20, currency: null, period: null, kind: 'Equity', summary: null },
      { min: null, max: 5000, currency: 'CAD', period: 'one time', kind: 'Bonus', summary: null },
      { min: null, max: null, currency: null, period: null, kind: null, summary: null },
    ];
    const { container } = render(<JobCatalog result={fixtureCatalog({ jobs: [entry] })} />);
    const summary = disclosure(container);
    expect(summary).not.toHaveTextContent('Greenhouse');
    expect(summary).toHaveTextContent('USD 100k–120k · period not reported');
    expect(summary).toHaveTextContent('Equity: Currency not reported 10–20 · period not reported');
    expect(summary).toHaveTextContent('Bonus: CAD Up to 5k / one time');
    expect(summary).toHaveTextContent(
      'Compensation (kind not reported): Currency not reported Amount not reported · period not reported'
    );
    expect(
      within(summary).getByRole('img', { name: /previously collected pay may be stale/ })
    ).toBeInTheDocument();
    expect(summary).not.toHaveTextContent('Job details incomplete');
    expect(summary).not.toHaveTextContent('year');
    const details = openDetails(container);
    expect(details).toHaveTextContent('Base salary: USD 100,000–120,000 · period not reported');
    expect(details).toHaveTextContent('Bonus: CAD Up to 5,000 · one time');
    expect(details).toHaveTextContent(
      'Job details incomplete; previously collected pay may be stale.'
    );
    expect(screen.getByText('Reported range only.')).toBeInTheDocument();
  });

  it.each(['failed', 'partial'])(
    'shows %s row refresh as stale, not a fabricated closure',
    (refreshStatus) => {
      const entry = fixtureJob();
      entry.refreshStatus = refreshStatus;
      const { container } = render(<JobCatalog result={fixtureCatalog({ jobs: [entry] })} />);
      const summary = disclosure(container);
      expect(
        within(summary).getByRole('img', {
          name: `Latest refresh ${refreshStatus}; previous observations may be stale.`,
        })
      ).toBeInTheDocument();
      expect(summary).not.toHaveTextContent('Latest refresh');
      const details = openDetails(container);
      expect(details).toHaveTextContent(
        `Latest refresh ${refreshStatus}; previous observations may be stale.`
      );
      expect(details).toHaveTextContent('Active');
      expect(details).not.toHaveTextContent('Inactive');
    }
  );

  it('keeps inactive observations and exact provider provenance distinct, including upstream identity', () => {
    const inactive = fixtureJob();
    inactive.active = false;
    inactive.inactiveAt = '2026-11-25T12:00:00Z';
    const other = fixtureJob();
    other.job = {
      ...other.job,
      provider: 'hirebase',
      source: 'hirebase:fixture-search',
      sourceJobId: 'fixture-hirebase-id',
      upstreamSource: {
        provider: 'ashby',
        jobId: 'fixture-upstream-id',
        boardUrl: 'https://example.test/source-board',
      },
    };
    const { container } = render(
      <JobCatalog
        result={fixtureCatalog({
          jobs: [inactive, other],
          total: 2,
          filters: { q: '', location: '', includeInactive: true, page: 1 },
        })}
      />
    );
    expect(container.querySelectorAll('details')).toHaveLength(2);
    const summary = disclosure(container);
    expect(summary).not.toHaveTextContent('Inactive');
    const firstDetails = openDetails(container);
    expect(firstDetails).toHaveTextContent('Inactive');
    expect(firstDetails).toHaveTextContent('Inactive since');
    expect(firstDetails).toHaveTextContent('Nov 25, 2026');
    const secondDetails = container.querySelectorAll('details')[1];
    fireEvent.click(secondDetails.querySelector('summary')!);
    expect(within(secondDetails).getByText('fixture-hirebase-id')).toBeInTheDocument();
    expect(within(secondDetails).getByText('fixture-upstream-id')).toBeInTheDocument();
    expect(
      within(secondDetails).getByRole('link', { name: 'Original source board' })
    ).toHaveAttribute('href', 'https://example.test/source-board');
    expect(
      within(secondDetails).getByText(/not a complete employer-board refresh/)
    ).toBeInTheDocument();
  });

  it('collapses diagnostic facts behind one accessible status, preserving all source outcomes on demand', () => {
    const { container } = render(
      <JobCatalog result={fixtureCatalog({ lastRun: fixtureReport() })} />
    );
    const notice = screen.getByRole('complementary', { name: 'Collection status' });
    const details = notice.querySelector('details')!;
    const summary = details.querySelector('summary')!;
    expect(details).not.toHaveAttribute('open');
    expect(summary).toHaveTextContent('Partial refresh');
    expect(summary).toHaveTextContent('Nov 24, 12:01 PM UTC');
    expect(summary).toHaveTextContent('Details');
    expect(summary.querySelector('svg[data-status="partial"]')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
    expect(summary.querySelector('a, button, input')).toBeNull();
    expect(within(notice).getByRole('list')).not.toBeVisible();
    expect(
      within(notice).getByText('Board could not be refreshed; prior observations retained.')
    ).not.toBeVisible();
    expect(notice).not.toHaveTextContent(/do not close unseen jobs|not a full feed/);

    fireEvent.click(summary);
    expect(details).toHaveAttribute('open');
    const sources = within(notice).getAllByRole('listitem');
    expect(sources).toHaveLength(4);
    expect(sources[0]).toHaveTextContent('Ashby · ashby:fixture-board');
    expect(sources[0]).toHaveTextContent('success · Complete');
    expect(sources[0]).toHaveTextContent('3 fetched · 2 retained · 1 deactivated');
    expect(sources[1]).toHaveTextContent('Greenhouse · greenhouse:fixture-failed');
    expect(sources[1]).toHaveTextContent('failed · Incomplete');
    expect(sources[2]).toHaveTextContent('partial · Incomplete');
    expect(sources[3]).toHaveTextContent('Hirebase · hirebase:fixture-skipped');
    expect(sources[3]).toHaveTextContent('skipped · Incomplete');
    for (const message of [
      'Board could not be refreshed; prior observations retained.',
      'Some job details could not be validated.',
      'Hirebase key not configured; no requests made.',
    ]) {
      expect(within(notice).getByText(message)).toBeVisible();
    }
    expect(notice.querySelector('time[datetime="2026-11-24T12:00:00.000Z"]')).not.toBeNull();
    expect(notice.querySelector('time[datetime="2026-11-24T12:01:00.000Z"]')).not.toBeNull();
    const usage = notice.querySelector<HTMLElement>('dl[aria-label="Hirebase usage"]')!;
    expect(within(usage).getByText('Provider remaining').nextElementSibling).toHaveTextContent(
      'Not reported'
    );
    expect(within(usage).getByText('UTC month').nextElementSibling).toHaveTextContent('2026-11');
    expect(disclosure(container)).toHaveTextContent('Fixture engineer');
    expect(disclosure(container).parentElement).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(details).not.toHaveAttribute('open');
  });

  it.each([
    ['running', 'Refreshing'],
    ['failed', 'Refresh failed'],
    ['interrupted', 'Refresh interrupted'],
    ['success', 'Refresh complete'],
  ] as const)('pairs a distinct %s symbol with a readable status label', (status, label) => {
    const report = fixtureReport();
    report.status = status;
    report.finishedAt = status === 'running' ? null : report.finishedAt;
    render(<JobCatalog result={fixtureCatalog({ lastRun: report })} />);
    const notice = screen.getByRole('complementary', { name: 'Collection status' });
    const summary = notice.querySelector('summary')!;
    expect(summary).toHaveTextContent(label);
    expect(summary.querySelector(`svg[data-status="${status}"]`)).toHaveAttribute(
      'aria-hidden',
      'true'
    );
    expect(notice.querySelector('details')).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(within(notice).getByText('Finished').nextElementSibling).toHaveTextContent(
      status === 'running' ? 'Not finished' : 'Nov 24, 2026, 12:01 PM UTC'
    );
  });

  it('distinguishes every run state by symbol, not color alone', () => {
    const report = fixtureReport();
    const { rerender } = render(<JobCatalog result={fixtureCatalog({ lastRun: report })} />);
    const shapes = new Set<string | null>();
    for (const status of ['success', 'partial', 'failed', 'running', 'interrupted'] as const) {
      rerender(<JobCatalog result={fixtureCatalog({ lastRun: { ...report, status } })} />);
      const notice = screen.getByRole('complementary', { name: 'Collection status' });
      shapes.add(notice.querySelector('summary svg path')!.getAttribute('d'));
    }
    expect(shapes.size).toBe(5);
    expect(shapes.has(null)).toBe(false);
  });

  it('preserves bounded Hirebase coverage and every quota fact without a permanent explanation', () => {
    const report = fixtureReport();
    report.status = 'success';
    report.sources = [
      {
        provider: 'hirebase',
        source: 'hirebase:fixture-search',
        status: 'success',
        complete: false,
        fetched: 2,
        retained: 1,
        deactivated: 0,
        message: null,
      },
    ];
    report.hirebase = { ...report.hirebase, reserved: 2, returned: 2, providerRemaining: 498 };
    render(<JobCatalog result={fixtureCatalog({ lastRun: report })} />);
    const notice = screen.getByRole('complementary', { name: 'Collection status' });
    expect(notice.querySelector('summary')).toHaveTextContent('Refresh complete');
    expect(within(notice).getByText('success · Limited sample')).not.toBeVisible();
    fireEvent.click(notice.querySelector('summary')!);
    expect(within(notice).getByText('success · Limited sample')).toBeVisible();
    expect(notice).not.toHaveTextContent(/Incomplete|not a full feed/);
    const usage = notice.querySelector<HTMLElement>('dl[aria-label="Hirebase usage"]')!;
    for (const [label, value] of Object.entries({
      Requested: '2',
      Reserved: '2',
      Returned: '2',
      Uncertain: '0',
      'Provider remaining': '498',
      'UTC month': '2026-11',
    })) {
      expect(within(usage).getByText(label).nextElementSibling).toHaveTextContent(value);
    }
  });

  it('shows an honest no-data state with manual configuration/CLI guidance and no sample rows', () => {
    const { container } = render(<JobCatalog result={fixtureCatalog({ jobs: [], total: 0 })} />);
    expect(screen.getByRole('heading', { name: 'No collected jobs to show.' })).toBeInTheDocument();
    expect(screen.getByText(/Enable saved searches and employer boards/)).toHaveTextContent(
      'yarn collect --hirebase-budget 0'
    );
    expect(screen.getByText('Not collected yet.')).toBeInTheDocument();
    expect(container.querySelector('details')).toBeNull();
    expect(screen.getByText('Showing 0–0 of 0 · Page 1 of 1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Next page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Previous page' })).not.toBeInTheDocument();
  });

  it('distinguishes filtered-empty from no data and offers a reset preserving inactive inclusion', () => {
    render(
      <JobCatalog
        result={fixtureCatalog({
          jobs: [],
          total: 0,
          filters: { q: 'Absent fixture', location: 'Toronto', includeInactive: true, page: 1 },
        })}
      />
    );
    expect(
      screen.getByRole('heading', { name: 'No jobs match these filters.' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/jobs?inactive=1'
    );
    expect(screen.queryByText(/Enable saved searches/)).not.toBeInTheDocument();
  });

  it.each(['configuration', 'database'] as const)(
    'shows a safe actionable alert for %s unavailability',
    (reason) => {
      const { container } = render(
        <JobCatalog
          result={{
            kind: 'unavailable',
            reason,
            filters: { q: '', location: '', includeInactive: false, page: 1 },
          }}
        />
      );
      const alert = screen.getByRole('alert');
      expect(
        within(alert).getByRole('heading', { name: 'Catalog unavailable' })
      ).toBeInTheDocument();
      expect(alert).toHaveTextContent(
        reason === 'configuration'
          ? 'Configure the local database connection'
          : 'Check that the local database is reachable'
      );
      expect(alert).toHaveTextContent('migrations');
      expect(alert).not.toHaveTextContent('No provider request was made.');
      expect(alert).not.toHaveTextContent(/password|postgres:\/\/|stack|credential/i);
      expect(container.querySelector('details')).toBeNull();
      expect(screen.queryByRole('heading', { name: /No collected jobs/ })).not.toBeInTheDocument();
    }
  );

  it('bounds pagination and preserves all current filter state in previous/next links', () => {
    const filters = { q: 'Engineer & Data', location: 'New York', includeInactive: true, page: 2 };
    const { rerender } = render(
      <JobCatalog
        result={fixtureCatalog({
          filters,
          page: 2,
          total: 5,
          pageSize: 2,
          jobs: [
            fixtureJob(),
            { ...fixtureJob(), job: { ...fixtureJob().job, sourceJobId: 'fixture-job-2' } },
          ],
        })}
      />
    );
    expect(screen.getByText('Showing 3–4 of 5 · Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous page' })).toHaveAttribute(
      'href',
      '/jobs?q=Engineer+%26+Data&location=New+York&inactive=1'
    );
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/jobs?q=Engineer+%26+Data&location=New+York&inactive=1&page=3'
    );
    rerender(
      <JobCatalog
        result={fixtureCatalog({
          filters: { ...filters, page: 3 },
          page: 3,
          total: 5,
          pageSize: 2,
        })}
      />
    );
    expect(screen.getByText('Showing 5–5 of 5 · Page 3 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Next page' })).not.toBeInTheDocument();
    expect(screen.getByText('Next page')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('link', { name: 'Previous page' })).toHaveAttribute(
      'href',
      '/jobs?q=Engineer+%26+Data&location=New+York&inactive=1&page=2'
    );
  });

  it('does not turn unsupported source URLs into executable links', () => {
    const entry = fixtureJob();
    // eslint-disable-next-line no-script-url -- Malicious fixture verifies unsafe links are rejected.
    entry.job.jobUrl = 'javascript:alert(1)';
    entry.job.applicationUrl = 'data:text/html,<script>alert(1)</script>';
    const { container } = render(<JobCatalog result={fixtureCatalog({ jobs: [entry] })} />);
    openDetails(container);
    expect(screen.queryByRole('link', { name: 'Open application' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Original listing' })).not.toBeInTheDocument();
  });
});
