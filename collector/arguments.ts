import { jobId } from './normalize';

export class OperatorError extends Error {}

export type CollectorCommand =
  | { command: 'help' }
  | { command: 'run'; hirebaseBudget: number; maxBoardJobs: number }
  | { command: 'purge'; source: string; sourceJobId: string };

export function parseCollectorArgs(args: string[]): CollectorCommand {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    return { command: 'help' };
  }
  const purging = args[0] === 'purge';
  const tokens = purging ? args.slice(1) : args;
  const flags = new Map<string, string>();
  for (let i = 0; i < tokens.length; i += 2) {
    const key = tokens[i];
    const value = tokens[i + 1];
    if (!key.startsWith('--') || flags.has(key) || value === undefined || value.startsWith('--')) {
      throw new OperatorError('Expected distinct --option value pairs. Run yarn collect --help.');
    }
    flags.set(key, value);
  }
  if (purging) {
    if (
      flags.size !== 3 ||
      flags.get('--confirm') !== 'delete' ||
      !flags.has('--source') ||
      !flags.has('--job-id')
    ) {
      throw new OperatorError('Purge requires --source, --job-id and --confirm delete.');
    }
    const source = flags.get('--source')!;
    if (!/^(hirebase|(?:ashby|greenhouse):[A-Za-z0-9][A-Za-z0-9_-]{0,79})$/.test(source)) {
      throw new OperatorError('Invalid purge source identity.');
    }
    let sourceJobId: string;
    try {
      sourceJobId = jobId(flags.get('--job-id'));
    } catch {
      throw new OperatorError('Invalid purge job identifier.');
    }
    return { command: 'purge', source, sourceJobId };
  }
  if (
    !flags.has('--hirebase-budget') ||
    [...flags.keys()].some((key) => key !== '--hirebase-budget' && key !== '--max-board-jobs')
  ) {
    throw new OperatorError(
      'Specify --hirebase-budget 0..500 (or available). Run yarn collect --help.'
    );
  }
  const budgetText = flags.get('--hirebase-budget')!;
  const jobsText = flags.get('--max-board-jobs') ?? '2000';
  const hirebaseBudget =
    budgetText === 'available' ? 500 : /^\d{1,3}$/.test(budgetText) ? Number(budgetText) : -1;
  const maxBoardJobs = /^\d{1,4}$/.test(jobsText) ? Number(jobsText) : -1;
  if (hirebaseBudget < 0 || hirebaseBudget > 500 || maxBoardJobs < 1 || maxBoardJobs > 2000) {
    throw new OperatorError('Budget must be 0..500 and the board-job limit 1..2000.');
  }
  return { command: 'run', hirebaseBudget, maxBoardJobs };
}
