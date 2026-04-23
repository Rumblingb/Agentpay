import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/rcm*.ts', 'src/cron/rcmAutonomyLoop.ts'],
    },
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
  },
  plugins: [],
});
