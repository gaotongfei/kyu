import type { CatalogFilters } from './types';

function value(raw: string | string[] | undefined): string {
  return Array.from(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? ''))
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, 120);
}

export function catalogFilters(raw: Record<string, string | string[] | undefined>): CatalogFilters {
  const page = value(raw.page);
  return {
    q: value(raw.q),
    location: value(raw.location),
    includeInactive: value(raw.inactive) === '1',
    page: /^\d{1,5}$/.test(page) ? Math.max(1, Math.min(10000, Number(page))) : 1,
  };
}

export function catalogHref(
  filters: CatalogFilters,
  changes: Partial<CatalogFilters> = {}
): string {
  const next = { ...filters, ...changes };
  const query = new URLSearchParams();
  if (next.q) {
    query.set('q', next.q);
  }
  if (next.location) {
    query.set('location', next.location);
  }
  if (next.includeInactive) {
    query.set('inactive', '1');
  }
  if (next.page > 1) {
    query.set('page', String(next.page));
  }
  const encoded = query.toString();
  return encoded ? `/jobs?${encoded}` : '/jobs';
}

export function literalLike(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}
