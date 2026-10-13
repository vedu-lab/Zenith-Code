import { describe, it, expect } from 'vitest';
import { CoreEventBus, SystemClock } from '@forge/core';
import { SessionManager } from '../src/sessions/index.js';
import { UsageLedger } from '../src/ledger/index.js';
import { WorkspaceIndex } from '../src/index/index.js';

describe('State Management', () => {
  it('should create and close sessions while emitting events', async () => {
    const clock = new SystemClock();
    const eventBus = new CoreEventBus();
    const manager = new SessionManager(clock, eventBus);

    const session = await manager.createSession('Refactor Auth');
    expect(session.id).toBeDefined();
    expect(session.title).toBe('Refactor Auth');
    expect(session.status).toBe('active');

    expect(manager.getActiveSession()?.id).toBe(session.id);

    await manager.closeSession(session.id, 'Task finished');
    expect(manager.getActiveSession()).toBeUndefined();
    expect(manager.listSessions()[0]?.status).toBe('completed');
  });

  it('should track token usage and calculate costs in UsageLedger', async () => {
    const clock = new SystemClock();
    const ledger = new UsageLedger(clock);

    await ledger.recordUsage('sess-1', 'claude-3-5-sonnet', 1000, 500);
    expect(ledger.getTotalTokens('sess-1')).toBe(1500);
    expect(ledger.getTotalCost('sess-1')).toBeGreaterThan(0);
  });

  it('should index and find files by extension', () => {
    const index = new WorkspaceIndex('/workspace');
    index.addFile('src/main.ts', 1024, ['bootstrap', 'main']);
    index.addFile('src/utils.ts', 512, ['format']);
    index.addFile('README.md', 256, []);

    const tsFiles = index.findFilesByExtension('.ts');
    expect(tsFiles).toHaveLength(2);

    const symMatches = index.searchSymbols('boot');
    expect(symMatches).toHaveLength(1);
    expect(symMatches[0]?.relativePath).toBe('src/main.ts');
  });

  it('should initialize SqliteStore schema', async () => {
    const { SqliteStore } = await import('../src/db/index.js');
    const store = new SqliteStore();
    expect(store.raw).toBeDefined();
    store.close();
  });
});
