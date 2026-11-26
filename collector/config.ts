import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCountry } from './matching';
import type { Board, BoardProvider, CollectionConfig, SavedSearch, WorkArrangement } from './types';

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_BOARDS = 500;
const MAX_SEARCHES = 50;
const MAX_PHRASES = 30;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const ARRANGEMENTS: WorkArrangement[] = ['remote', 'hybrid', 'onsite'];

function invalid(path: string, reason: string): never {
  throw new Error(`Invalid collector configuration (${path}): ${reason}`);
}

function validateBoardIdentity(provider: BoardProvider, slug: string): void {
  if (provider !== 'ashby' && provider !== 'greenhouse') {
    invalid('board.provider', 'unsupported provider');
  }
  if (typeof slug !== 'string' || !IDENTIFIER.test(slug)) {
    invalid('board.slug', 'expected a 1–80 character alphanumeric/hyphen/underscore identifier');
  }
}

export function boardKey(board: Pick<Board, 'provider' | 'slug'>): string {
  validateBoardIdentity(board.provider, board.slug);
  return `${board.provider}:${board.slug}`;
}

/** The ONLY origin of outbound board targets: never use contributed URLs for requests. */
export function boardUrl(provider: BoardProvider, slug: string): string {
  validateBoardIdentity(provider, slug);
  const host = provider === 'ashby' ? 'jobs.ashbyhq.com' : 'boards.greenhouse.io';
  return `https://${host}/${slug}`;
}

// JSON.parse alone silently accepts duplicate object keys, including escaped equivalents.
// First validate JSON syntax, then scan keys with bounded nesting before using the parsed value.
function parseJson(text: string, label: string): unknown {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) {
    invalid(label, 'JSON exceeds the 1 MiB limit');
  }
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    invalid(label, 'invalid JSON');
  }
  let cursor = 0;
  function whitespace(): void {
    while (/\s/.test(text[cursor] ?? '')) {
      cursor += 1;
    }
  }
  function string(): string {
    const start = cursor;
    cursor += 1;
    while (cursor < text.length) {
      if (text[cursor] === '\\') {
        cursor += 2;
      } else if (text[cursor++] === '"') {
        return JSON.parse(text.slice(start, cursor)) as string;
      }
    }
    return invalid(label, 'invalid JSON string');
  }
  function value(depth: number): void {
    if (depth > 16) {
      invalid(label, 'JSON nesting exceeds 16 levels');
    }
    whitespace();
    const token = text[cursor];
    if (token === '"') {
      string();
    } else if (token === '{' || token === '[') {
      const object = token === '{';
      const end = object ? '}' : ']';
      const keys = new Set<string>();
      cursor += 1;
      whitespace();
      while (text[cursor] !== end) {
        if (object) {
          const key = string();
          if (keys.has(key)) {
            invalid(label, 'duplicate JSON object key');
          }
          keys.add(key);
          whitespace();
          cursor += 1; // colon; syntax was already checked by JSON.parse
        }
        value(depth + 1);
        whitespace();
        if (text[cursor] !== ',') {
          break;
        }
        cursor += 1;
        whitespace();
      }
      cursor += 1;
    } else {
      while (cursor < text.length && !/[\s,\]}]/.test(text[cursor])) {
        cursor += 1;
      }
    }
  }
  value(0);
  return result;
}

function object(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'expected an object');
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    invalid(path, 'unexpected field');
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    invalid(path, `expected an array of at most ${max} items`);
  }
  return value;
}

function text(value: unknown, max: number, path: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in contributed metadata.
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    invalid(
      path,
      `expected a nonempty string of at most ${max} characters without control characters`
    );
  }
  return value.trim();
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    invalid(path, 'expected a boolean');
  }
  return value;
}

function unique<T>(values: T[], key: (value: T) => string, path: string): T[] {
  if (new Set(values.map(key)).size !== values.length) {
    invalid(path, 'duplicate key/value');
  }
  return values;
}

function boards(value: unknown): Board[] {
  return unique(
    array(value, MAX_BOARDS, 'employers').map((entry, index): Board => {
      const path = `employers[${index}]`;
      const data = object(
        entry,
        ['provider', 'slug', 'company', 'boardUrl', 'enabled', 'provenance'],
        path
      );
      const provider = data.provider as BoardProvider;
      const slug = data.slug as string;
      const canonicalUrl = boardUrl(provider, slug);
      if (data.boardUrl !== canonicalUrl) {
        invalid(`${path}.boardUrl`, 'must exactly equal the canonical provider/slug URL');
      }
      if (boolean(data.enabled, `${path}.enabled`)) {
        invalid(
          `${path}.enabled`,
          'candidates must be disabled; select boards in collector.local.json'
        );
      }
      const provenance = object(
        data.provenance,
        ['url', 'commit', 'lastCrawled', 'license'],
        `${path}.provenance`
      );
      const url = text(provenance.url, 2048, `${path}.provenance.url`);
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
          invalid(
            `${path}.provenance.url`,
            'expected an HTTPS attribution URL without credentials'
          );
        }
      } catch {
        invalid(`${path}.provenance.url`, 'expected an HTTPS attribution URL without credentials');
      }
      const commit = provenance.commit;
      if (commit !== null && (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit))) {
        invalid(`${path}.provenance.commit`, 'expected a full lowercase commit hash or null');
      }
      const date = provenance.lastCrawled;
      if (
        date !== null &&
        (typeof date !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date)
      ) {
        invalid(`${path}.provenance.lastCrawled`, 'expected a valid YYYY-MM-DD date or null');
      }
      return {
        provider,
        slug,
        company: text(data.company, 200, `${path}.company`),
        boardUrl: canonicalUrl,
        enabled: false,
        provenance: {
          url,
          commit,
          lastCrawled: date,
          license:
            provenance.license === null
              ? null
              : text(provenance.license, 120, `${path}.provenance.license`),
        },
      };
    }),
    boardKey,
    'employers'
  );
}

function phrases(value: unknown, path: string): string[] {
  return unique(
    array(value, MAX_PHRASES, path).map((entry) => {
      const phrase = text(entry, 120, path);
      if (!/[\p{L}\p{N}]/u.test(phrase)) {
        invalid(path, 'phrases must contain a letter or number');
      }
      return phrase;
    }),
    (phrase) =>
      phrase
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim(),
    path
  );
}

function searches(value: unknown): SavedSearch[] {
  return unique(
    array(value, MAX_SEARCHES, 'searches').map((entry, index): SavedSearch => {
      const path = `searches[${index}]`;
      const data = object(
        entry,
        [
          'id',
          'name',
          'enabled',
          'titlePhrases',
          'countries',
          'locationPhrases',
          'allowUnknownLocation',
          'workArrangements',
          'allowUnknownWorkArrangement',
        ],
        path
      );
      if (typeof data.id !== 'string' || !IDENTIFIER.test(data.id)) {
        invalid(
          `${path}.id`,
          'expected a 1–80 character alphanumeric/hyphen/underscore identifier'
        );
      }
      const titlePhrases = phrases(data.titlePhrases, `${path}.titlePhrases`);
      if (titlePhrases.length === 0) {
        invalid(`${path}.titlePhrases`, 'at least one title phrase is required');
      }
      const countries = unique(
        array(data.countries, 2, `${path}.countries`).map((entry) => {
          const country = normalizeCountry(text(entry, 80, `${path}.countries`));
          if (country !== 'US' && country !== 'CA') {
            invalid(
              `${path}.countries`,
              'supported countries are US/USA/United States and CA/CAN/Canada'
            );
          }
          return country;
        }),
        (country) => country,
        `${path}.countries`
      );
      const workArrangements = unique(
        array(
          data.workArrangements === undefined ? [] : data.workArrangements,
          3,
          `${path}.workArrangements`
        ).map((entry) => {
          if (!ARRANGEMENTS.includes(entry as WorkArrangement)) {
            invalid(`${path}.workArrangements`, 'unsupported work arrangement');
          }
          return entry as WorkArrangement;
        }),
        (arrangement) => arrangement,
        `${path}.workArrangements`
      );
      return {
        id: data.id,
        name: text(data.name, 200, `${path}.name`),
        enabled: boolean(data.enabled, `${path}.enabled`),
        titlePhrases,
        countries,
        locationPhrases: phrases(data.locationPhrases, `${path}.locationPhrases`),
        allowUnknownLocation: boolean(data.allowUnknownLocation, `${path}.allowUnknownLocation`),
        workArrangements,
        allowUnknownWorkArrangement:
          data.allowUnknownWorkArrangement === undefined
            ? false
            : boolean(data.allowUnknownWorkArrangement, `${path}.allowUnknownWorkArrangement`),
      };
    }),
    (search) => search.id,
    'searches'
  );
}

/** Parse untrusted JSON files, including duplicate JSON keys and the optional full search override. */
export function parseConfig(
  employersJson: string,
  searchesJson: string,
  localJson?: string
): CollectionConfig {
  const config = {
    boards: boards(parseJson(employersJson, 'employers.json')),
    searches: searches(parseJson(searchesJson, 'searches.json')),
  };
  if (localJson === undefined) {
    return config;
  }
  const local = object(
    parseJson(localJson, 'collector.local.json'),
    ['enabledBoards', 'searches'],
    'collector.local.json'
  );
  const knownKeys = new Set(config.boards.map(boardKey));
  const enabledKeys = unique(
    array(local.enabledBoards, MAX_BOARDS, 'enabledBoards').map((key) => {
      if (typeof key !== 'string' || !knownKeys.has(key)) {
        invalid('enabledBoards', 'key does not identify a configured board');
      }
      return key;
    }),
    (key) => key,
    'enabledBoards'
  );
  const enabled = new Set(enabledKeys);
  config.boards = config.boards.map((board) => ({
    ...board,
    enabled: enabled.has(boardKey(board)),
  }));
  if (local.searches !== undefined) {
    config.searches = searches(local.searches);
  }
  return config;
}

function readJsonFile(path: string): string {
  if (statSync(path).size > MAX_JSON_BYTES) {
    invalid('file', 'JSON exceeds the 1 MiB limit');
  }
  return readFileSync(path, 'utf8');
}

/** Read collector/{employers,searches}.json and optional project-root collector.local.json. */
export function loadConfig(projectRoot: string = process.cwd()): CollectionConfig {
  const employersJson = readJsonFile(join(projectRoot, 'collector', 'employers.json'));
  const searchesJson = readJsonFile(join(projectRoot, 'collector', 'searches.json'));
  let localJson: string | undefined;
  try {
    localJson = readJsonFile(join(projectRoot, 'collector.local.json'));
  } catch (error) {
    // Only a missing override is optional; malformed files and permission errors fail closed.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  return parseConfig(employersJson, searchesJson, localJson);
}
