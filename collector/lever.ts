import type { ProviderHttp } from './http';
import { normalizeCountry } from './matching';
import {
  record,
  array,
  text,
  requiredText,
  jobId,
  number,
  safeUrl,
  arrangement,
  htmlToText,
  explicitCountry,
} from './normalize';
import type { Board, CollectedJob, Compensation, ReportedLocation } from './types';

const PAGE_SIZE = 100;
const LIMIT_MESSAGE = 'Board job limit reached; board refresh is incomplete.';
const PAGE_MESSAGE =
  'Lever posting pagination failed or could not be validated; board refresh is incomplete.';

type Data = Record<string, unknown>;

function optionalText(value: unknown): string | null {
  if (value != null && typeof value !== 'string') {
    throw new Error('Lever returned an invalid text field');
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
    throw new Error('Lever returned an invalid compensation amount');
  }
  return result;
}

function joinContent(parts: (string | null)[], separator: string): string | null {
  const present = parts.filter((part) => part !== null);
  return present.length > 0 ? present.join(separator) : null;
}

function description(data: Data) {
  const combined = originalContent(data.description);
  const combinedPlain = optionalText(data.descriptionPlain);
  const opening = originalContent(data.opening);
  const openingPlain = optionalText(data.openingPlain);
  const body = originalContent(data.descriptionBody);
  const bodyPlain = optionalText(data.descriptionBodyPlain);
  const additional = originalContent(data.additional);
  const additionalPlain = optionalText(data.additionalPlain);
  const salary = originalContent(data.salaryDescription);
  const salaryPlain = optionalText(data.salaryDescriptionPlain);
  const lists = (data.lists == null ? [] : array(data.lists)).map((value) => {
    const list = record(value);
    return { heading: optionalText(list.text), html: originalContent(list.content) };
  });

  return {
    // Description composition: see collector/SPEC.md.
    html: joinContent(
      [
        combined ?? joinContent([opening, body], '\n'),
        ...lists.map((list) => list.html),
        additional,
        salary,
      ],
      '\n'
    ),
    plain: joinContent(
      [
        combinedPlain ??
          htmlToText(combined) ??
          joinContent([openingPlain ?? htmlToText(opening), bodyPlain ?? htmlToText(body)], '\n\n'),
        ...lists.flatMap((list) => [list.heading, htmlToText(list.html)]),
        additionalPlain ?? htmlToText(additional),
        salaryPlain ?? htmlToText(salary),
      ],
      '\n\n'
    ),
    complete: [
      data.description,
      data.descriptionPlain,
      data.descriptionBody,
      data.descriptionBodyPlain,
    ].some((value) => typeof value === 'string'),
    salarySummary: salaryPlain ?? htmlToText(salary),
  };
}

function locations(data: Data, categories: Data): ReportedLocation[] {
  const primaryText = optionalText(categories.location);
  const primary: ReportedLocation = {
    text: primaryText,
    city: null,
    region: null,
    country: normalizeCountry(optionalText(data.country)) ?? explicitCountry(primaryText),
  };
  const result = primary.text !== null || primary.country !== null ? [primary] : [];
  const seen = new Set([primaryText]);
  for (const value of categories.allLocations == null ? [] : array(categories.allLocations)) {
    const label = optionalText(value);
    if (label !== null && !seen.has(label)) {
      // Primary-country scope: see collector/SPEC.md.
      result.push({ text: label, city: null, region: null, country: explicitCountry(label) });
      seen.add(label);
    }
  }
  return result;
}

function compensation(data: Data, summary: string | null): Compensation[] {
  if (data.salaryRange == null && summary === null) {
    return [];
  }
  const range = data.salaryRange == null ? {} : record(data.salaryRange);
  return [
    {
      min: optionalNumber(range.min),
      max: optionalNumber(range.max),
      currency: optionalText(range.currency),
      period: optionalText(range.interval),
      kind: null,
      summary,
    },
  ];
}

function leverJob(board: Board, source: string, value: unknown): CollectedJob {
  const data = record(value);
  const categories = data.categories == null ? {} : record(data.categories);
  const content = description(data);
  const workplace = optionalText(data.workplaceType);
  return {
    provider: 'lever',
    source,
    sourceJobId: jobId(data.id),
    title: requiredText(data.text),
    company: board.company,
    jobUrl: safeUrl(data.hostedUrl),
    applicationUrl: safeUrl(data.applyUrl),
    descriptionHtml: content.html,
    descriptionText: content.plain,
    descriptionComplete: content.complete,
    locations: locations(data, categories),
    workArrangement: arrangement(workplace),
    reportedWorkArrangement: workplace,
    employmentType: optionalText(categories.commitment),
    compensation: compensation(data, content.salarySummary),
    reportedCompensation: data.salaryRange ?? null,
    // Timestamp semantics: see collector/SPEC.md.
    sourcePostedAt: null,
    sourceUpdatedAt: null,
    upstreamSource: null,
  };
}

/** Called only after collectBoard validates the board identity and clamps its limit. */
export async function collectLeverBoard(
  board: Board,
  source: string,
  http: ProviderHttp,
  limit: number
) {
  const jobs: CollectedJob[] = [];
  const ids = new Set<string>();
  let fetched = 0;
  for (;;) {
    // Completion and ceiling/lookahead contract: see collector/SPEC.md.
    const lookahead = jobs.length === limit;
    const pageSize = lookahead ? 1 : Math.min(PAGE_SIZE, limit - jobs.length);
    let page: CollectedJob[];
    try {
      const { data } = await http.request(
        `https://api.lever.co/v0/postings/${board.slug}?mode=json&skip=${jobs.length}&limit=${pageSize}`
      );
      const items = array(data);
      fetched += items.length;
      if (items.length > pageSize) {
        throw new Error('Lever returned an oversized posting page');
      }
      page = items.map((value) => leverJob(board, source, value));
      const pageIds = new Set<string>();
      for (const job of page) {
        if (ids.has(job.sourceJobId) || pageIds.has(job.sourceJobId)) {
          throw new Error('Lever returned duplicate job identifiers');
        }
        pageIds.add(job.sourceJobId);
      }
    } catch (error) {
      if (jobs.length === 0) {
        throw error;
      }
      // Partial-page lifecycle: see collector/SPEC.md.
      return { jobs, complete: false, fetched, message: PAGE_MESSAGE };
    }
    if (lookahead) {
      const complete = page.length === 0;
      return { jobs, complete, fetched, message: complete ? null : LIMIT_MESSAGE };
    }
    for (const job of page) {
      ids.add(job.sourceJobId);
      jobs.push(job);
    }
    if (page.length < pageSize) {
      return { jobs, complete: true, fetched, message: null };
    }
  }
}
