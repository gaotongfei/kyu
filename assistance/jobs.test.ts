/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('../db', () => ({ getDb: jest.fn() }));
import { getDb } from '../db';
import { getPreparationJob, validateJobIdentity } from './jobs';

beforeEach(() => jest.clearAllMocks());

test('invalid job identity is rejected before database access', async () => {
  for (const [source, id] of [
    ['', 'id'],
    ['source', ''],
    ['source\u0000', 'id'],
    ['source', 'x'.repeat(2_049)],
  ]) {
    expect(() => validateJobIdentity(source, id)).toThrow('Choose a job');
    await expect(getPreparationJob(source, id)).rejects.toThrow();
  }
  expect(getDb).not.toHaveBeenCalled();
});

test('reads one source-scoped stored job and projects only preparation facts', async () => {
  const limit = jest.fn().mockResolvedValue([
    {
      payload: {
        title: 'Engineer',
        company: 'Fixture',
        descriptionText: 'Plain text',
        descriptionComplete: false,
        applicationUrl: 'not-returned',
      },
      active: false,
      lastObservedAt: new Date('2026-11-26T12:00:00Z'),
    },
  ]);
  const db = {
    select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => ({ limit })) })) })),
  };
  jest.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  expect(await getPreparationJob('ashby:fixture', 'id')).toEqual({
    source: 'ashby:fixture',
    sourceJobId: 'id',
    title: 'Engineer',
    company: 'Fixture',
    descriptionText: 'Plain text',
    descriptionComplete: false,
    active: false,
    lastObservedAt: '2026-11-26T12:00:00.000Z',
  });
  expect(limit).toHaveBeenCalledWith(1);
});

test('deleted catalog content is not reconstructed or fetched from a provider', async () => {
  const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };
  jest.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  await expect(getPreparationJob('ashby:fixture', 'deleted')).rejects.toThrow(
    'no longer in the catalog'
  );
});
