import { execSync } from 'node:child_process';
import pg from 'pg';

export default async function () {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/raseed_test';
  const admin = new pg.Client({ connectionString: url.replace(/\/[^/?]+(\?.*)?$/, '/postgres') });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS raseed_test WITH (FORCE)');
  await admin.query('CREATE DATABASE raseed_test');
  await admin.end();
  const env = { ...process.env, DATABASE_URL: url };
  execSync('npx drizzle-kit push --force', { env, stdio: 'ignore' });
  execSync('npx tsx src/seed.ts', { env, stdio: 'ignore' });
  process.env.DATABASE_URL = url;
}
