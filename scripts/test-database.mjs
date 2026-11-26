import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', ...options });
let container;
try {
  container = run('docker', ['run', '--detach', '--rm', '--label', 'kyu.purpose=resume-integration-test',
    '--env', 'POSTGRES_USER=kyu', '--env', 'POSTGRES_PASSWORD=kyu', '--env', 'POSTGRES_DB=kyu_resume_test',
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql', 'postgres:18-alpine']).trim();
  if (!/^[a-f\d]{64}$/.test(container)) throw new Error('Docker did not return a test container ID.');
  const deadline = Date.now() + 60_000;
  while (true) {
    try { run('docker', ['exec', container, 'pg_isready', '-U', 'kyu', '-d', 'kyu_resume_test'], { stdio: 'ignore' }); break; }
    catch { if (Date.now() > deadline) throw new Error('Isolated PostgreSQL did not become ready.'); await setTimeout(250); }
  }
  const address = run('docker', ['port', container, '5432/tcp']).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('Test database must bind only to loopback.');
  const env = { ...process.env, DATABASE_URL: `postgresql://kyu:kyu@${address}/kyu_resume_test`, RESUME_TEST_DATABASE: 'isolated', NODE_ENV: 'test' };
  console.log('Applying schema migrations to a new ephemeral PostgreSQL container.');
  run('yarn', ['db:migrate'], { env, stdio: 'inherit' });
  run('yarn', ['db:migrate'], { env, stdio: 'inherit' });
  run('yarn', ['tsx', '--test', 'tests/storage.integration.ts'], { env: { ...env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --conditions=react-server` }, stdio: 'inherit' });
} finally {
  if (container && /^[a-f\d]{64}$/.test(container)) {
    run('docker', ['rm', '--force', container], { stdio: 'ignore' });
    console.log('Removed only the ephemeral container created by this test run.');
  }
}
