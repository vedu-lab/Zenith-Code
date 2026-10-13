import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SystemClock } from '@forge/core';
import { ProjectMemoryStore, MemoryScanner } from '../src/memory/index.js';
import { SqliteStore } from '../src/db/index.js';

describe('Project Memory Subsystem', () => {
  let tmpDir: string;
  let clock: SystemClock;
  let sqliteStore: SqliteStore;
  let memoryStore: ProjectMemoryStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-memory-test-'));
    clock = new SystemClock();
    sqliteStore = new SqliteStore({ filename: ':memory:' });
    memoryStore = new ProjectMemoryStore(clock, {
      workspaceRoot: tmpDir,
      sqliteStore,
    });
  });

  afterEach(() => {
    sqliteStore.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('scans and rejects sensitive secrets and PII from memory proposals and saves', async () => {
    const scanner = new MemoryScanner();
    expect(scanner.scan('Normal safe observation.').hasSensitiveData).toBe(false);
    expect(scanner.scan('API key sk-abcdef1234567890abcdef1234567890 here').hasSensitiveData).toBe(
      true,
    );
    expect(scanner.scan('Contact user at test@example.com for help').hasSensitiveData).toBe(true);
    expect(scanner.scan('SSN is 000-12-3456').hasSensitiveData).toBe(true);

    // Should reject saving secret
    await expect(
      memoryStore.saveMemory({
        statement: 'Found api key sk-ant-api03-abcdef12345678901234567890',
        source: 'observed',
        evidence: 'in .env',
      }),
    ).rejects.toThrow(/sensitive data/);
  });

  it('proposes memories, requires approval, and writes readable markdown + sqlite', async () => {
    const prop = await memoryStore.propose({
      statement: 'Use pnpm instead of npm across monorepo packages.',
      source: 'user',
      evidence: 'Stated in AGENTS.md',
      confidence: 1.0,
      scope: 'project',
    });

    expect(prop.id).toBeDefined();
    expect(memoryStore.getPendingProposals()).toHaveLength(1);

    // Not yet in active search
    expect(memoryStore.search({ query: 'pnpm' })).toHaveLength(0);

    // Approve proposal
    const entry = await memoryStore.approve(prop.id);
    expect(entry.id).toBeDefined();
    expect(entry.status).toBe('active');
    expect(memoryStore.getPendingProposals()).toHaveLength(0);

    // Markdown file written on disk
    const memFile = path.join(tmpDir, '.forge', 'memory', `${entry.id}.md`);
    expect(fs.existsSync(memFile)).toBe(true);
    const raw = fs.readFileSync(memFile, 'utf8');
    expect(raw).toContain('## Statement');
    expect(raw).toContain('Use pnpm instead of npm');

    // SQLite index updated
    const searchRes = memoryStore.search({ query: 'pnpm' });
    expect(searchRes).toHaveLength(1);
    expect(searchRes[0]?.statement).toContain('Use pnpm');
  });

  it('marks memories stale on conflicting facts or failures', async () => {
    const entry = await memoryStore.saveMemory({
      statement: 'Docker daemon is listening on port 2375.',
      source: 'observed',
      evidence: 'netstat output',
      confidence: 0.8,
    });

    const updated = await memoryStore.markStale(entry.id, 'Connection refused on port 2375');
    expect(updated.status).toBe('stale');
    expect(updated.evidence).toContain('Connection refused');

    // Active search excludes stale by default
    expect(memoryStore.search({ query: 'Docker' })).toHaveLength(0);
    // Search with status stale includes it
    expect(memoryStore.search({ status: 'stale' })).toHaveLength(1);
  });

  it('edits and deletes memories completely from disk and SQLite', async () => {
    const entry = await memoryStore.saveMemory({
      statement: 'Test runner is vitest.',
      source: 'observed',
      evidence: 'package.json devDependencies',
    });

    const edited = await memoryStore.edit(entry.id, {
      statement: 'Test runner is vitest with coverage enabled.',
    });
    expect(edited.statement).toContain('coverage enabled');

    const deleted = await memoryStore.delete(entry.id);
    expect(deleted).toBe(true);
    expect(memoryStore.search({ query: 'vitest' })).toHaveLength(0);

    const memFile = path.join(tmpDir, '.forge', 'memory', `${entry.id}.md`);
    expect(fs.existsSync(memFile)).toBe(false);
  });

  it('exports memories to JSON and Markdown', async () => {
    await memoryStore.saveMemory({
      statement: 'Project uses TypeScript strict mode.',
      source: 'user',
      evidence: 'tsconfig.base.json',
    });

    const json = memoryStore.export('json');
    expect(json).toContain('TypeScript strict mode');

    const md = memoryStore.export('markdown');
    expect(md).toContain('### [PROJECT] Project uses TypeScript strict mode.');
  });
});
