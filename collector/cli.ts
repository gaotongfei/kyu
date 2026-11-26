import { loadEnvConfig } from '@next/env';
import { connectDatabase } from '../db/core';
import { OperatorError, parseCollectorArgs } from './arguments';
import { loadConfig } from './config';
import { runCollection } from './run';
import { PostgresCollectionStore } from './store';

async function main(): Promise<void> {
  const command = parseCollectorArgs(process.argv.slice(2));
  if (command.command === 'help') {
    process.stdout.write(`On-demand job collection (never runs on page load):
  yarn collect --hirebase-budget 0               # first 100 enabled boards
  yarn collect --hirebase-budget 0 --board-offset 100 --board-limit 100  # next batch
  yarn collect --hirebase-budget 2               # at most 2 Hirebase results
  yarn collect --hirebase-budget available       # explicitly use remaining Free allowance
  yarn collect --hirebase-budget 0 --max-board-jobs 5  # incomplete QA sample; cannot close missing jobs
  yarn collect purge --source ashby:example --job-id ID --confirm delete

Configure collector.local.json, DATABASE_URL and optionally HIREBASE_API_KEY locally.
Batches use sorted provider:slug keys. Keep selections stable between offsets; reports include nextOffset.
--board-limit is 1..500 (default 100); --board-offset is zero-based (default 0).
Purge deletes one source record and suppresses its future ingestion. No provider request is made.
`);
    return;
  }
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
  if (!process.env.DATABASE_URL) {
    throw new OperatorError(
      'DATABASE_URL is not set. Configure it locally and apply the migrations.'
    );
  }
  let config;
  if (command.command === 'run') {
    try {
      config = loadConfig();
    } catch {
      throw new OperatorError(
        'Invalid collector configuration. Run yarn collect:config validate for details.'
      );
    }
  }
  const { db, client } = connectDatabase(process.env.DATABASE_URL);
  try {
    const store = new PostgresCollectionStore(db, client);
    if (command.command === 'purge') {
      const release = await store.acquireLock();
      try {
        await store.purge(command.source, command.sourceJobId);
        process.stdout.write(
          `${JSON.stringify({ status: 'deleted', source: command.source, sourceJobId: command.sourceJobId })}\n`
        );
      } finally {
        await release();
      }
    } else {
      const report = await runCollection(store, config!, {
        hirebaseBudget: command.hirebaseBudget,
        maxBoardJobs: command.maxBoardJobs,
        boardOffset: command.boardOffset,
        boardLimit: command.boardLimit,
        hirebaseKey: process.env.HIREBASE_API_KEY,
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.status === 'success' ? 0 : 2;
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ status: 'failed', message: error instanceof OperatorError ? error.message : 'Collector could not complete. Check database configuration, migrations, and whether another collector holds the lock.' })}\n`
  );
  process.exitCode = 1;
});
