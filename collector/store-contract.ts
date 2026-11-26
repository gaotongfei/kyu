import type { UsageLedger } from './hirebase';
import type { Board, CollectedJob, CollectionConfig, RunReport, SavedSearch } from './types';

export interface CollectionStore {
  acquireLock(): Promise<() => Promise<void>>;
  assertLock(): Promise<void>;
  startRun(report: RunReport, config: CollectionConfig): Promise<void>;
  saveReport(report: RunReport): Promise<void>;
  prune(searches: SavedSearch[]): Promise<number>;
  persistSource(
    jobs: CollectedJob[],
    options: {
      source: string;
      complete: boolean;
      searches: SavedSearch[];
      observedAt: Date;
    }
  ): Promise<{ retained: number; deactivated: number }>;
  noteBoard(
    board: Board,
    outcome: {
      status: 'success' | 'partial' | 'failed';
      message: string | null;
      verified: boolean;
      successful: boolean;
    },
    observedAt: Date
  ): Promise<void>;
  ledger(account: string, period: string, runId: string): Promise<UsageLedger>;
  purge(source: string, sourceJobId: string): Promise<void>;
}
