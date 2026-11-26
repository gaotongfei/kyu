import { createHash } from 'node:crypto';
import { boardKey, boardUrl } from './config';
import type { Board, BoardProvider } from './types';

export const directoryCommit = '2816bfadd65b7bbec23701dd036bcc7496c729db';
export const directoryPath = 'ats-directory/lastroundai-ats-company-directory-2026-08.csv';
export const directoryUrl = `https://raw.githubusercontent.com/fyrosofttech/lastroundai-hiring-data/${directoryCommit}/${directoryPath}`;
const snapshotHash = 'e637a04d06561bb3839dbf95a291e5fd11ac26b8f2858dc207939c1b723974a3';

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(field.replace(/\r$/, ''));
      field = '';
      if (char === '\n') {
        rows.push(row);
        row = [];
      }
    } else {
      field += char;
    }
  }
  if (quoted) {
    throw new Error('Unterminated CSV field');
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

export function selectedCandidates(csv: string, selected: string[]): Board[] {
  if (!selected.length || selected.length > 100 || new Set(selected).size !== selected.length) {
    throw new Error('Select 1–100 distinct provider:slug keys');
  }
  for (const key of selected) {
    if (!/^(ashby|greenhouse):[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(key)) {
      throw new Error('Only explicit Ashby/Greenhouse identifiers can be imported');
    }
  }
  const [headers, ...rows] = csvRows(csv);
  if (headers?.join(',') !== 'ats_vendor,company_name,board_slug,last_crawled') {
    throw new Error('Unexpected directory columns');
  }
  const found = new Map<string, Board>();
  for (const fields of rows) {
    if (fields.length !== 4) {
      throw new Error('Invalid directory row');
    }
    const [provider, company, slug, lastCrawled] = fields;
    const key = `${provider}:${slug}`;
    if (!selected.includes(key)) {
      continue;
    }
    if (found.has(key) || !company.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(lastCrawled)) {
      throw new Error('Invalid or duplicate selected directory row');
    }
    found.set(key, {
      provider: provider as BoardProvider,
      company,
      slug,
      boardUrl: boardUrl(provider as BoardProvider, slug),
      enabled: false,
      provenance: {
        url: `https://github.com/fyrosofttech/lastroundai-hiring-data/blob/${directoryCommit}/${directoryPath}`,
        commit: directoryCommit,
        lastCrawled,
        license: 'CC-BY-4.0',
      },
    });
  }
  if (found.size !== selected.length) {
    throw new Error('One or more selected identifiers are absent from the pinned directory');
  }
  return selected.map((key) => found.get(key)!);
}

export async function downloadCandidates(selected: string[]): Promise<Board[]> {
  const response = await fetch(directoryUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Directory download failed (HTTP ${response.status})`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Directory download has no body');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.length;
      if (size > 8_000_000) {
        throw new Error('Directory download exceeds the size limit');
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const data = Buffer.concat(chunks);
  if (createHash('sha256').update(data).digest('hex') !== snapshotHash) {
    throw new Error('Directory snapshot checksum differs; review provenance before importing');
  }
  return selectedCandidates(data.toString('utf8'), selected);
}

export function mergeCandidates(existing: Board[], imported: Board[]): Board[] {
  const keys = new Set(existing.map(boardKey));
  return [...existing, ...imported.filter((board) => !keys.has(boardKey(board)))];
}
