import { boardKey, boardUrl } from './config';
import { mapBounded, type ProviderHttp } from './http';
import { collectLeverBoard } from './lever';
import { normalizeCountry } from './matching';
import {
  record,
  array,
  text,
  requiredText,
  jobId,
  number,
  safeUrl,
  timestamp,
  arrangement,
  htmlToText,
  explicitCountry,
} from './normalize';
import type { Board, CollectedJob, Compensation, ReportedLocation } from './types';

const MAX_JOBS = 2000;
const LIMIT_MESSAGE = 'Board job limit reached; board refresh is incomplete.';
const DETAIL_MESSAGE =
  'Some Greenhouse job details could not be validated; board refresh is incomplete.';

type Data = Record<string, unknown>;
type BoardResult = {
  jobs: CollectedJob[];
  complete: boolean;
  fetched: number;
  message: string | null;
};

// Complete-snapshot contract: see collector/SPEC.md.
function envelope(data: Data, keys: string[]): void {
  if (Object.keys(data).some((key) => !keys.includes(key))) {
    throw new Error('Provider returned an unsupported board response envelope');
  }
}

function optionalRecord(value: unknown): Data {
  return value == null ? {} : record(value);
}

function optionalArray(value: unknown): unknown[] {
  return value == null ? [] : array(value);
}

function optionalText(value: unknown): string | null {
  if (value != null && typeof value !== 'string') {
    throw new Error('Provider returned an invalid text field');
  }
  return text(value);
}

function originalContent(value: unknown): string | null {
  optionalText(value);
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  const result = number(value);
  if (value != null && result === null) {
    throw new Error('Provider returned an invalid compensation amount');
  }
  return result;
}

function uniqueIds<T>(items: T[], identify: (item: T) => string): void {
  const ids = new Set<string>();
  for (const item of items) {
    const id = identify(item);
    if (ids.has(id)) {
      throw new Error('Provider returned duplicate job identifiers');
    }
    ids.add(id);
  }
}

function reportedLocation(label: string | null, address: Data = {}): ReportedLocation {
  return {
    text: label,
    city: optionalText(address.addressLocality),
    region: optionalText(address.addressRegion),
    country: normalizeCountry(optionalText(address.addressCountry)) ?? explicitCountry(label),
  };
}

function hasLocation(location: ReportedLocation): boolean {
  return Object.values(location).some((value) => value !== null);
}

function ashbyLocations(data: Data): ReportedLocation[] {
  const address = optionalRecord(data.address);
  const primary = reportedLocation(
    optionalText(data.location),
    address.postalAddress == null ? address : record(address.postalAddress)
  );
  const secondary = optionalArray(data.secondaryLocations).map((value) => {
    const item = record(value);
    const secondaryAddress = optionalRecord(item.address);
    return reportedLocation(
      optionalText(item.location),
      secondaryAddress.postalAddress == null
        ? secondaryAddress
        : record(secondaryAddress.postalAddress)
    );
  });
  return [primary, ...secondary].filter(hasLocation);
}

function ashbyId(data: Data, canonicalUrl: string): string {
  if (data.id != null) {
    return jobId(data.id);
  }
  // Source-identity fallback: see collector/SPEC.md.
  const prefix = `${canonicalUrl}/`;
  const url = requiredText(data.jobUrl);
  if (!url.startsWith(prefix)) {
    throw new Error('Ashby job is missing a same-board identifier');
  }
  return jobId(url.slice(prefix.length));
}

function ashbyCompensation(value: unknown): Compensation[] {
  if (value == null) {
    return [];
  }
  const data = record(value);
  const summary =
    optionalText(data.compensationTierSummary) ??
    optionalText(data.scrapeableCompensationSalarySummary);
  const summarized = optionalArray(data.summaryComponents);
  const tiers = optionalArray(data.compensationTiers).map((value) => record(value));
  const components =
    summarized.length > 0
      ? summarized.map((value) => ({ data: record(value), summary }))
      : tiers.flatMap((tier) =>
          optionalArray(tier.components).map((value) => ({
            data: record(value),
            summary: optionalText(tier.tierSummary) ?? summary,
          }))
        );
  if (components.length === 0 && summary) {
    return [{ min: null, max: null, currency: null, period: null, kind: null, summary }];
  }
  return components.map(({ data, summary }) => ({
    min: optionalNumber(data.minValue),
    max: optionalNumber(data.maxValue),
    currency: optionalText(data.currencyCode),
    period: optionalText(data.interval),
    kind: optionalText(data.compensationType),
    summary: optionalText(data.summary) ?? summary,
  }));
}

function ashbyJob(board: Board, source: string, data: Data, id: string): CollectedJob {
  const html = originalContent(data.descriptionHtml);
  const plain = optionalText(data.descriptionPlain);
  const workplace = optionalText(data.workplaceType);
  return {
    provider: 'ashby',
    source,
    sourceJobId: id,
    title: requiredText(data.title),
    company: board.company,
    jobUrl: safeUrl(data.jobUrl),
    applicationUrl: safeUrl(data.applyUrl),
    descriptionHtml: html,
    descriptionText: plain ?? htmlToText(html),
    descriptionComplete:
      typeof data.descriptionHtml === 'string' || typeof data.descriptionPlain === 'string',
    locations: ashbyLocations(data),
    // isRemote is also true for Hybrid; it is deliberately not a fallback.
    workArrangement: arrangement(workplace),
    reportedWorkArrangement: workplace,
    employmentType: optionalText(data.employmentType),
    compensation: ashbyCompensation(data.compensation),
    reportedCompensation: data.compensation ?? null,
    sourcePostedAt: timestamp(data.publishedAt),
    sourceUpdatedAt: timestamp(data.updatedAt),
    upstreamSource: null,
  };
}

function greenhouseLocations(data: Data): ReportedLocation[] {
  const primary = reportedLocation(optionalText(optionalRecord(data.location).name));
  const offices = optionalArray(data.offices).map((value) => {
    const office = record(value);
    return reportedLocation(optionalText(office.location) ?? optionalText(office.name));
  });
  return [primary, ...offices].filter(hasLocation);
}

function greenhouseMetadata(data: Data, names: string[]): string | null {
  for (const value of optionalArray(data.metadata)) {
    const field = record(value);
    const name = text(field.name)
      ?.toLowerCase()
      .replace(/[\s_-]+/g, '');
    if (
      name &&
      names.includes(name) &&
      ['text', 'single_select'].includes(String(field.value_type))
    ) {
      const value = optionalText(field.value);
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function greenhouseJob(board: Board, source: string, data: Data, id: string): CollectedJob {
  const html = originalContent(data.content);
  const workplace =
    optionalText(data.workplace_type) ??
    optionalText(data.workplaceType) ??
    optionalText(data.work_arrangement) ??
    optionalText(data.workArrangement) ??
    greenhouseMetadata(data, ['workplacetype', 'workarrangement']);
  const url = safeUrl(data.absolute_url);
  return {
    provider: 'greenhouse',
    source,
    sourceJobId: id,
    title: requiredText(data.title),
    company: optionalText(data.company_name) ?? board.company,
    jobUrl: url,
    applicationUrl: url,
    descriptionHtml: html,
    descriptionText: htmlToText(html),
    descriptionComplete: typeof data.content === 'string',
    locations: greenhouseLocations(data),
    workArrangement: arrangement(workplace),
    reportedWorkArrangement: workplace,
    employmentType:
      optionalText(data.employment_type) ?? greenhouseMetadata(data, ['employmenttype']),
    compensation: [],
    reportedCompensation: null,
    sourcePostedAt: timestamp(data.first_published),
    sourceUpdatedAt: timestamp(data.updated_at),
    upstreamSource: null,
  };
}

function greenhouseCompensation(value: unknown): Compensation[] {
  return optionalArray(value).map((value) => {
    const range = record(value);
    if (
      !Object.hasOwn(range, 'min_cents') ||
      !Object.hasOwn(range, 'max_cents') ||
      (!Object.hasOwn(range, 'currency_type') && !Object.hasOwn(range, 'currency_code'))
    ) {
      throw new Error('Greenhouse returned an unsupported pay range');
    }
    const min = optionalNumber(range.min_cents);
    const max = optionalNumber(range.max_cents);
    return {
      min: min === null ? null : min / 100,
      max: max === null ? null : max / 100,
      currency: optionalText(range.currency_type) ?? optionalText(range.currency_code),
      period: null,
      kind: optionalText(range.title),
      summary: optionalText(range.blurb),
    };
  });
}

export async function collectBoard(
  board: Board,
  http: ProviderHttp,
  options: { concurrency?: number; maxJobs?: number } = {}
): Promise<BoardResult> {
  const source = boardKey(board);
  const canonicalUrl = boardUrl(board.provider, board.slug);
  if (board.boardUrl !== canonicalUrl) {
    throw new Error('Board URL does not match the canonical provider and slug');
  }
  const requestedLimit = options.maxJobs ?? MAX_JOBS;
  const concurrency = options.concurrency ?? 2;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error('Board job limit must be a positive safe integer');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error('Provider concurrency must be between 1 and 4');
  }
  const limit = Math.min(requestedLimit, MAX_JOBS);

  if (board.provider === 'lever') {
    return collectLeverBoard(board, source, http, limit);
  }

  if (board.provider === 'ashby') {
    const { data: response } = await http.request(
      `https://api.ashbyhq.com/posting-api/job-board/${board.slug}?includeCompensation=true`
    );
    const data = record(response);
    envelope(data, ['apiVersion', 'jobs']);
    if (data.apiVersion !== '1') {
      throw new Error('Ashby returned an unsupported API version');
    }
    const items = array(data.jobs).map((value) => {
      const data = record(value);
      const id = ashbyId(data, canonicalUrl);
      requiredText(data.title);
      if (data.isListed != null && typeof data.isListed !== 'boolean') {
        throw new Error('Ashby returned an invalid listing visibility');
      }
      return { data, id };
    });
    // Include unlisted IDs in validation, but never return unlisted content.
    uniqueIds(items, (item) => item.id);
    const complete = items.length <= limit;
    const jobs = items
      .slice(0, limit)
      .filter(({ data }) => data.isListed !== false)
      .map(({ data, id }) => ashbyJob(board, source, data, id));
    return { jobs, complete, fetched: items.length, message: complete ? null : LIMIT_MESSAGE };
  }

  const endpoint = `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs`;
  const { data: response } = await http.request(`${endpoint}?content=true`);
  const data = record(response);
  envelope(data, ['jobs', 'meta']);
  const meta = record(data.meta);
  envelope(meta, ['total']);
  const items = array(data.jobs).map((value) => {
    const data = record(value);
    const id = jobId(data.id);
    return { data, id, job: greenhouseJob(board, source, data, id) };
  });
  if (!Number.isSafeInteger(meta.total) || meta.total !== items.length) {
    throw new Error('Greenhouse board count does not match the full job list');
  }
  uniqueIds(items, (item) => item.id);
  let detailFailed = false;
  const jobs = await mapBounded(items.slice(0, limit), Math.min(concurrency, 2), async (item) => {
    try {
      const { data: response } = await http.request(`${endpoint}/${item.id}?pay_transparency=true`);
      const detail = record(response);
      if (jobId(detail.id) !== item.id) {
        throw new Error('Greenhouse detail returned a different job identifier');
      }
      const merged = { ...item.data, ...detail };
      // Partial detail responses must not erase the full list's content/facts.
      for (const key of [
        'content',
        'location',
        'offices',
        'metadata',
        'absolute_url',
        'updated_at',
        'first_published',
      ]) {
        merged[key] = detail[key] ?? item.data[key];
      }
      return {
        ...greenhouseJob(board, source, merged, item.id),
        compensation: greenhouseCompensation(detail.pay_input_ranges),
        reportedCompensation: detail.pay_input_ranges ?? null,
      };
    } catch {
      detailFailed = true;
      return { ...item.job, detailsComplete: false };
    }
  });
  const complete = !detailFailed && items.length <= limit;
  return {
    jobs,
    complete,
    fetched: items.length,
    message: detailFailed ? DETAIL_MESSAGE : complete ? null : LIMIT_MESSAGE,
  };
}
