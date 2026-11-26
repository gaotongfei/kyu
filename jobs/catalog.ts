import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import type { Database } from '../db/core';
import { collectionBoards, collectionJobs, collectionRuns } from '../db/schema';
import { literalLike } from './filters';
import type { CatalogFilters, CatalogResult } from './types';

export async function queryCatalog(
  db: Database,
  filters: CatalogFilters
): Promise<Extract<CatalogResult, { kind: 'ready' }>> {
  const pageSize = 25;
  const where = and(
    filters.includeInactive ? undefined : eq(collectionJobs.active, true),
    filters.q
      ? or(
          ilike(collectionJobs.title, literalLike(filters.q)),
          ilike(collectionJobs.company, literalLike(filters.q))
        )
      : undefined,
    filters.location ? ilike(collectionJobs.locationText, literalLike(filters.location)) : undefined
  );
  return db.transaction(
    async (tx) => {
      const [size] = await tx.select({ total: count() }).from(collectionJobs).where(where);
      const total = size.total;
      const page = Math.min(filters.page, Math.max(1, Math.ceil(total / pageSize)));
      const jobs = await tx
        .select()
        .from(collectionJobs)
        .where(where)
        .orderBy(
          desc(collectionJobs.lastObservedAt),
          asc(collectionJobs.source),
          asc(collectionJobs.sourceJobId)
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [last] = await tx
        .select({ report: collectionRuns.report })
        .from(collectionRuns)
        .orderBy(desc(collectionRuns.startedAt))
        .limit(1);
      const boards = await tx
        .select({
          source: collectionBoards.source,
          status: collectionBoards.lastStatus,
          lastSuccessAt: collectionBoards.lastSuccessAt,
        })
        .from(collectionBoards);
      const states = new Map(boards.map((board) => [board.source, board]));
      return {
        kind: 'ready',
        filters: { ...filters, page },
        total,
        page,
        pageSize,
        lastRun: last?.report ?? null,
        jobs: jobs.map((row) => ({
          job: row.payload,
          active: row.active,
          firstObservedAt: row.firstObservedAt.toISOString(),
          lastObservedAt: row.lastObservedAt.toISOString(),
          inactiveAt: row.inactiveAt?.toISOString() ?? null,
          refreshStatus: states.get(row.source)?.status ?? null,
          lastBoardSuccessAt: states.get(row.source)?.lastSuccessAt?.toISOString() ?? null,
        })),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  );
}
