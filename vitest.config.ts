import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@forge/core/events': path.resolve(__dirname, 'packages/core/src/events/index.ts'),
      '@forge/core/errors': path.resolve(__dirname, 'packages/core/src/errors/index.ts'),
      '@forge/core/interfaces': path.resolve(__dirname, 'packages/core/src/interfaces/index.ts'),
      '@forge/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@forge/safety': path.resolve(__dirname, 'packages/safety/src/index.ts'),
      '@forge/state': path.resolve(__dirname, 'packages/state/src/index.ts'),
      '@forge/tui': path.resolve(__dirname, 'packages/tui/src/index.ts'),
      '@forge/vscode': path.resolve(__dirname, 'packages/vscode/src/index.ts'),
      '@forge/cli': path.resolve(__dirname, 'packages/cli/src/index.ts'),
      '@forge/bench': path.resolve(__dirname, 'packages/bench/src/index.ts'),
    },
  },
});
