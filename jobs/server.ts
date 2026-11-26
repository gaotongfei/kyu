import 'server-only';
import { queryCatalog } from './catalog';
import type { CatalogFilters, CatalogResult } from './types';

export async function loadCatalog(filters: CatalogFilters): Promise<CatalogResult> {
  if (!process.env.DATABASE_URL) {
    return { kind: 'unavailable', reason: 'configuration', filters };
  }
  try {
    const { getDb } = await import('../db');
    return await queryCatalog(getDb(), filters);
  } catch {
    return { kind: 'unavailable', reason: 'database', filters };
  }
}
