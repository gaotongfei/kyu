/** @jest-environment node */
import { parseCollectorArgs } from './arguments';

test('requires explicit spend and supports bounded QA or maximum Free collection', () => {
  expect(parseCollectorArgs(['--hirebase-budget', '2'])).toEqual({
    command: 'run',
    hirebaseBudget: 2,
    maxBoardJobs: 2000,
    boardOffset: 0,
    boardLimit: 100,
  });
  expect(parseCollectorArgs(['--hirebase-budget', 'available', '--max-board-jobs', '5'])).toEqual({
    command: 'run',
    hirebaseBudget: 500,
    maxBoardJobs: 5,
    boardOffset: 0,
    boardLimit: 100,
  });
  expect(parseCollectorArgs(['--help'])).toEqual({ command: 'help' });
});

test.each([
  { args: [] },
  { args: ['--hirebase-budget', '501'] },
  { args: ['--hirebase-budget', '-1'] },
  { args: ['--hirebase-budget', '0', '--hirebase-budget', '2'] },
  { args: ['--hirebase-budget', '0', '--unknown', 'x'] },
  { args: ['--hirebase-budget', '0', '--max-board-jobs', '2001'] },
  { args: ['--hirebase-budget', '0', '--max-board-jobs', '0'] },
  { args: ['purge', '--source', 'hirebase', '--job-id', 'x'] },
  { args: ['purge', '--source', 'https://evil.test', '--job-id', 'x', '--confirm', 'delete'] },
  { args: ['purge', '--source', 'hirebase', '--job-id', '../x', '--confirm', 'delete'] },
])('rejects unsafe, ambiguous or unconfirmed arguments: $args', ({ args }) => {
  expect(() => parseCollectorArgs(args)).toThrow();
});

test('supports bounded zero-based board batches and confirmed Lever purge', () => {
  expect(
    parseCollectorArgs(['--hirebase-budget', '0', '--board-offset', '100', '--board-limit', '50'])
  ).toMatchObject({ boardOffset: 100, boardLimit: 50 });
  expect(
    parseCollectorArgs([
      'purge',
      '--source',
      'lever:example',
      '--job-id',
      'one',
      '--confirm',
      'delete',
    ])
  ).toEqual({ command: 'purge', source: 'lever:example', sourceJobId: 'one' });
});

test.each([
  ['--board-offset', '-1'],
  ['--board-offset', '1.5'],
  ['--board-offset', '15000'],
  ['--board-offset', 'Infinity'],
  ['--board-limit', '0'],
  ['--board-limit', '501'],
  ['--board-limit', '1.5'],
  ['--board-limit', 'NaN'],
])('rejects unsafe batch values %s %s', (flag, value) => {
  expect(() => parseCollectorArgs(['--hirebase-budget', '0', flag, value])).toThrow();
});

test('purges only an explicitly confirmed source identity', () => {
  expect(
    parseCollectorArgs([
      'purge',
      '--source',
      'ashby:example',
      '--job-id',
      'job-1',
      '--confirm',
      'delete',
    ])
  ).toEqual({ command: 'purge', source: 'ashby:example', sourceJobId: 'job-1' });
});
