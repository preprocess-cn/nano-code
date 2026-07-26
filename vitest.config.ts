import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '#src': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/*.test.ts', 'tests/e2e/*.test.ts'],
  },
});
