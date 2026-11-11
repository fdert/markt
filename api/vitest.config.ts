import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/raseed_test', NODE_ENV: 'test' },
    testTimeout: 30000, hookTimeout: 120000, fileParallelism: false,
  },
});
