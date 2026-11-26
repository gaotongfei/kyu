/** @jest-environment node */
import { parseCollectorArgs } from './arguments';

test('requires explicit spend and supports bounded QA or maximum Free collection', () => {
  expect(parseCollectorArgs(['--hirebase-budget', '2'])).toEqual({
    command: 'run',
    hirebaseBudget: 2,
    maxBoardJobs: 2000,
  });
  expect(parseCollectorArgs(['--hirebase-budget', 'available', '--max-board-jobs', '5'])).toEqual({
    command: 'run',
    hirebaseBudget: 500,
    maxBoardJobs: 5,
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
