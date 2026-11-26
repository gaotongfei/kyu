import { createHash, randomUUID } from 'node:crypto';
import { collectBoard } from './boards';
import { boardKey } from './config';
import { collectHirebase, freeUsage, type UsageLedger } from './hirebase';
import { ProviderError, ProviderHttp } from './http';
import type { CollectionStore } from './store-contract';
import type { CollectionConfig, RunReport, SourceResult } from './types';

function failureMessage(error: unknown): string {
  return error instanceof ProviderError
    ? error.message
    : 'Source response or persistence could not be verified';
}

export async function runCollection(
  store: CollectionStore,
  config: CollectionConfig,
  options: {
    hirebaseBudget: number;
    hirebaseKey?: string;
    http?: ProviderHttp;
    now?: () => Date;
    maxBoardJobs?: number;
    boardOffset?: number;
    boardLimit?: number;
  }
): Promise<RunReport> {
  if (
    !Number.isInteger(options.hirebaseBudget) ||
    options.hirebaseBudget < 0 ||
    options.hirebaseBudget > 500
  ) {
    throw new Error('Hirebase invocation budget must be between 0 and 500');
  }
  const boardOffset = options.boardOffset ?? 0;
  const boardLimit = options.boardLimit ?? 100;
  if (
    !Number.isSafeInteger(boardOffset) ||
    boardOffset < 0 ||
    boardOffset >= 15000 ||
    !Number.isSafeInteger(boardLimit) ||
    boardLimit < 1 ||
    boardLimit > 500
  ) {
    throw new Error('Invalid board batch: offset must be 0..14999 and limit 1..500');
  }
  const enabledBoards = config.boards
    .filter((board) => board.enabled)
    .sort((left, right) => {
      const a = boardKey(left);
      const b = boardKey(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  if (boardOffset > 0 && boardOffset >= enabledBoards.length) {
    throw new Error('Board offset is outside the enabled board selection');
  }
  const batch = enabledBoards.slice(boardOffset, boardOffset + boardLimit);
  const now = options.now ?? (() => new Date());
  const http = (options.http ?? new ProviderHttp()).guarded(() => store.assertLock());
  const report: RunReport = {
    id: randomUUID(),
    startedAt: now().toISOString(),
    finishedAt: null,
    status: 'running',
    sources: [],
    boardBatch: {
      totalEnabled: enabledBoards.length,
      offset: boardOffset,
      limit: boardLimit,
      attempted: 0,
      nextOffset: enabledBoards.length ? boardOffset : null,
    },
    hirebase: {
      requestedBudget: options.hirebaseBudget,
      reserved: 0,
      returned: 0,
      uncertain: 0,
      providerRemaining: null,
      period: now().toISOString().slice(0, 7),
    },
  };
  const release = await store.acquireLock();
  let started = false;
  let missingConfiguration = false;
  try {
    await store.startRun(report, config);
    started = true;
    report.removedOutOfScope = await store.prune(config.searches);
    const enabledSearches = config.searches.filter((search) => search.enabled);
    if (!enabledSearches.length) {
      report.sources.push({
        source: 'hirebase',
        provider: 'hirebase',
        status: 'skipped',
        complete: false,
        fetched: 0,
        retained: 0,
        deactivated: 0,
        message: 'No enabled saved searches; no providers were contacted',
      });
      report.status = 'failed';
    } else {
      for (const board of batch) {
        const source = boardKey(board);
        let outcome: SourceResult;
        try {
          const result = await collectBoard(board, http, { maxJobs: options.maxBoardJobs });
          const persisted = await store.persistSource(result.jobs, {
            source,
            complete: result.complete,
            searches: config.searches,
            observedAt: now(),
          });
          outcome = {
            source,
            provider: board.provider,
            status: result.complete ? 'success' : 'partial',
            complete: result.complete,
            fetched: result.fetched,
            ...persisted,
            message: result.message,
          };
          await store.noteBoard(
            board,
            {
              status: outcome.status as 'success' | 'partial',
              message: outcome.message,
              verified: true,
              successful: result.complete,
            },
            now()
          );
        } catch (error) {
          outcome = {
            source,
            provider: board.provider,
            status: 'failed',
            complete: false,
            fetched: 0,
            retained: 0,
            deactivated: 0,
            message: failureMessage(error),
          };
          await store.noteBoard(
            board,
            { status: 'failed', message: outcome.message, verified: false, successful: false },
            now()
          );
        }
        report.sources.push(outcome);
        report.boardBatch!.attempted += 1;
        const nextOffset = boardOffset + report.boardBatch!.attempted;
        report.boardBatch!.nextOffset = nextOffset < enabledBoards.length ? nextOffset : null;
        await store.saveReport(report);
      }
      if (options.hirebaseBudget === 0 || !options.hirebaseKey) {
        missingConfiguration = options.hirebaseBudget > 0 && !options.hirebaseKey;
        report.sources.push({
          source: 'hirebase',
          provider: 'hirebase',
          status: 'skipped',
          complete: false,
          fetched: 0,
          retained: 0,
          deactivated: 0,
          message: missingConfiguration
            ? 'HIREBASE_API_KEY is not configured locally; Hirebase was not contacted'
            : 'Hirebase explicitly disabled by a zero invocation budget',
        });
      } else {
        try {
          const usage = await freeUsage(http, options.hirebaseKey, now());
          report.hirebase.providerRemaining = usage.remaining;
          report.hirebase.period = usage.period;
          const account = createHash('sha256').update(options.hirebaseKey).digest('hex');
          const inner = await store.ledger(account, usage.period, report.id);
          const pendingReservations = new Map<string, number>();
          const ledger: UsageLedger = {
            get used() {
              return inner.used;
            },
            reserve: async (amount, searchId) => {
              const id = await inner.reserve(amount, searchId);
              report.hirebase.reserved += amount;
              pendingReservations.set(id, amount);
              await store.saveReport(report);
              return id;
            },
            settle: async (id, returned) => {
              await inner.settle(id, returned);
              if (returned === null) {
                report.hirebase.uncertain += pendingReservations.get(id) ?? 0;
              } else {
                report.hirebase.returned += returned;
              }
              pendingReservations.delete(id);
              await store.saveReport(report);
            },
          };
          const result = await collectHirebase({
            http,
            key: options.hirebaseKey,
            searches: config.searches,
            budget: options.hirebaseBudget,
            usage,
            ledger,
            now,
            onJobs: async (jobs) => {
              const saved = await store.persistSource(jobs, {
                source: 'hirebase',
                complete: false,
                searches: config.searches,
                observedAt: now(),
              });
              return saved.retained;
            },
          });
          report.sources.push(...result.sources);
          report.hirebase = {
            ...report.hirebase,
            ...{
              reserved: result.reserved,
              returned: result.returned,
              uncertain: result.uncertain,
              providerRemaining: result.providerRemaining,
            },
          };
        } catch (error) {
          report.sources.push({
            source: 'hirebase',
            provider: 'hirebase',
            status: 'failed',
            complete: false,
            fetched: 0,
            retained: 0,
            deactivated: 0,
            message:
              error instanceof ProviderError
                ? error.message
                : 'Hirebase Free allowance or collection could not be verified; no further searches attempted',
          });
        }
      }
      const hasFailure =
        missingConfiguration ||
        report.sources.some((source) => source.status === 'failed' || source.status === 'partial');
      const hasSuccess = report.sources.some((source) => source.status === 'success');
      report.status = hasFailure
        ? hasSuccess
          ? 'partial'
          : 'failed'
        : hasSuccess
          ? 'success'
          : 'failed';
    }
    report.finishedAt = now().toISOString();
    await store.saveReport(report);
    return report;
  } catch (error) {
    if (started) {
      report.status = 'failed';
      report.finishedAt = now().toISOString();
      await store.saveReport(report);
    }
    throw error;
  } finally {
    await release();
  }
}
