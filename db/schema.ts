import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Section } from '../app/resumes/model';

export const resumes = pgTable(
  'resumes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    sections: jsonb('sections').$type<Section[]>().notNull().default([]),
    themeKey: text('theme_key').$type<'classic'>().notNull().default('classic'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('resumes_version_positive', sql`${table.version} > 0`),
    check('resumes_sections_array', sql`jsonb_typeof(${table.sections}) = 'array'`),
    check('resumes_classic_theme', sql`${table.themeKey} = 'classic'`),
  ]
);
