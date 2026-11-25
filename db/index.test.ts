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

it('reports a missing database URL before creating a client', async () => {
  delete process.env.DATABASE_URL;

  await expect(import('./index')).rejects.toThrow('DATABASE_URL is not set');
  const postgresMock = jest.mocked((await import('postgres')).default);

  expect(postgresMock).not.toHaveBeenCalled();
});

it('creates a Drizzle database with the configured URL and schema', async () => {
  const { db } = await import('./index');
  const postgresMock = jest.mocked((await import('postgres')).default);
  const drizzleMock = jest.mocked((await import('drizzle-orm/postgres-js')).drizzle);

  expect(postgresMock).toHaveBeenCalledWith(process.env.DATABASE_URL);
  expect(drizzleMock).toHaveBeenCalledWith(postgresMock.mock.results[0].value, {
    schema: expect.any(Object),
  });
  expect(db).toBe(drizzleMock.mock.results[0].value);
});

it('reuses the development connection pool across module reloads', async () => {
  await import('./index');
  const client = globalForDb.postgresClient;

  jest.resetModules();
  await import('./index');
  const postgresMock = jest.mocked((await import('postgres')).default);
  const drizzleMock = jest.mocked((await import('drizzle-orm/postgres-js')).drizzle);

  expect(client).toBeDefined();
  expect(postgresMock).not.toHaveBeenCalled();
  expect(drizzleMock).toHaveBeenCalledWith(client, { schema: expect.any(Object) });
  expect(globalForDb.postgresClient).toBe(client);
});

it('does not cache a connection pool globally in production', async () => {
  process.env = { ...process.env, NODE_ENV: 'production' };

  await import('./index');

  expect(globalForDb.postgresClient).toBeUndefined();
});
