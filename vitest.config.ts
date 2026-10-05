import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@shared': path.resolve(import.meta.dirname, 'shared') },
  },
  test: {
    include: ['apps/**/*.test.ts', 'shared/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
