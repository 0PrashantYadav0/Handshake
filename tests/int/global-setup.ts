import { execSync } from 'node:child_process';
export function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/handshake_test';
  if (!new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a *_test database');
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}
