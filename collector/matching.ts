import type { CollectedJob, ReportedLocation, SavedSearch } from './types';

/** Preserve foreign reported facts instead of turning them into an unknown/US location. */
export function normalizeCountry(value: string | null | undefined): string | null {
  const country = value?.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
  if (!country) {
    return null;
  }
  if (['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(country)) {
    return 'US';
  }
  if (['CA', 'CAN', 'CANADA'].includes(country)) {
    return 'CA';
  }
  return country;
}

function words(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function includesPhrase(value: string, phrase: string): boolean {
  const normalizedPhrase = words(phrase);
  return normalizedPhrase.length > 0 && ` ${words(value)} `.includes(` ${normalizedPhrase} `);
}

function reportedLocationText(location: ReportedLocation): string {
  return [...new Set([location.text, location.city, location.region, location.country])]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim())
    .join(', ');
}

/** All reported locations for storage/filtering; never descriptions or inferred geography. */
export function locationText(job: CollectedJob): string {
  return job.locations.map(reportedLocationText).filter(Boolean).join('; ');
}

// Work style/global reach and missing-value labels are not usable geographic facts.
const NON_GEOGRAPHIC = new Set([
  '',
  'unknown',
  'unspecified',
  'not specified',
  'not available',
  'n a',
  // Do not include "na": NA is the reported country code for Namibia.
  'none',
  'null',
  'tbd',
  'remote',
  'fully remote',
  'remote work',
  'hybrid',
  'onsite',
  'on site',
  'anywhere',
  'worldwide',
  'global',
  'work from anywhere',
  'remote anywhere',
  'remote worldwide',
  'remote global',
]);

function hasGeographicFacts(job: CollectedJob): boolean {
  return job.locations.some((location) =>
    [location.text, location.city, location.region, location.country].some(
      (value) => value != null && !NON_GEOGRAPHIC.has(words(value))
    )
  );
}

function matchesLocation(job: CollectedJob, search: SavedSearch): boolean {
  // Empty criteria explicitly mean unrestricted, rather than an implicit US/Canada default.
  if (search.countries.length === 0 && search.locationPhrases.length === 0) {
    return true;
  }
  const countries = search.countries.map(normalizeCountry);
  if (
    job.locations.some((location) => {
      const country = normalizeCountry(location.country);
      return country !== null && countries.includes(country);
    })
  ) {
    return true;
  }
  if (
    job.locations.some((location) =>
      search.locationPhrases.some((phrase) =>
        includesPhrase(reportedLocationText(location), phrase)
      )
    )
  ) {
    return true;
  }
  return search.allowUnknownLocation && !hasGeographicFacts(job);
}

/** Enabled searches are OR'd; each search requires title AND location AND optional work style. */
export function matchedSearchIds(job: CollectedJob, searches: SavedSearch[]): string[] {
  return searches
    .filter(
      (search) =>
        search.enabled &&
        search.titlePhrases.some((phrase) => includesPhrase(job.title, phrase)) &&
        matchesLocation(job, search) &&
        (search.workArrangements.length === 0 ||
          (job.workArrangement === null
            ? search.allowUnknownWorkArrangement
            : search.workArrangements.includes(job.workArrangement)))
    )
    .map((search) => search.id);
}
