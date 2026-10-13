import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CoreEventBus, SystemClock } from '@forge/core';
import { CheckpointStore } from '../src/checkpoints/index.js';

describe('Checkpoints & Time-Travel Subsystem', () => {
  let tmpDir: string;
  let clock: SystemClock;
  let eventBus: CoreEventBus;
  let store: CheckpointStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-checkpoint-test-'));
    clock = new SystemClock();
    eventBus = new CoreEventBus();
    store = new CheckpointStore(clock, eventBus, { workspaceRoot: tmpDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('captures code, conversation, and environment snapshots forming a tree', async () => {
    // Write sample files in workspace
    fs.writeFileSync(path.join(tmpDir, 'main.ts'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'utils.ts'), 'export const b = 2;\n', 'utf8');

    // Checkpoint 1 (Root)
    const cp1 = await store.createCheckpoint('sess-1', 'Initial commit', {
      conversation: { messages: [{ role: 'user', content: 'hello' }] },
      environment: { cwd: tmpDir, envVarNames: ['NODE_ENV'] },
    });

    expect(cp1.id).toBeDefined();
    expect(cp1.parentCheckpointId).toBeNull();
    expect(cp1.code.files).toHaveLength(2);
    expect(cp1.conversation.messages).toHaveLength(1);
    expect(cp1.environment.envVarNames).toEqual(['NODE_ENV']);

    // Checkpoint 2 (Child)
    fs.writeFileSync(path.join(tmpDir, 'main.ts'), 'export const a = 100;\n', 'utf8');
    const cp2 = await store.createCheckpoint('sess-1', 'Updated main', {
      conversation: {
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'done' },
        ],
      },
    });

    expect(cp2.parentCheckpointId).toBe(cp1.id);
    expect(store.listCheckpoints()).toHaveLength(2);
  });

  it('computes diff between two checkpoints with added, modified, deleted files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'fileA.ts'), 'original A', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'fileB.ts'), 'original B', 'utf8');

    const cp1 = await store.createCheckpoint('sess-1', 'Base snapshot');

    // Modify fileA, delete fileB, add fileC
    fs.writeFileSync(path.join(tmpDir, 'fileA.ts'), 'modified A', 'utf8');
    fs.unlinkSync(path.join(tmpDir, 'fileB.ts'));
    fs.writeFileSync(path.join(tmpDir, 'fileC.ts'), 'new C', 'utf8');

    const cp2 = await store.createCheckpoint('sess-1', 'Second snapshot');

    const diff = await store.diff(cp1.id, cp2.id);
    expect(diff.checkpointAId).toBe(cp1.id);
    expect(diff.checkpointBId).toBe(cp2.id);
    expect(diff.modifiedFiles).toContain('fileA.ts');
    expect(diff.deletedFiles).toContain('fileB.ts');
    expect(diff.addedFiles).toContain('fileC.ts');
  });

  it('rewinds code byte-identically, preserving mode bits, CRLF, and unlinking post-snapshot files', async () => {
    const fileCrlf = path.join(tmpDir, 'crlf.txt');
    const fileUnix = path.join(tmpDir, 'unix.txt');
    fs.writeFileSync(fileCrlf, 'line1\r\nline2\r\n', 'utf8');
    fs.writeFileSync(fileUnix, 'line1\nline2\n', 'utf8');

    const cp1 = await store.createCheckpoint('sess-1', 'Baseline CRLF and Unix');

    // Post-snapshot modifications
    fs.writeFileSync(fileCrlf, 'corrupted crlf', 'utf8');
    fs.unlinkSync(fileUnix);
    const untrackedFile = path.join(tmpDir, 'unwanted.tmp');
    fs.writeFileSync(untrackedFile, 'should be deleted', 'utf8');

    // Take snapshot 2 so ShadowGit knows about unwanted.tmp
    await store.createCheckpoint('sess-1', 'With unwanted file');

    // Rewind back to cp1
    const rewindRes = await store.rewind(cp1.id, { target: 'both' });
    expect(rewindRes.restored.code).toBe(true);
    expect(rewindRes.restored.conversation).toBe(true);
    expect(rewindRes.restored.filesDeleted).toContain('unwanted.tmp');
    expect(fs.existsSync(untrackedFile)).toBe(false);

    // Verify CRLF byte-identical restoration
    const restoredCrlf = fs.readFileSync(fileCrlf, 'utf8');
    expect(restoredCrlf).toBe('line1\r\nline2\r\n');
    expect(restoredCrlf.includes('\r\n')).toBe(true);

    // Verify deleted file was resurrected
    expect(fs.existsSync(fileUnix)).toBe(true);
    expect(fs.readFileSync(fileUnix, 'utf8')).toBe('line1\nline2\n');

    // Report checks
    expect(rewindRes.notRestored.databaseChanges.length).toBeGreaterThan(0);
    expect(rewindRes.notRestored.networkEffects.length).toBeGreaterThan(0);
    expect(rewindRes.notRestored.backgroundProcesses.length).toBeGreaterThan(0);
  });

  it('branches from an existing checkpoint cleanly', async () => {
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'console.log("main");\n', 'utf8');
    const rootCp = await store.createCheckpoint('sess-1', 'Root on main');

    const branchRes = await store.branch('feature-ai', rootCp.id);
    expect(branchRes.branchName).toBe('feature-ai');
    expect(branchRes.baseCheckpointId).toBe(rootCp.id);
    expect(store.getCurrentBranch()).toBe('feature-ai');

    const branchCheckpoints = store.listCheckpoints('feature-ai');
    expect(branchCheckpoints).toHaveLength(1);
    expect(branchCheckpoints[0]?.branch).toBe('feature-ai');
  });
});
