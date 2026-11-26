import { normalizeCountry } from './matching';
import type { Compensation, ReportedLocation, WorkArrangement } from './types';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Provider response contains an invalid object');
  }
  return value as Record<string, unknown>;
}

export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Provider response contains an invalid array');
  }
  return value;
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function requiredText(value: unknown): string {
  const result = text(value);
  if (!result) {
    throw new Error('Provider response is missing a required field');
  }
  return result;
}

export function jobId(value: unknown): string {
  const id =
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : requiredText(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(id)) {
    throw new Error('Provider returned an invalid job identifier');
  }
  return id;
}

export function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) {
    return null;
  }
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function timestamp(value: unknown): string | null {
  const date = text(value);
  return date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null;
}

export function arrangement(value: unknown): WorkArrangement | null {
  const normalized = text(value)
    ?.toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (normalized === 'remote') {
    return 'remote';
  }
  if (normalized === 'hybrid') {
    return 'hybrid';
  }
  if (normalized === 'onsite' || normalized === 'inperson') {
    return 'onsite';
  }
  return null;
}

export function htmlToText(value: string | null): string | null {
  if (!value) {
    return null;
  }
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (entity) => {
      const known: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
        '&nbsp;': ' ',
      };
      const match = entity.match(/^&#(x[\da-f]+|\d+);$/i);
      if (!match) {
        return known[entity.toLowerCase()] ?? entity;
      }
      const code =
        match[1][0].toLowerCase() === 'x'
          ? Number.parseInt(match[1].slice(1), 16)
          : Number(match[1]);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
  }
  return (
    decoded
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim() || null
  );
}

/** Recognize only explicit country names/codes, never infer country from a city or "CA" state. */
export function explicitCountry(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(
    /(?:^|[,;(/\s-])(?:United States(?: of America)?|USA|US|Canada|CAN)(?=$|[,;)\s])/i
  );
  return match ? normalizeCountry(match[0].replace(/^[,;(/\s-]+/, '').trim()) : null;
}

export function location(value: unknown): ReportedLocation {
  const data = record(value);
  return {
    text: text(data.text),
    city: text(data.city),
    region: text(data.region),
    country: normalizeCountry(text(data.country)),
  };
}

export function compensation(value: unknown): Compensation {
  const data = record(value);
  return {
    min: number(data.min),
    max: number(data.max),
    currency: text(data.currency),
    period: text(data.period),
    kind: text(data.kind),
    summary: text(data.summary),
  };
}
