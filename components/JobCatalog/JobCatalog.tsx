import { preparationHref } from '../../assistance/links';
import type { Compensation, Provider, RunReport } from '../../collector/types';
import { catalogHref } from '../../jobs/filters';
import type { CatalogJob, CatalogResult } from '../../jobs/types';
import { SiteHeader } from '../SiteHeader/SiteHeader';
import classes from './JobCatalog.module.css';

const providerNames: Record<Provider, string> = {
  ashby: 'Ashby',
  greenhouse: 'Greenhouse',
  hirebase: 'Hirebase',
};

function ObservationDate({ value, compact = false }: { value: string | null; compact?: boolean }) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    return <>Not reported</>;
  }
  return (
    <time dateTime={date.toISOString()}>
      {new Intl.DateTimeFormat('en', {
        ...(compact
          ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
          : { dateStyle: 'medium', timeStyle: 'short' }),
        timeZone: 'UTC',
      }).format(date)}{' '}
      UTC
    </time>
  );
}

function compensationText(component: Compensation, compact = false): string {
  const number = (value: number) =>
    new Intl.NumberFormat('en', {
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: 20,
    })
      .format(value)
      .replace(/K$/, 'k');
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
  const kind =
    compact && /^(base( salary)?|salary)$/i.test(component.kind ?? '')
      ? ''
      : `${component.kind ?? 'Compensation (kind not reported)'}: `;
  const period =
    compact && component.period
      ? ` / ${component.period}`
      : ` · ${component.period ?? 'period not reported'}`;
  return `${kind}${component.currency ?? 'Currency not reported'} ${amount}${period}`;
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

type CollectionStatus = RunReport['status'] | 'skipped';

const statusLabels: Record<RunReport['status'], string> = {
  success: 'Refresh complete',
  partial: 'Partial refresh',
  failed: 'Refresh failed',
  running: 'Refreshing',
  interrupted: 'Refresh interrupted',
};

const statusPaths: Record<CollectionStatus, string> = {
  success: 'm5 12 4 4L19 6',
  failed: 'm6 6 12 12M18 6 6 18',
  partial: 'M12 3 2.5 20h19ZM12 9v4m0 3v.01',
  interrupted: 'M8 5v14M16 5v14',
  running: 'M21 12a9 9 0 1 1-9-9',
  skipped: 'M5 12h14',
};

function CollectionIcon({ status }: { status: CollectionStatus }) {
  return (
    <svg
      className={classes.statusIcon}
      data-status={status}
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={statusPaths[status]} />
    </svg>
  );
}

function CollectionReport({ report }: { report: RunReport | null }) {
  if (!report) {
    return <p className={`${classes.metadata} ${classes.noRun}`}>Not collected yet.</p>;
  }
  const hasHirebase = report.sources.some((source) => source.provider === 'hirebase');
  return (
    <aside className={classes.report} aria-label="Collection status">
      <details>
        <summary className={classes.reportSummary}>
          <span className={classes.reportLabel}>
            <CollectionIcon status={report.status} />
            {statusLabels[report.status]}
          </span>
          <span className={classes.reportDate}>
            <ObservationDate value={report.finishedAt ?? report.startedAt} compact />
          </span>
          <span className={classes.reportToggle}>
            Details
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </span>
        </summary>
        <div className={classes.reportDetails}>
          <ul className={classes.sourceReports}>
            {report.sources.map((source) => (
              <li key={`${source.provider}:${source.source}`}>
                <div className={classes.sourceHeading}>
                  <CollectionIcon status={source.status} />
                  <span className={classes.sourceOutcome}>
                    {providerNames[source.provider]} · {source.source}
                  </span>
                  <span className={classes.metadata}>
                    {source.status} ·{' '}
                    {source.complete
                      ? 'Complete'
                      : source.provider === 'hirebase' && source.status === 'success'
                        ? 'Limited sample'
                        : 'Incomplete'}
                  </span>
                </div>
                <p className={classes.metadata}>
                  {source.fetched} fetched · {source.retained} retained · {source.deactivated}{' '}
                  deactivated
                </p>
                {source.message && <p className={classes.sourceMessage}>{source.message}</p>}
              </li>
            ))}
          </ul>
          {hasHirebase && (
            <dl className={classes.budget} aria-label="Hirebase usage">
              {[
                ['Requested', report.hirebase.requestedBudget],
                ['Reserved', report.hirebase.reserved],
                ['Returned', report.hirebase.returned],
                ['Uncertain', report.hirebase.uncertain],
                ['Provider remaining', report.hirebase.providerRemaining ?? 'Not reported'],
                ['UTC month', report.hirebase.period],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <dl className={classes.runDates}>
            <div>
              <dt>Started</dt>
              <dd>
                <ObservationDate value={report.startedAt} />
              </dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>
                {report.finishedAt ? <ObservationDate value={report.finishedAt} /> : 'Not finished'}
              </dd>
            </div>
          </dl>
        </div>
      </details>
    </aside>
  );
}

function JobRow({ entry }: { entry: CatalogJob }) {
  const { job } = entry;
  const original = externalHref(job.jobUrl);
  const application = externalHref(job.applicationUrl);
  const upstream = externalHref(job.upstreamSource?.boardUrl ?? null);
  const warnings = [
    ...(entry.refreshStatus === 'failed' || entry.refreshStatus === 'partial'
      ? [`Latest refresh ${entry.refreshStatus}; previous observations may be stale.`]
      : []),
    ...(job.detailsComplete === false
      ? ['Job details incomplete; previously collected pay may be stale.']
      : []),
  ];
  return (
    <details className={classes.job}>
      <summary className={classes.summary}>
        <span className={classes.jobHeading}>
          <span className={classes.jobTitle}>{job.title}</span>
          <span className={classes.companyName}>{job.company}</span>
        </span>
        <span className={classes.pay}>
          <span>
            {job.compensation.length ? (
              job.compensation.map((component, index) => (
                <span className={classes.payComponent} key={index}>
                  {compensationText(component, true)}
                </span>
              ))
            ) : (
              <span className={classes.metadata}>Salary not listed</span>
            )}
          </span>
          {warnings.length > 0 && (
            <span
              className={classes.payWarning}
              role="img"
              aria-label={warnings.join(' ')}
              title={warnings.join(' ')}
            >
              <CollectionIcon status="partial" />
            </span>
          )}
        </span>
        <span className={classes.location}>
          {job.locations.length
            ? job.locations
                .map(
                  (location) =>
                    location.text ||
                    [location.city, location.region, location.country].filter(Boolean).join(', ') ||
                    'Not specified'
                )
                .join(' · ')
            : 'Location not specified'}
        </span>
        <svg
          className={classes.chevron}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden="true"
        >
          <path d="m7 4 6 6-6 6" />
        </svg>
      </summary>
      <div className={classes.details}>
        <div className={classes.detailHeading}>
          <div>
            <h3>{job.company}</h3>
            <p className={classes.metadata}>
              {job.employmentType ?? 'Employment type not specified'} ·{' '}
              {entry.active ? 'Active' : 'Inactive'}
            </p>
          </div>
          <div className={classes.actions}>
            <a className={classes.textAction} href={preparationHref(job.source, job.sourceJobId)}>
              Prepare drafts
            </a>
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
        {warnings.map((warning) => (
          <p className={classes.warning} key={warning}>
            {warning}
          </p>
        ))}
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
        <SiteHeader activePage="jobs" />
        <main className={classes.main} aria-label="Job catalog">
          <form
            method="get"
            action="/jobs"
            className={classes.filters}
            aria-label="Filter collected jobs"
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
          {result.kind === 'unavailable' ? (
            <section role="alert" className={classes.unavailable}>
              <h2>Catalog unavailable</h2>
              <p>
                {result.reason === 'configuration'
                  ? 'Configure the local database connection, then apply the documented database migrations.'
                  : 'Check that the local database is reachable and its migrations have been applied.'}
              </p>
            </section>
          ) : (
            <>
              <section aria-labelledby="catalog-heading">
                <div className={classes.listHeading}>
                  <div className={classes.resultCount}>
                    <h2 id="catalog-heading">
                      {result.total} {result.total === 1 ? 'job' : 'jobs'}
                    </h2>
                    <span>
                      {filters.includeInactive ? 'Active and inactive listings' : 'Active listings'}
                    </span>
                  </div>
                  <CollectionReport report={result.lastRun} />
                </div>
                {result.jobs.length > 0 && (
                  <div className={classes.columnHeadings} aria-hidden="true">
                    <span>Job title</span>
                    <span>Salary</span>
                    <span>Reported location</span>
                    <span />
                  </div>
                )}
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
                        <a href={clearHref}>Clear filters</a>
                      </p>
                    ) : (
                      <p>
                        Enable saved searches and employer boards in the local configuration, then
                        run <code>yarn collect --hirebase-budget 0</code> for enabled boards.
                      </p>
                    )}
                  </div>
                )}
                <div className={classes.listOptions}>
                  <span>Most recently observed first</span>
                  <a
                    href={catalogHref(filters, {
                      includeInactive: !filters.includeInactive,
                      page: 1,
                    })}
                  >
                    {filters.includeInactive ? 'Hide inactive' : 'Include inactive'}
                  </a>
                </div>
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
                </footer>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
