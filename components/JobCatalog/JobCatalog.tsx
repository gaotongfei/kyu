import type { Compensation, Provider, RunReport } from '../../collector/types';
import { catalogHref } from '../../jobs/filters';
import type { CatalogJob, CatalogResult } from '../../jobs/types';
import classes from './JobCatalog.module.css';

const providerNames: Record<Provider, string> = {
  ashby: 'Ashby',
  greenhouse: 'Greenhouse',
  hirebase: 'Hirebase',
};

function ObservationDate({ value }: { value: string | null }) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    return <>Not reported</>;
  }
  return (
    <time dateTime={date.toISOString()}>
      {new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(date)}{' '}
      UTC
    </time>
  );
}

function compensationText(component: Compensation): string {
  const number = (value: number) =>
    new Intl.NumberFormat('en', { maximumFractionDigits: 20 }).format(value);
  const { min, max } = component;
  const amount =
    min !== null && max !== null
      ? min === max
        ? number(min)
        : `${number(min)}–${number(max)}`
      : min !== null
        ? `From ${number(min)}`
        : max !== null
          ? `Up to ${number(max)}`
          : 'Amount not reported';
  return `${component.kind ?? 'Compensation (kind not reported)'}: ${component.currency ?? 'Currency not reported'} ${amount} · ${component.period ?? 'period not reported'}`;
}

function externalHref(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function CollectionReport({ report }: { report: RunReport | null }) {
  if (!report) {
    return (
      <p className={classes.metadata}>
        No collection run has been recorded. Collection runs only when invoked manually.
      </p>
    );
  }
  const hasStaleSources = report.sources.some(
    (source) => source.status !== 'success' || (!source.complete && source.provider !== 'hirebase')
  );
  const hasHirebase = report.sources.some((source) => source.provider === 'hirebase');
  return (
    <aside className={classes.report} aria-labelledby="collection-heading">
      <h2 id="collection-heading">Latest collection: {report.status}</h2>
      <p className={classes.metadata}>
        Started <ObservationDate value={report.startedAt} /> ·{' '}
        {report.finishedAt ? (
          <>
            Finished <ObservationDate value={report.finishedAt} />
          </>
        ) : (
          'Not finished'
        )}
      </p>
      {report.status === 'running' && (
        <p>Collection is in progress. Displayed observations may come from earlier runs.</p>
      )}
      {report.status === 'interrupted' && (
        <p>Collection was interrupted; not all sources were refreshed.</p>
      )}
      {hasStaleSources && (
        <p>
          Failed, partial or skipped refreshes do not close unseen jobs; older observations may be
          stale. They do not establish that a listing is inactive.
        </p>
      )}
      <ul className={classes.sourceReports}>
        {report.sources.map((source) => (
          <li key={`${source.provider}:${source.source}`}>
            <span className={classes.sourceOutcome}>
              {providerNames[source.provider]} · {source.source} · {source.status}
              {source.provider === 'hirebase' && source.status === 'success' && !source.complete
                ? ' · Limited sample (not exhaustive)'
                : !source.complete
                  ? ' · Incomplete source coverage'
                  : ' · Complete source refresh'}
            </span>
            <span className={classes.metadata}>
              {' '}
              · {source.fetched} fetched · {source.retained} retained · {source.deactivated}{' '}
              deactivated
            </span>
            {source.message && <p className={classes.sourceMessage}>{source.message}</p>}
          </li>
        ))}
      </ul>
      {hasHirebase && (
        <p className={classes.metadata}>
          Hirebase searches are intentionally limited by the invocation budget and provider/local
          monthly caps, not a full feed. Budget: {report.hirebase.requestedBudget} requested ·{' '}
          {report.hirebase.reserved} reserved · {report.hirebase.returned} returned ·{' '}
          {report.hirebase.uncertain} uncertain · provider remaining:{' '}
          {report.hirebase.providerRemaining ?? 'not reported'} · period: {report.hirebase.period}.
        </p>
      )}
    </aside>
  );
}

function JobRow({ entry }: { entry: CatalogJob }) {
  const { job } = entry;
  const original = externalHref(job.jobUrl);
  const application = externalHref(job.applicationUrl);
  const upstream = externalHref(job.upstreamSource?.boardUrl ?? null);
  const stale = entry.refreshStatus === 'failed' || entry.refreshStatus === 'partial';
  return (
    <details className={classes.job}>
      <summary className={classes.summary}>
        <span className={classes.row}>
          <span className={classes.role}>
            <span className={classes.jobTitle}>{job.title}</span>
            <span className={classes.metadata}>{job.company}</span>
            <span className={classes.metadata}>
              Reported location:{' '}
              {job.locations.length
                ? job.locations
                    .map(
                      (location) =>
                        location.text ||
                        [location.city, location.region, location.country]
                          .filter(Boolean)
                          .join(', ') ||
                        'Not specified'
                    )
                    .join(' · ')
                : 'Not specified'}
            </span>
            <span className={classes.metadata}>
              Work arrangement: {job.workArrangement ?? 'Not specified'} · Source wording:{' '}
              {job.reportedWorkArrangement ?? 'Not specified'}
            </span>
          </span>
          <span className={classes.pay}>
            {job.compensation.length ? (
              job.compensation.map((component, index) => (
                <span key={index}>{compensationText(component)}</span>
              ))
            ) : (
              <span>Salary not listed</span>
            )}
            <span>{job.employmentType ?? 'Employment type not specified'}</span>
            {job.detailsComplete === false && (
              <span className={classes.warning}>
                Job details incomplete; previously collected pay may be stale.
              </span>
            )}
          </span>
        </span>
        <span className={classes.observation}>
          {providerNames[job.provider]} · {job.source} · Last observed{' '}
          <ObservationDate value={entry.lastObservedAt} /> ·{' '}
          {entry.active ? (
            'Active'
          ) : (
            <>
              Inactive · Inactive since <ObservationDate value={entry.inactiveAt} />
            </>
          )}
        </span>
        {stale && (
          <span className={classes.stale}>
            Latest refresh {entry.refreshStatus}; previous observations may be stale.
          </span>
        )}
        <span className={classes.disclosureHint}>Show / hide reported details</span>
      </summary>
      <div className={classes.details}>
        <h3>Reported job details</h3>
        <p className={classes.description}>{job.descriptionText ?? 'Description not reported.'}</p>
        {!job.descriptionComplete && (
          <p className={classes.warning}>Description may be incomplete.</p>
        )}
        <p>
          Remote work does not establish work authorization in every country. Eligibility has not
          been evaluated.
        </p>
        <dl className={classes.facts}>
          <dt>Reported locations</dt>
          <dd>
            {job.locations.length ? (
              <ul className={classes.locations}>
                {job.locations.map((location, index) => (
                  <li key={index}>
                    {location.text ?? 'Location text not specified'} · City:{' '}
                    {location.city ?? 'Not specified'} · Region:{' '}
                    {location.region ?? 'Not specified'} · Country:{' '}
                    {location.country ?? 'Not specified'}
                  </li>
                ))}
              </ul>
            ) : (
              'Not specified'
            )}
          </dd>
          <dt>Work arrangement</dt>
          <dd>{job.workArrangement ?? 'Not specified'}</dd>
          <dt>Source work arrangement</dt>
          <dd>{job.reportedWorkArrangement ?? 'Not specified'}</dd>
          <dt>Compensation</dt>
          <dd>
            {job.compensation.length ? (
              <ul className={classes.locations}>
                {job.compensation.map((component, index) => (
                  <li key={index}>
                    {compensationText(component)}
                    {component.summary && <p>{component.summary}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              'Salary not listed'
            )}
          </dd>
          <dt>First observed</dt>
          <dd>
            <ObservationDate value={entry.firstObservedAt} />
          </dd>
          <dt>Last observed</dt>
          <dd>
            <ObservationDate value={entry.lastObservedAt} />
          </dd>
          <dt>Source posted</dt>
          <dd>
            <ObservationDate value={job.sourcePostedAt} />
          </dd>
          <dt>Source updated</dt>
          <dd>
            <ObservationDate value={job.sourceUpdatedAt} />
          </dd>
          {!entry.active && (
            <>
              <dt>Inactive since</dt>
              <dd>
                <ObservationDate value={entry.inactiveAt} />
              </dd>
            </>
          )}
          <dt>Last successful board refresh</dt>
          <dd>
            <ObservationDate value={entry.lastBoardSuccessAt} />
          </dd>
          <dt>Provider</dt>
          <dd>{providerNames[job.provider]}</dd>
          <dt>Source scope</dt>
          <dd>{job.source}</dd>
          <dt>Provider job ID</dt>
          <dd>{job.sourceJobId}</dd>
          {job.upstreamSource && (
            <>
              <dt>Upstream provider</dt>
              <dd>{job.upstreamSource.provider ?? 'Not reported'}</dd>
              <dt>Upstream job ID</dt>
              <dd>{job.upstreamSource.jobId ?? 'Not reported'}</dd>
              <dt>Upstream board</dt>
              <dd>{upstream ? <a href={upstream}>Original source board</a> : 'Not reported'}</dd>
            </>
          )}
        </dl>
        {job.provider === 'hirebase' && (
          <p className={classes.metadata}>
            This is a Hirebase search observation, not a complete employer-board refresh. Unseen
            jobs are not marked inactive by searches.
          </p>
        )}
        <div className={classes.actions}>
          {application ? (
            <a className={classes.primaryAction} href={application}>
              Open application
            </a>
          ) : (
            <span className={classes.metadata}>Application link not reported</span>
          )}
          {original ? (
            <a className={classes.textAction} href={original}>
              Original listing
            </a>
          ) : (
            <span className={classes.metadata}>Original listing link not reported</span>
          )}
        </div>
      </div>
    </details>
  );
}

export function JobCatalog({ result }: { result: CatalogResult }) {
  const { filters } = result;
  const clearHref = catalogHref(filters, { q: '', location: '', page: 1 });
  const filtered = Boolean(filters.q || filters.location);
  const pageCount =
    result.kind === 'ready' ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  return (
    <div className={classes.catalog}>
      <div className={classes.frame}>
        <header className={classes.header}>
          <span className={classes.brand}>
            Kyu<span>.</span>
          </span>
          <nav aria-label="Primary">
            <a href="/jobs" aria-current="page">
              Discover
            </a>
          </nav>
          <span className={classes.instance}>Private instance · Read-only catalog</span>
        </header>
        <main className={classes.main}>
          <h1>Your next move.</h1>
          <p className={classes.intro}>
            Roles collected from the searches and employer boards you choose.
          </p>
          <form
            method="get"
            action="/jobs"
            className={classes.filters}
            aria-label="Filter collected jobs"
            aria-describedby="filter-help"
          >
            <div className={classes.field}>
              <label htmlFor="catalog-query">Role or company</label>
              <input
                id="catalog-query"
                name="q"
                type="search"
                defaultValue={filters.q}
                maxLength={120}
              />
            </div>
            <div className={classes.field}>
              <label htmlFor="catalog-location">Reported location</label>
              <input
                id="catalog-location"
                name="location"
                type="search"
                defaultValue={filters.location}
                maxLength={120}
              />
            </div>
            {filters.includeInactive && <input type="hidden" name="inactive" value="1" />}
            <div className={classes.filterActions}>
              <button type="submit" className={classes.primaryAction}>
                Filter jobs
              </button>
              <a href={clearHref} className={classes.textAction}>
                Reset filters
              </a>
            </div>
          </form>
          <p id="filter-help" className={classes.filterHelp}>
            Filters search only collected jobs. Opening or filtering this page never contacts
            providers.
          </p>
          {result.kind === 'unavailable' ? (
            <section role="alert" className={classes.unavailable}>
              <h2>Catalog unavailable</h2>
              <p>
                {result.reason === 'configuration'
                  ? 'Configure the local database connection, then apply the documented database migrations.'
                  : 'Check that the local database is reachable and its migrations have been applied.'}
              </p>
              <p>No provider request was made.</p>
            </section>
          ) : (
            <>
              <CollectionReport report={result.lastRun} />
              <section aria-labelledby="catalog-heading">
                <div className={classes.listHeading}>
                  <h2 id="catalog-heading">
                    {result.total} matching {result.total === 1 ? 'job' : 'jobs'} ·{' '}
                    {filters.includeInactive ? 'Active and inactive listings' : 'Active listings'}
                  </h2>
                  <span>
                    Most recently observed first ·{' '}
                    <a
                      href={catalogHref(filters, {
                        includeInactive: !filters.includeInactive,
                        page: 1,
                      })}
                    >
                      {filters.includeInactive ? 'Hide inactive' : 'Include inactive'}
                    </a>
                  </span>
                </div>
                {result.jobs.length ? (
                  result.jobs.map((entry) => (
                    <JobRow
                      key={`${entry.job.provider}:${entry.job.source}:${entry.job.sourceJobId}`}
                      entry={entry}
                    />
                  ))
                ) : (
                  <div className={classes.empty}>
                    <h3>
                      {filtered ? 'No jobs match these filters.' : 'No collected jobs to show.'}
                    </h3>
                    {filtered ? (
                      <p>
                        <a href={clearHref}>Clear filters</a> to view the collected catalog.
                      </p>
                    ) : (
                      <p>
                        Enable saved searches and employer boards in the local configuration, then
                        run <code>yarn collect --hirebase-budget 0</code> for enabled boards.
                        Collection runs only when invoked manually.
                      </p>
                    )}
                  </div>
                )}
                <footer className={classes.footer}>
                  <span>
                    Showing {result.total ? (result.page - 1) * result.pageSize + 1 : 0}–
                    {Math.min(
                      (result.page - 1) * result.pageSize + result.jobs.length,
                      result.total
                    )}{' '}
                    of {result.total} · Page {result.page} of {pageCount}
                  </span>
                  <nav aria-label="Catalog pages" className={classes.pagination}>
                    {result.page > 1 ? (
                      <a href={catalogHref(filters, { page: result.page - 1 })}>Previous page</a>
                    ) : (
                      <span aria-disabled="true">Previous page</span>
                    )}
                    {result.page < pageCount ? (
                      <a href={catalogHref(filters, { page: result.page + 1 })}>Next page</a>
                    ) : (
                      <span aria-disabled="true">Next page</span>
                    )}
                  </nav>
                  <p className={classes.catalogNote}>
                    Private, read-only catalog. Collection runs only when invoked manually. Source
                    identities are kept separate.
                  </p>
                </footer>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
