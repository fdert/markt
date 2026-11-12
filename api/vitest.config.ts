import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

// ترتيب ثابت لملفات الاختبار لأنها تتشارك قاعدة بيانات واحدة (اختبار الهيئة يعمل أخيراً)
class AlphaSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/raseed_test', NODE_ENV: 'test' },
    testTimeout: 30000, hookTimeout: 120000, fileParallelism: false,
    sequence: { sequencer: AlphaSequencer },
  },
});
