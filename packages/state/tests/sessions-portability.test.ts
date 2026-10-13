import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CoreEventBus, SystemClock } from '@forge/core';
import {
  SessionManager,
  exportSession,
  importSession,
  initProject,
  VersionedSessionFile,
} from '../src/sessions/index.js';

describe('Sessions & Portability Subsystem', () => {
  let tmpDir: string;
  let clock: SystemClock;
  let eventBus: CoreEventBus;
  let manager: SessionManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-session-test-'));
    clock = new SystemClock();
    eventBus = new CoreEventBus();
    manager = new SessionManager(clock, eventBus, { workspaceRoot: tmpDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('creates, saves to disk, resumes, and closes versioned session files', async () => {
    const session = await manager.createSession('Refactor Authentication');
    expect(session.id).toBeDefined();
    expect(session.schemaVersion).toBe('1.0.0');

    const sessionFile = path.join(tmpDir, '.forge', 'sessions', `${session.id}.json`);
    expect(fs.existsSync(sessionFile)).toBe(true);

    const resumed = await manager.resumeSession(session.id);
    expect(resumed.status).toBe('active');

    const closed = await manager.closeSession(session.id, 'Finished refactoring');
    expect(closed.status).toBe('completed');
    expect(closed.stopReason).toBe('Finished refactoring');
  });

  it('exports and imports session files validating schemaVersion 1.0.0', () => {
    const sample: VersionedSessionFile = {
      schemaVersion: '1.0.0',
      id: 'sess-export-1',
      title: 'Fix issue #42',
      createdAt: 1000,
      updatedAt: 2000,
      status: 'completed',
      messages: [{ role: 'user', content: 'Fix the bug' }],
      toolCalls: [],
      checkpointRefs: ['chk-1'],
      memoryRefs: ['mem-1'],
      usage: {
        totalPromptTokens: 500,
        totalCompletionTokens: 100,
        totalCostUsd: 0.005,
      },
    };

    const exportedJson = exportSession(sample, 'json');
    const imported = importSession(exportedJson);

    expect(imported.id).toBe('sess-export-1');
    expect(imported.schemaVersion).toBe('1.0.0');
    expect(imported.usage.totalCostUsd).toBe(0.005);

    // Invalid schema throws
    expect(() => importSession('{"schemaVersion": "2.0.0"}')).toThrow(
      /Invalid session file schema/,
    );
    expect(() => importSession('{bad json')).toThrow(/Failed to parse session JSON/);
  });

  it('initProject generates and syncs instruction files with headers and catches contradictions', async () => {
    // Create conflicting .cursorrules and copilot-instructions
    fs.writeFileSync(
      path.join(tmpDir, '.cursorrules'),
      'Always use npm install for dependencies. Feel free to allow any in types.',
      'utf8',
    );
    const githubDir = path.join(tmpDir, '.github');
    fs.mkdirSync(githubDir, { recursive: true });
    fs.writeFileSync(
      path.join(githubDir, 'copilot-instructions.md'),
      'Run unit tests with jest.',
      'utf8',
    );

    // Custom AGENTS.md mandating pnpm, vitest, and no any
    fs.writeFileSync(
      path.join(tmpDir, 'AGENTS.md'),
      '# Rules\nAlways use pnpm. Run tests with vitest. Strict TypeScript with no any.',
      'utf8',
    );

    const result = await initProject({ projectRoot: tmpDir });

    expect(result.syncedFiles).toContain('CLAUDE.md');
    expect(result.syncedFiles).toContain('GEMINI.md');

    // Headers verified
    const claudeContent = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    expect(claudeContent).toContain('<!-- Generated from AGENTS.md. DO NOT EDIT DIRECTLY. -->');

    // Contradictions reported
    expect(result.contradictions.length).toBeGreaterThanOrEqual(3);
    const text = result.contradictions.join(' ');
    expect(text).toContain('npm');
    expect(text).toContain('jest');
    expect(text).toContain('any');
  });
});
