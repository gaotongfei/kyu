import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import type { Database, DatabaseClient } from '../db/core';
import {
  collectionBoards,
  collectionJobs,
  collectionReservations,
  collectionRuns,
  collectionSuppressions,
  collectionUsage,
} from '../db/schema';
import { boardKey } from './config';
import type { UsageLedger } from './hirebase';
import { locationText, matchedSearchIds } from './matching';
import type { CollectionStore } from './store-contract';
import type { Board, CollectedJob, CollectionConfig, RunReport, SavedSearch } from './types';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const COLLECTOR_LOCK = 1264145731; // Fixed, session-scoped collector lock ("KYUC").
const SOURCE_LOCK_NAMESPACE = 1264145747;
const STARTUP_LOCK = 1264145748;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

class StoreError extends Error {}

function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new StoreError(message);
  }
}

// Database error details can contain SQL parameters, job content, or connection credentials.
async function safely<T>(message: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw error instanceof StoreError ? error : new StoreError(message);
  }
}

function sourceProvider(source: string): CollectedJob['provider'] {
  if (source === 'hirebase') {
    return 'hirebase';
  }
  const match = /^(ashby|greenhouse):([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/.exec(source);
  requireValue(match !== null, 'Invalid collector source');
  const provider = match[1] as Board['provider'];
  requireValue(boardKey({ provider, slug: match[2] }) === source, 'Invalid collector source');
  return provider;
}

function validDate(value: string | Date): Date {
  const date = new Date(value);
  requireValue(Number.isFinite(date.getTime()), 'Invalid collector observation or report time');
  return date;
}

function safeMessage(message: string | null): string | null {
  if (message === null) {
    return null;
  }
  // Messages are summaries, never response dumps, SQL diagnostics, URLs or credentials.
  if (
    /[<>{}\r\n]|https?:\/\/|postgres(?:ql)?:\/\/|api[_-]?key|authorization|bearer|password|secret|token/i.test(
      message
    )
  ) {
    return 'Collector source could not be verified';
  }
  return Array.from(message)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .slice(0, 500);
}

// Persisted JSON boundary: see db/SPEC.md.
function boardSnapshot(board: Board): Board {
  return {
    provider: board.provider,
    slug: board.slug,
    company: board.company,
    boardUrl: board.boardUrl,
    enabled: board.enabled,
    provenance: {
      url: board.provenance.url,
      commit: board.provenance.commit,
      lastCrawled: board.provenance.lastCrawled,
      license: board.provenance.license,
    },
  };
}

function configSnapshot(config: CollectionConfig): CollectionConfig {
  return {
    boards: config.boards.map(boardSnapshot),
    searches: config.searches.map((search) => ({
      id: search.id,
      name: search.name,
      enabled: search.enabled,
      titlePhrases: [...search.titlePhrases],
      countries: [...search.countries],
      locationPhrases: [...search.locationPhrases],
      allowUnknownLocation: search.allowUnknownLocation,
      workArrangements: [...search.workArrangements],
      allowUnknownWorkArrangement: search.allowUnknownWorkArrangement,
    })),
  };
}

function reportSnapshot(report: RunReport): RunReport {
  return {
    id: report.id,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    status: report.status,
    ...(report.removedOutOfScope === undefined
      ? {}
      : { removedOutOfScope: report.removedOutOfScope }),
    sources: report.sources.map((source) => ({
      source: source.source,
      provider: source.provider,
      status: source.status,
      complete: source.complete,
      fetched: source.fetched,
      retained: source.retained,
      deactivated: source.deactivated,
      message: safeMessage(source.message),
    })),
    hirebase: {
      requestedBudget: report.hirebase.requestedBudget,
      reserved: report.hirebase.reserved,
      returned: report.hirebase.returned,
      uncertain: report.hirebase.uncertain,
      providerRemaining: report.hirebase.providerRemaining,
      period: report.hirebase.period,
    },
  };
}

function jobIdentity(source: string, sourceJobId: string) {
  return and(eq(collectionJobs.source, source), eq(collectionJobs.sourceJobId, sourceJobId));
}

async function clearJob(tx: Transaction, source: string, sourceJobId: string): Promise<void> {
  await tx.delete(collectionJobs).where(jobIdentity(source, sourceJobId));
}

async function lockSource(tx: Transaction, source: string): Promise<void> {
  // Purge/ingestion serialization: see collector/SPEC.md.
  await tx.execute(
    sql`select pg_advisory_xact_lock(${SOURCE_LOCK_NAMESPACE}::integer, hashtext(${source}))`
  );
}

export class PostgresCollectionStore implements CollectionStore {
  private lockRequired = false;
  private lease: {
    session: Awaited<ReturnType<DatabaseClient['reserve']>>;
    pid: number;
    valid: boolean;
  } | null = null;
  private activeRunId: string | null = null;

  constructor(
    private readonly db: Database,
    private readonly client: DatabaseClient
  ) {}

  async acquireLock(): Promise<() => Promise<void>> {
    return safely('Collector lock could not be acquired', async () => {
      this.lockRequired = true;
      const session = await this.client.reserve();
      try {
        const [row] =
          await session`select pg_try_advisory_lock(${COLLECTOR_LOCK}::bigint) as locked, pg_backend_pid() as pid`;
        requireValue(row?.locked === true, 'Another collector run is already active');
        requireValue(Number.isSafeInteger(row.pid), 'Collector lock backend could not be verified');
        this.lease = { session, pid: row.pid, valid: true };
        this.activeRunId = null;
      } catch (error) {
        try {
          // Also clean up an ambiguously completed acquisition, if the session is still alive.
          await session`select pg_advisory_unlock(${COLLECTOR_LOCK}::bigint)`;
        } catch {
          // A disconnected session releases its advisory locks on the server.
        } finally {
          session.release();
        }
        throw error;
      }
      let released: Promise<void> | undefined;
      return () => {
        released ??= safely('Collector lock could not be released', async () => {
          try {
            if (this.lease?.valid) {
              await session`select pg_advisory_unlock(${COLLECTOR_LOCK}::bigint)`;
            }
          } finally {
            if (this.lease) {
              this.lease.valid = false;
            }
            session.release();
          }
        });
        return released;
      };
    });
  }

  async assertLock(): Promise<void> {
    if (!this.lockRequired) {
      return;
    }
    const lease = this.lease;
    requireValue(lease !== null && lease.valid, 'Collector lock lease was lost');
    try {
      const [row] =
        await lease.session`select pg_backend_pid() as pid, exists(select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and classid = 0 and objid = ${COLLECTOR_LOCK}::oid and objsubid = 1 and granted) as locked`;
      requireValue(row?.pid === lease.pid && row?.locked === true, 'Collector lock lease was lost');
    } catch {
      lease.valid = false;
      throw new StoreError('Collector lock lease was lost');
    }
  }

  private async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    await this.assertLock();
    return this.db.transaction(async (tx) => {
      if (this.activeRunId) {
        const [run] = await tx
          .select({ status: collectionRuns.status })
          .from(collectionRuns)
          .where(eq(collectionRuns.id, this.activeRunId))
          .for('update');
        requireValue(run?.status === 'running', 'Collector run was fenced by a newer invocation');
      }
      return work(tx);
    });
  }

  async startRun(report: RunReport, config: CollectionConfig): Promise<void> {
    const startedAt = validDate(report.startedAt);
    requireValue(
      report.status === 'running' && report.finishedAt === null,
      'A new collector run must be running'
    );
    await this.assertLock();
    await safely('Collector run could not be started', () =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${STARTUP_LOCK}::bigint)`);
        await this.assertLock();
        const interrupted = await tx
          .select({ id: collectionRuns.id, report: collectionRuns.report })
          .from(collectionRuns)
          .where(eq(collectionRuns.status, 'running'))
          .for('update');
        if (interrupted.length) {
          await tx
            .update(collectionReservations)
            .set({ status: 'uncertain' })
            .where(
              and(
                inArray(
                  collectionReservations.runId,
                  interrupted.map((run) => run.id)
                ),
                eq(collectionReservations.status, 'pending')
              )
            );
          for (const run of interrupted) {
            const previous = reportSnapshot(run.report);
            previous.status = 'interrupted';
            previous.finishedAt = startedAt.toISOString();
            await tx
              .update(collectionRuns)
              .set({
                status: 'interrupted',
                finishedAt: startedAt,
                report: previous,
              })
              .where(eq(collectionRuns.id, run.id));
          }
        }
        await tx.insert(collectionRuns).values({
          id: report.id,
          status: report.status,
          startedAt,
          finishedAt: null,
          config: configSnapshot(config),
          report: reportSnapshot(report),
        });
      })
    );
    this.activeRunId = report.id;
  }

  async saveReport(report: RunReport): Promise<void> {
    const startedAt = validDate(report.startedAt);
    const finishedAt = report.finishedAt === null ? null : validDate(report.finishedAt);
    await safely('Collector report could not be saved', async () => {
      await this.transaction(async (tx) =>
        tx
          .update(collectionRuns)
          .set({
            status: report.status,
            startedAt,
            finishedAt,
            report: reportSnapshot(report),
          })
          .where(eq(collectionRuns.id, report.id))
      );
    });
  }

  async prune(searches: SavedSearch[]): Promise<number> {
    return safely('Collector catalog could not be pruned', () =>
      this.transaction(async (tx) => {
        const jobs = await tx
          .select({
            source: collectionJobs.source,
            sourceJobId: collectionJobs.sourceJobId,
            payload: collectionJobs.payload,
          })
          .from(collectionJobs);
        let removed = 0;
        for (const job of jobs) {
          const matches = matchedSearchIds(job.payload, searches);
          if (!matches.length) {
            await clearJob(tx, job.source, job.sourceJobId);
            removed += 1;
          } else {
            await tx
              .update(collectionJobs)
              .set({ matchedSearchIds: matches })
              .where(jobIdentity(job.source, job.sourceJobId));
          }
        }
        return removed;
      })
    );
  }

  async persistSource(
    jobs: CollectedJob[],
    options: {
      source: string;
      complete: boolean;
      searches: SavedSearch[];
      observedAt: Date;
    }
  ): Promise<{ retained: number; deactivated: number }> {
    const provider = sourceProvider(options.source);
    const observedAt = validDate(options.observedAt);
    const seen = new Set<string>();
    for (const job of jobs) {
      requireValue(
        job.source === options.source && job.provider === provider,
        'Collector job does not belong to this source'
      );
      requireValue(
        typeof job.sourceJobId === 'string' && IDENTIFIER.test(job.sourceJobId),
        'Invalid collector job identity'
      );
      requireValue(
        !seen.has(job.sourceJobId),
        'Collector source contains duplicate job identities'
      );
      seen.add(job.sourceJobId);
    }
    return safely('Collector source could not be persisted', () =>
      this.transaction(async (tx) => {
        await lockSource(tx, options.source);
        const existing = await tx
          .select({ sourceJobId: collectionJobs.sourceJobId, payload: collectionJobs.payload })
          .from(collectionJobs)
          .where(eq(collectionJobs.source, options.source));
        const previous = new Map(existing.map((row) => [row.sourceJobId, row.payload]));
        const suppressions = await tx
          .select({ sourceJobId: collectionSuppressions.sourceJobId })
          .from(collectionSuppressions)
          .where(eq(collectionSuppressions.source, options.source));
        const suppressed = new Set(suppressions.map((row) => row.sourceJobId));
        let retained = 0;
        for (const incoming of jobs) {
          const old = previous.get(incoming.sourceJobId);
          const payload =
            provider === 'greenhouse' && incoming.detailsComplete === false && old
              ? {
                  ...incoming,
                  compensation: old.compensation,
                  reportedCompensation: old.reportedCompensation,
                }
              : incoming;
          const matches = matchedSearchIds(payload, options.searches);
          if (suppressed.has(payload.sourceJobId) || !matches.length) {
            if (old) {
              await clearJob(tx, options.source, payload.sourceJobId);
            }
            continue;
          }
          const content = {
            title: payload.title,
            company: payload.company,
            locationText: locationText(payload),
            payload,
            matchedSearchIds: matches,
            active: true,
            lastObservedAt: observedAt,
            inactiveAt: null,
          };
          await tx
            .insert(collectionJobs)
            .values({
              source: options.source,
              sourceJobId: payload.sourceJobId,
              provider,
              firstObservedAt: observedAt,
              ...content,
            })
            .onConflictDoUpdate({
              target: [collectionJobs.source, collectionJobs.sourceJobId],
              set: content,
            });
          retained += 1;
        }
        let deactivated = 0;
        if (options.complete && provider !== 'hirebase') {
          const missing = await tx
            .update(collectionJobs)
            .set({ active: false, inactiveAt: observedAt })
            .where(
              and(
                eq(collectionJobs.source, options.source),
                eq(collectionJobs.active, true),
                seen.size ? notInArray(collectionJobs.sourceJobId, [...seen]) : undefined
              )
            )
            .returning({ sourceJobId: collectionJobs.sourceJobId });
          deactivated = missing.length;
        }
        return { retained, deactivated };
      })
    );
  }

  async noteBoard(
    board: Board,
    outcome: {
      status: 'success' | 'partial' | 'failed';
      message: string | null;
      verified: boolean;
      successful: boolean;
    },
    observedAt: Date
  ): Promise<void> {
    const source = boardKey(board);
    const time = validDate(observedAt);
    const verified = outcome.status !== 'failed' && outcome.verified;
    const successful = outcome.status !== 'failed' && outcome.successful;
    await safely('Collector board outcome could not be saved', async () => {
      const content = {
        config: boardSnapshot(board),
        lastStatus: outcome.status,
        lastMessage: safeMessage(outcome.message),
      };
      await this.transaction(async (tx) =>
        tx
          .insert(collectionBoards)
          .values({
            source,
            ...content,
            verifiedAt: verified ? time : null,
            lastSuccessAt: successful ? time : null,
          })
          .onConflictDoUpdate({
            target: collectionBoards.source,
            set: {
              ...content,
              ...(verified ? { verifiedAt: time } : {}),
              ...(successful ? { lastSuccessAt: time } : {}),
            },
          })
      );
    });
  }

  async ledger(account: string, period: string, runId: string): Promise<UsageLedger> {
    requireValue(
      typeof account === 'string' && /^[a-f0-9]{64}$/.test(account),
      'Invalid Hirebase account hash'
    );
    requireValue(
      typeof period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(period),
      'Invalid Hirebase usage period'
    );
    requireValue(
      typeof runId === 'string' && IDENTIFIER.test(runId),
      'Invalid collector run identity'
    );
    const scope = and(eq(collectionUsage.account, account), eq(collectionUsage.period, period));
    const used = await safely('Hirebase usage could not be read', () =>
      this.transaction(async (tx) => {
        await tx.insert(collectionUsage).values({ account, period, used: 0 }).onConflictDoNothing();
        const [row] = await tx
          .select({ used: collectionUsage.used })
          .from(collectionUsage)
          .where(scope);
        requireValue(row !== undefined, 'Hirebase usage ledger is unavailable');
        return row.used;
      })
    );
    const ledger: UsageLedger = {
      used,
      reserve: async (amount, searchId) => {
        requireValue(
          Number.isSafeInteger(amount) && amount >= 1 && amount <= 100,
          'Hirebase reservation must be an integer between 1 and 100'
        );
        requireValue(
          typeof searchId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(searchId),
          'Invalid Hirebase search identity'
        );
        const reservation = randomUUID();
        const nextUsed = await safely('Hirebase allowance could not be reserved', () =>
          this.transaction(async (tx) => {
            const [row] = await tx
              .update(collectionUsage)
              .set({ used: sql`${collectionUsage.used} + ${amount}` })
              .where(and(scope, sql`${collectionUsage.used} + ${amount} <= 500`))
              .returning({ used: collectionUsage.used });
            requireValue(row !== undefined, 'Hirebase local monthly allowance exhausted');
            await tx.insert(collectionReservations).values({
              id: reservation,
              runId,
              account,
              period,
              searchId,
              reserved: amount,
              returned: null,
              status: 'pending',
              createdAt: new Date(),
            });
            return row.used;
          })
        );
        ledger.used = nextUsed;
        return reservation;
      },
      settle: async (reservation, returned) => {
        requireValue(
          typeof reservation === 'string' && IDENTIFIER.test(reservation),
          'Invalid Hirebase reservation identity'
        );
        requireValue(
          returned === null || (Number.isSafeInteger(returned) && returned >= 0),
          'Invalid Hirebase returned count'
        );
        const nextUsed = await safely('Hirebase reservation could not be settled', () =>
          this.transaction(async (tx) => {
            const reservationScope = and(
              eq(collectionReservations.id, reservation),
              eq(collectionReservations.runId, runId),
              eq(collectionReservations.account, account),
              eq(collectionReservations.period, period)
            );
            const [row] = await tx
              .select({
                reserved: collectionReservations.reserved,
                status: collectionReservations.status,
              })
              .from(collectionReservations)
              .where(reservationScope)
              .for('update');
            requireValue(
              row !== undefined && row.status === 'pending',
              'Hirebase reservation is not pending for this run and account'
            );
            requireValue(
              returned === null || returned <= row.reserved,
              'Hirebase returned count exceeds its reservation'
            );
            const refund = returned === null ? 0 : row.reserved - returned;
            const [usage] = await tx
              .update(collectionUsage)
              .set({ used: sql`${collectionUsage.used} - ${refund}` })
              .where(and(scope, gte(collectionUsage.used, refund)))
              .returning({ used: collectionUsage.used });
            requireValue(usage !== undefined, 'Hirebase usage ledger is inconsistent');
            await tx
              .update(collectionReservations)
              .set({ returned, status: returned === null ? 'uncertain' : 'settled' })
              .where(reservationScope);
            return usage.used;
          })
        );
        ledger.used = nextUsed;
      },
    };
    return ledger;
  }

  async purge(source: string, sourceJobId: string): Promise<void> {
    sourceProvider(source);
    requireValue(
      typeof sourceJobId === 'string' && IDENTIFIER.test(sourceJobId),
      'Invalid collector job identity'
    );
    await safely('Collector job could not be purged', () =>
      this.transaction(async (tx) => {
        await lockSource(tx, source);
        await clearJob(tx, source, sourceJobId);
        const deletedAt = new Date();
        await tx
          .insert(collectionSuppressions)
          .values({ source, sourceJobId, deletedAt })
          .onConflictDoUpdate({
            target: [collectionSuppressions.source, collectionSuppressions.sourceJobId],
            set: { deletedAt },
          });
      })
    );
  }
}
