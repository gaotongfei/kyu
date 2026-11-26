import type { CollectedJob, RunReport } from '../collector/types';

export interface CatalogFilters {
  q: string;
  location: string;
  includeInactive: boolean;
  page: number;
}

export interface CatalogJob {
  job: CollectedJob;
  active: boolean;
  firstObservedAt: string;
  lastObservedAt: string;
  inactiveAt: string | null;
  refreshStatus: string | null;
  lastBoardSuccessAt: string | null;
}

export type CatalogResult =
  | {
      kind: 'ready';
      filters: CatalogFilters;
      jobs: CatalogJob[];
      total: number;
      page: number;
      pageSize: number;
      lastRun: RunReport | null;
    }
  | {
      kind: 'unavailable';
      reason: 'configuration' | 'database';
      filters: CatalogFilters;
    };
