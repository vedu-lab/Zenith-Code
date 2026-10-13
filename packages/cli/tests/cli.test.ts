import { describe, it, expect } from 'vitest';
import { bootstrapApp, NodeFileSystem } from '../src/index.js';

describe('CLI Bootstrap & Drivers', () => {
  it('should initialize container with all dependencies injected', async () => {
    const container = bootstrapApp();

    expect(container.clock).toBeDefined();
    expect(container.fs).toBeDefined();
    expect(container.processRunner).toBeDefined();
    expect(container.eventBus).toBeDefined();
    expect(container.policyEngine).toBeDefined();
    expect(container.sessionManager).toBeDefined();

    const session = await container.sessionManager.createSession('Test CLI Session');
    expect(session.title).toBe('Test CLI Session');

    const result = await container.agentLoop.runStep(1, [{ role: 'user', content: 'Ping' }], {
      sessionId: session.id,
    });
    expect(result.completed).toBe(true);
    expect(result.messages).toHaveLength(2);

    container.sqliteStore.close();
  });

  it('should preserve CRLF line endings when modifying content', () => {
    const fs = new NodeFileSystem();
    const original = 'first line\r\nsecond line\r\n';
    const modified = 'first line\nsecond line\nthird line\n';

    const preserved = fs.preserveLineEndings(original, modified);
    expect(preserved).toBe('first line\r\nsecond line\r\nthird line\r\n');
  });

  it('should preserve LF line endings when modifying content', () => {
    const fs = new NodeFileSystem();
    const original = 'first line\nsecond line\n';
    const modified = 'first line\r\nsecond line\r\nthird line\r\n';

    const preserved = fs.preserveLineEndings(original, modified);
    expect(preserved).toBe('first line\nsecond line\nthird line\n');
  });
});
