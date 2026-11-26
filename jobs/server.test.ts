/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('../db', () => ({ getDb: jest.fn(() => ({ fixture: true })) }));
jest.mock('./catalog', () => ({ queryCatalog: jest.fn() }));

import { getDb } from '../db';
import { queryCatalog } from './catalog';
import { catalogFilters } from './filters';
import { loadCatalog } from './server';

const originalDatabaseUrl = process.env.DATABASE_URL;
beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test('missing configuration produces an honest setup state without a DB or provider call', async () => {
  delete process.env.DATABASE_URL;
  await expect(loadCatalog(catalogFilters({}))).resolves.toMatchObject({
    kind: 'unavailable',
    reason: 'configuration',
  });
  expect(queryCatalog).not.toHaveBeenCalled();
  expect(getDb).not.toHaveBeenCalled();
});

test('uses the guarded database adapter for the read-only query', async () => {
  process.env.DATABASE_URL = 'postgresql://fixture.invalid/unused';
  const filters = catalogFilters({ q: 'Engineer' });
  const result = {
    kind: 'ready' as const,
    filters,
    jobs: [],
    total: 0,
    page: 1,
    pageSize: 25,
    lastRun: null,
  };
  jest.mocked(queryCatalog).mockResolvedValue(result);
  await expect(loadCatalog(filters)).resolves.toEqual(result);
  expect(queryCatalog).toHaveBeenCalledWith({ fixture: true }, filters);
});

test('database failure never exposes credentials, SQL, or invented catalog results', async () => {
  process.env.DATABASE_URL = 'postgresql://fixture.invalid/unused';
  jest.mocked(queryCatalog).mockRejectedValue(new Error('password=never-expose'));
  const result = await loadCatalog(catalogFilters({}));
  expect(result).toMatchObject({ kind: 'unavailable', reason: 'database' });
  expect(JSON.stringify(result)).not.toContain('never-expose');
});
