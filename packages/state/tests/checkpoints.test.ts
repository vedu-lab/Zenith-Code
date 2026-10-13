import { describe, it, expect } from 'vitest';
import { CoreEventBus, SystemClock, IFileSystem } from '@forge/core';
import { CheckpointStore, FileSnapshot } from '../src/checkpoints/index.js';

describe('CheckpointStore', () => {
  it('should create and restore checkpoints and write files', async () => {
    const writtenFiles = new Map<string, string>();
    const mockFs: IFileSystem = {
      readFile: async (p) => writtenFiles.get(p) ?? '',
      writeFile: async (p, content) => {
        writtenFiles.set(p, content);
      },
      exists: async (p) => writtenFiles.has(p),
      mkdir: async () => {},
      preserveLineEndings: (_orig, next) => next,
    };

    const clock = new SystemClock();
    const eventBus = new CoreEventBus();
    const store = new CheckpointStore(clock, eventBus, mockFs);

    const snapshots: FileSnapshot[] = [
      { path: 'src/index.ts', content: 'export const version = "1.0.0";' },
    ];

    const checkpoint = await store.createCheckpoint('sess-100', 'Initial release', snapshots);
    expect(checkpoint.id).toBeDefined();
    expect(checkpoint.sessionId).toBe('sess-100');

    // Simulate modifying file
    await mockFs.writeFile('src/index.ts', 'broken code');
    expect(await mockFs.readFile('src/index.ts')).toBe('broken code');

    // Restore
    const restored = await store.restoreCheckpoint(checkpoint.id);
    expect(restored).toBeDefined();
    expect(await mockFs.readFile('src/index.ts')).toBe('export const version = "1.0.0";');
  });
});
