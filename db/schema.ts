import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  Board,
  CollectedJob,
  CollectionConfig,
  Provider,
  RunReport,
} from '../collector/types';

export const resumes = pgTable(
  'resumes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    contentMarkdown: text('content_markdown').notNull().default(''),
    themeKey: text('theme_key').$type<'classic'>().notNull().default('classic'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('resumes_version_positive', sql`${table.version} > 0`),
    check('resumes_classic_theme', sql`${table.themeKey} = 'classic'`),
  ]
);

export const collectionJobs = pgTable(
  'collection_jobs',
  {
    source: text('source').notNull(),
    sourceJobId: text('source_job_id').notNull(),
    provider: text('provider').$type<Provider>().notNull(),
    title: text('title').notNull(),
    company: text('company').notNull(),
    locationText: text('location_text').notNull(),
    payload: jsonb('payload').$type<CollectedJob>().notNull(),
    matchedSearchIds: jsonb('matched_search_ids').$type<string[]>().notNull(),
    active: boolean('active').notNull().default(true),
    firstObservedAt: timestamp('first_observed_at', { withTimezone: true }).notNull(),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true }).notNull(),
    inactiveAt: timestamp('inactive_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.sourceJobId] }),
    index('collection_jobs_observed_idx').on(
      table.active,
      table.lastObservedAt,
      table.source,
      table.sourceJobId
    ),
  ]
);

export const collectionBoards = pgTable('collection_boards', {
  source: text('source').primaryKey(),
  config: jsonb('config').$type<Board>().notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastStatus: text('last_status').notNull(),
  lastMessage: text('last_message'),
});

export const collectionRuns = pgTable(
  'collection_runs',
  {
    id: text('id').primaryKey(),
    status: text('status').$type<RunReport['status']>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    config: jsonb('config').$type<CollectionConfig>().notNull(),
    report: jsonb('report').$type<RunReport>().notNull(),
  },
  (table) => [index('collection_runs_started_idx').on(table.startedAt)]
);

export const collectionUsage = pgTable(
  'collection_usage',
  {
    account: text('account').notNull(),
    period: text('period').notNull(),
    used: integer('used').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.account, table.period] }),
    check('collection_usage_free_cap', sql`${table.used} >= 0 AND ${table.used} <= 500`),
  ]
);

export const collectionReservations = pgTable(
  'collection_reservations',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => collectionRuns.id),
    account: text('account').notNull(),
    period: text('period').notNull(),
    searchId: text('search_id').notNull(),
    reserved: integer('reserved').notNull(),
    returned: integer('returned'),
    status: text('status').$type<'pending' | 'settled' | 'uncertain'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'collection_reservation_bound',
      sql`${table.reserved} BETWEEN 1 AND 100 AND (${table.returned} IS NULL OR ${table.returned} BETWEEN 0 AND ${table.reserved})`
    ),
  ]
);

export const collectionSuppressions = pgTable(
  'collection_suppressions',
  {
    source: text('source').notNull(),
    sourceJobId: text('source_job_id').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.source, table.sourceJobId] })]
);
