import { ProviderError, ProviderHttp } from './http';
import { normalizeCountry } from './matching';
import {
  array,
  arrangement,
  compensation,
  htmlToText,
  jobId,
  location,
  record,
  requiredText,
  safeUrl,
  text,
  timestamp,
} from './normalize';
import type { CollectedJob, SavedSearch, SourceResult } from './types';

export interface FreeUsage {
  used: number;
  remaining: number;
  period: string;
}

export interface UsageLedger {
  used: number;
  reserve(amount: number, searchId: string): Promise<string>;
  settle(reservation: string, returned: number | null): Promise<void>;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('Provider pagination or usage is invalid');
  }
  return value as number;
}

export async function freeUsage(
  http: ProviderHttp,
  key: string,
  now = new Date()
): Promise<FreeUsage> {
  const { data } = await http.request('https://api.hirebase.org/v2/billing/usage/summary', {
    headers: { 'x-api-key': key },
  });
  const usage = record(data);
  const plans = array(usage.plan_lookup_keys);
  const meters = array(usage.meters).map(record);
  const meter = meters.find((entry) => entry.event_name === 'm_jobs_api_calls');
  if (
    !meter ||
    usage.billing_source !== 'stripe_v2' ||
    usage.subscription_status !== null ||
    meters.filter((entry) => entry.event_name === 'm_jobs_api_calls').length !== 1 ||
    usage.period_start !== null ||
    usage.period_end !== null ||
    plans.some((plan) => plan !== 'plan_free' && plan !== 'free') ||
    meter.included !== 500 ||
    meter.overage_mode !== 'block' ||
    integer(meter.overage_used) !== 0
  ) {
    throw new Error(
      'Hirebase requires a verified Free, hard-capped jobs allowance; refusing unknown or paid usage'
    );
  }
  const used = integer(meter.used);
  const remaining = integer(meter.remaining);
  if (used > 500 || remaining > 500 - used) {
    throw new Error('Hirebase reported inconsistent allowance');
  }
  return { used, remaining, period: now.toISOString().slice(0, 7) };
}

export function normalizeHirebase(value: unknown): CollectedJob {
  const data = record(value);
  const html = text(data.description_raw) ?? text(data.description);
  const salary = data.salary_range == null ? null : record(data.salary_range);
  const reportedArrangement = text(data.location_type);
  const locations =
    data.locations == null
      ? []
      : array(data.locations).map((entry) => {
          const item = record(entry);
          return location({
            ...item,
            text: text(item.address),
            country: normalizeCountry(text(item.country)),
          });
        });
  const rawLocation = text(data.location_raw);
  if (rawLocation && !locations.some((entry) => entry.text === rawLocation)) {
    locations.push({ text: rawLocation, city: null, region: null, country: null });
  }
  return {
    provider: 'hirebase',
    source: 'hirebase',
    sourceJobId: jobId(data._id),
    title: requiredText(text(data.job_title_raw) ?? data.job_title),
    company: requiredText(data.company_name),
    jobUrl: safeUrl(data.application_link),
    applicationUrl: safeUrl(data.application_link),
    descriptionHtml: html,
    descriptionText: htmlToText(html),
    descriptionComplete: text(data.description_raw) !== null,
    locations,
    workArrangement: arrangement(reportedArrangement),
    reportedWorkArrangement: reportedArrangement,
    employmentType: text(data.job_type),
    compensation: salary
      ? [
          compensation({
            ...salary,
            period:
              salary.period === 'year'
                ? 'yearly'
                : salary.period === 'hour'
                  ? 'hourly'
                  : salary.period,
            kind: 'salary',
          }),
        ]
      : [],
    reportedCompensation: salary,
    sourcePostedAt: timestamp(data.date_posted),
    sourceUpdatedAt: null,
    upstreamSource: {
      provider: text(data.job_board),
      jobId: text(data.platform_job_id),
      boardUrl: safeUrl(data.job_board_link),
    },
  };
}

export interface HirebaseCollection {
  sources: SourceResult[];
  reserved: number;
  returned: number;
  uncertain: number;
  providerRemaining: number;
}

function requestFilters(search: SavedSearch): Record<string, unknown> {
  const filters: Record<string, unknown> = {
    job_titles: search.titlePhrases.map((phrase) => JSON.stringify(phrase)),
    return_raw_description: 'true',
    sort_by: 'date_posted',
    sort_order: 'desc',
  };
  if (search.countries.length && !search.locationPhrases.length && !search.allowUnknownLocation) {
    filters.geo_locations = search.countries.map((country) => ({
      country: normalizeCountry(country) === 'US' ? 'United States' : 'Canada',
    }));
    filters.geofilter_params = { mode: 'strict' };
  }
  if (search.workArrangements.length && !search.allowUnknownWorkArrangement) {
    filters.location_types = search.workArrangements.map(
      (style) => ({ remote: 'Remote', hybrid: 'Hybrid', onsite: 'In-Person' })[style]
    );
  }
  return filters;
}

/** Choose a smaller page size only when it preserves the already-consumed offset. */
export function alignedPageSize(offset: number, cap: number): number {
  for (let size = Math.min(20, cap); size >= 1; size -= 1) {
    if (offset % size === 0) {
      return size;
    }
  }
  return 0;
}

export async function collectHirebase(options: {
  http: ProviderHttp;
  key: string;
  searches: SavedSearch[];
  budget: number;
  usage: FreeUsage;
  ledger: UsageLedger;
  onJobs: (jobs: CollectedJob[]) => Promise<number>;
  maxPagesPerSearch?: number;
  now?: () => Date;
}): Promise<HirebaseCollection> {
  if (!Number.isInteger(options.budget) || options.budget < 0 || options.budget > 500) {
    throw new Error('Hirebase invocation budget must be an integer between 0 and 500');
  }
  const { http, key, usage, ledger } = options;
  const searches = options.searches.filter((search) => search.enabled);
  const rotation = searches.length ? ledger.used % searches.length : 0;
  const ordered = [...searches.slice(rotation), ...searches.slice(0, rotation)];
  const states = ordered.map((search) => ({
    search,
    offset: 0,
    calls: 0,
    done: false,
    result: {
      source: `hirebase:${search.id}`,
      provider: 'hirebase' as const,
      status: 'success' as SourceResult['status'],
      complete: false,
      fetched: 0,
      retained: 0,
      deactivated: 0,
      message: null as string | null,
    },
  }));
  let available = Math.max(0, Math.min(options.budget, usage.remaining, 500 - ledger.used));
  const result: HirebaseCollection = {
    sources: states.map((state) => state.result),
    reserved: 0,
    returned: 0,
    uncertain: 0,
    providerRemaining: usage.remaining,
  };
  let stop = false;
  while (available > 0 && !stop) {
    const active = states.filter((state) => !state.done);
    if (!active.length) {
      break;
    }
    active.sort((left, right) => left.result.fetched - right.result.fetched);
    const state = active[0];
    if ((options.now?.() ?? new Date()).toISOString().slice(0, 7) !== usage.period) {
      for (const pending of states.filter((entry) => !entry.done)) {
        pending.done = true;
        pending.result.status = 'partial';
        pending.result.message =
          'UTC month changed; invoke collection again to verify the new allowance';
      }
      stop = true;
      break;
    }
    if (state.calls >= (options.maxPagesPerSearch ?? 500)) {
      state.done = true;
      state.result.status = 'partial';
      state.result.message = 'Hirebase search reached the page safety limit';
      continue;
    }
    const nextLevel = active.find((entry) => entry.result.fetched > state.result.fetched)?.result
      .fetched;
    const share =
      nextLevel === undefined
        ? Math.max(1, Math.floor(available / active.length))
        : nextLevel - state.result.fetched;
    const limit = alignedPageSize(state.offset, Math.min(share, available));
    if (!limit) {
      continue;
    }
    const page = state.offset / limit + 1;
    const reservation = await ledger.reserve(limit, state.search.id);
    available -= limit;
    result.reserved += limit;
    let charged: number | null = null;
    let unsafeAllowance = false;
    try {
      const response = await http.request('https://api.hirebase.org/v2/jobs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ ...requestFilters(state.search), limit, page }),
      });
      const envelope = record(response.data);
      const rawJobs = array(envelope.jobs);
      if (rawJobs.length > limit) {
        throw new Error('Hirebase returned more records than requested');
      }
      charged = rawJobs.length;
      result.returned += charged;
      state.result.fetched += charged;
      const reportedRemaining = response.headers.get('Hirebase-Usage-Included-Remaining');
      result.providerRemaining = Math.max(0, result.providerRemaining - charged);
      if (reportedRemaining !== null) {
        result.providerRemaining = Math.min(
          result.providerRemaining,
          integer(Number(reportedRemaining))
        );
      }
      const overage = response.headers.get('Hirebase-Usage-Overage-Mode');
      if (overage !== null && overage !== 'block') {
        unsafeAllowance = true;
        throw new Error('Hirebase allowance safety changed during collection');
      }
      if (
        integer(envelope.page) !== page ||
        integer(envelope.limit) !== limit ||
        integer(envelope.total_pages) !== Math.ceil(integer(envelope.total_count) / limit)
      ) {
        throw new Error('Hirebase returned inconsistent pagination');
      }
      const jobs = rawJobs.map(normalizeHirebase);
      if (new Set(jobs.map((job) => job.sourceJobId)).size !== jobs.length) {
        throw new Error('Hirebase page contains duplicate identities');
      }
      state.result.retained += await options.onJobs(jobs);
      state.offset += rawJobs.length;
      state.calls += 1;
      if (rawJobs.length < limit || page >= integer(envelope.total_pages)) {
        state.done = true;
        state.result.complete = true;
      }
    } catch (error) {
      if (error instanceof ProviderError && error.definitelyUnbilled) {
        charged = 0;
      }
      state.result.status = state.result.fetched ? 'partial' : 'failed';
      state.result.message =
        error instanceof ProviderError
          ? error.message
          : 'Hirebase response or persistence could not be verified';
      state.done = true;
      if (unsafeAllowance) {
        stop = true;
        state.result.message = 'Hirebase allowance safety changed; all metered searches stopped';
      }
      // Unknown execution may have spent the full reservation; do not replay or spend its share elsewhere.
      if (charged === null) {
        result.uncertain += limit;
        stop = true;
      }
      if (error instanceof ProviderError && [401, 403, 429].includes(error.status ?? 0)) {
        stop = true;
      }
    } finally {
      await ledger.settle(reservation, charged);
    }
    if (charged !== null) {
      available += limit - charged;
    }
    available = Math.max(0, Math.min(available, result.providerRemaining));
    if (stop) {
      break;
    }
  }
  for (const state of states) {
    if (!state.done) {
      state.result.message = stop
        ? 'Hirebase stopped after another search failed'
        : 'Hirebase invocation or monthly allowance reached';
      state.result.status = stop ? 'partial' : 'success';
    }
  }
  return result;
}
