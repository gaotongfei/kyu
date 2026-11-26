jest.mock('server-only', () => ({}));
jest.mock('drizzle-orm/postgres-js', () => ({ drizzle: jest.fn(() => ({})) }));
jest.mock('postgres', () => ({ __esModule: true, default: jest.fn(() => ({})) }));

const originalEnv = process.env;
const globalForDb = globalThis as unknown as { postgresClient?: unknown };

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  delete globalForDb.postgresClient;
  process.env = {
    ...originalEnv,
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://kyu:kyu@localhost:5432/kyu',
  };
});

afterEach(() => {
  delete globalForDb.postgresClient;
  process.env = originalEnv;
});

it('imports without database configuration or creating a client', async () => {
  delete process.env.DATABASE_URL;
  const database = await import('./index');
  const postgresMock = jest.mocked((await import('postgres')).default);
  const drizzleMock = jest.mocked((await import('drizzle-orm/postgres-js')).drizzle);

  expect(database.getDb).toEqual(expect.any(Function));
  expect(postgresMock).not.toHaveBeenCalled();
  expect(drizzleMock).not.toHaveBeenCalled();
});

it.each([undefined, ''])('reports a missing database URL on first use (%s)', async (url) => {
  if (url === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = url;
  }
  const { getDb } = await import('./index');
  const postgresMock = jest.mocked((await import('postgres')).default);

  expect(() => getDb()).toThrow('DATABASE_URL is not set');
  expect(postgresMock).not.toHaveBeenCalled();
});

it('creates and reuses one Drizzle database only on first use', async () => {
  const { getDb } = await import('./index');
  const postgresMock = jest.mocked((await import('postgres')).default);
  const drizzleMock = jest.mocked((await import('drizzle-orm/postgres-js')).drizzle);

  expect(postgresMock).not.toHaveBeenCalled();
  expect(drizzleMock).not.toHaveBeenCalled();
  const database = getDb();
  expect(getDb()).toBe(database);
  expect(postgresMock).toHaveBeenCalledTimes(1);
  expect(postgresMock).toHaveBeenCalledWith(process.env.DATABASE_URL);
  expect(drizzleMock).toHaveBeenCalledTimes(1);
  expect(drizzleMock).toHaveBeenCalledWith(postgresMock.mock.results[0].value, {
    schema: expect.any(Object),
  });
  expect(database).toBe(drizzleMock.mock.results[0].value);
});

it('does not cache failed initialization', async () => {
  delete process.env.DATABASE_URL;
  const { getDb } = await import('./index');
  expect(() => getDb()).toThrow('DATABASE_URL is not set');

  process.env.DATABASE_URL = 'postgresql://kyu:kyu@localhost:5432/kyu';
  expect(getDb()).toBeDefined();
  const postgresMock = jest.mocked((await import('postgres')).default);
  expect(postgresMock).toHaveBeenCalledTimes(1);
});

it('reuses the development connection pool across module reloads', async () => {
  const { getDb } = await import('./index');
  getDb();
  const client = globalForDb.postgresClient;

  jest.resetModules();
  const { getDb: reloadedGetDb } = await import('./index');
  const postgresMock = jest.mocked((await import('postgres')).default);
  const drizzleMock = jest.mocked((await import('drizzle-orm/postgres-js')).drizzle);

  expect(client).toBeDefined();
  expect(drizzleMock).not.toHaveBeenCalled();
  reloadedGetDb();
  expect(postgresMock).not.toHaveBeenCalled();
  expect(drizzleMock).toHaveBeenCalledWith(client, { schema: expect.any(Object) });
  expect(globalForDb.postgresClient).toBe(client);
});

it('reuses its module instance without caching a pool globally in production', async () => {
  process.env = { ...process.env, NODE_ENV: 'production' };

  const { getDb } = await import('./index');
  expect(getDb()).toBe(getDb());
  const postgresMock = jest.mocked((await import('postgres')).default);

  expect(postgresMock).toHaveBeenCalledTimes(1);
  expect(globalForDb.postgresClient).toBeUndefined();
});
