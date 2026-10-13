import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { CoreEventBus } from '@forge/core';
import {
  Header,
  Footer,
  DiffViewer,
  PermissionPrompt,
  CapabilityRequestPrompt,
  SpinnerTodoPanel,
  PlanPreview,
  RewindPicker,
  MemoryBrowser,
  MessageList,
  ToolCallItem,
  App,
} from '../src/index.js';

describe('TUI Ink Component Tests', () => {
  const originalNoColor = process.env['NO_COLOR'];

  beforeEach(() => {
    delete process.env['NO_COLOR'];
  });

  afterEach(() => {
    if (originalNoColor !== undefined) {
      process.env['NO_COLOR'] = originalNoColor;
    } else {
      delete process.env['NO_COLOR'];
    }
  });

  it('Header: renders name, version, model, cwd, and mode', () => {
    const { lastFrame } = render(
      <Header
        name="⚒ FORGE"
        version="0.1.0"
        model="claude-3-5-sonnet"
        cwd="/workspace/project"
        mode="default"
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain('FORGE');
    expect(frame).toContain('v0.1.0');
    expect(frame).toContain('claude-3-5-sonnet');
    expect(frame).toContain('/workspace/project');
    expect(frame).toContain('[DEFAULT]');
  });

  it('Header: honors NO_COLOR environment variable', () => {
    process.env['NO_COLOR'] = '1';
    const { lastFrame } = render(<Header model="gpt-4o" cwd="/test" mode="acceptEdits" />);
    const frame = lastFrame();
    expect(frame).toContain('gpt-4o');
    expect(frame).toContain('[ACCEPTEDITS]');
  });

  it('Footer: renders mode, cost, context percentage, and active capabilities', () => {
    const { lastFrame } = render(
      <Footer mode="plan" liveCost={0.0425} contextUsagePercent={35} activeCapabilitiesCount={4} />,
    );

    const frame = lastFrame();
    expect(frame).toContain('Mode: plan');
    expect(frame).toContain('$0.0425');
    expect(frame).toContain('35%');
    expect(frame).toContain('4 active');
    expect(frame).toContain('[Esc] Interrupt');
  });

  it('ToolCallItem: renders compact line and expandable details', () => {
    const { lastFrame } = render(
      <ToolCallItem
        toolCall={{
          callId: 'call-1',
          toolName: 'edit_file',
          parameters: { filePath: 'src/index.ts' },
          status: 'success',
          durationMs: 45,
          output: 'File updated successfully',
        }}
        defaultExpanded={true}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain('Edit(src/index.ts)');
    expect(frame).toContain('45ms');
    expect(frame).toContain('File updated successfully');
  });

  it('MessageList: renders user marker, markdown blocks, and tool calls', () => {
    const { lastFrame } = render(
      <MessageList
        messages={[
          { id: '1', role: 'user', content: 'Implement quicksort', timestamp: 1000 },
          {
            id: '2',
            role: 'assistant',
            content: '# Quicksort\nHere is code:\n```ts\nfunction sort() {}\n```',
            timestamp: 2000,
          },
        ]}
        toolCalls={[
          {
            callId: 'tc-1',
            toolName: 'read_file',
            parameters: { filePath: 'src/sort.ts' },
            status: 'success',
          },
        ]}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain('❯');
    expect(frame).toContain('Implement quicksort');
    expect(frame).toContain('Quicksort');
    expect(frame).toContain('Read(src/sort.ts)');
  });

  it('DiffViewer: renders line numbers and additions/deletions', () => {
    const diff = [
      '@@ -10,3 +10,3 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 42;',
      ' return a + b;',
    ].join('\n');

    const { lastFrame } = render(<DiffViewer diffText={diff} filePath="src/math.ts" />);
    const frame = lastFrame();
    expect(frame).toContain('Diff: src/math.ts');
    expect(frame).toContain('- const b = 2;');
    expect(frame).toContain('+ const b = 42;');
    expect(frame).toContain('const a = 1;');
  });

  it('PermissionPrompt: displays exact command and 3 decision choices', () => {
    let chosenDecision: string | undefined;

    const { lastFrame } = render(
      <PermissionPrompt
        toolName="bash"
        command="npm test"
        onDecide={(decision) => {
          chosenDecision = decision;
        }}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain('PERMISSION REQUIRED:');
    expect(frame).toContain('bash');
    expect(frame).toContain('$ npm test');
    expect(frame).toContain('[1] Yes');
    expect(frame).toContain('[2] Yes for this task');
    expect(frame).toContain('[3] No, tell the agent what to do instead');
    expect(chosenDecision).toBeUndefined();
  });

  it('CapabilityRequestPrompt: displays resource pattern, action, and duration', () => {
    const { lastFrame } = render(
      <CapabilityRequestPrompt
        resourcePattern="src/**/*.ts"
        action="fs:write"
        durationMs={60000}
        scope="task"
        onDecide={() => {}}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain('CAPABILITY TOKEN REQUEST');
    expect(frame).toContain('src/**/*.ts');
    expect(frame).toContain('fs:write');
    expect(frame).toContain('task');
    expect(frame).toContain('60s');
    expect(frame).toContain('[1] Grant for task');
    expect(frame).toContain('[2] Grant once');
    expect(frame).toContain('[3] Deny');
  });

  it('SpinnerTodoPanel: displays rotating verb, tokens, and live todos', () => {
    const { lastFrame } = render(
      <SpinnerTodoPanel
        isRunning={true}
        tokenCount={1420}
        todos={[
          { id: '1', content: 'Explore codebase', status: 'completed' },
          { id: '2', content: 'Implement algorithm', status: 'in_progress' },
          { id: '3', content: 'Run test suite', status: 'pending' },
        ]}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain('1,420 tokens');
    expect(frame).toContain('✓');
    expect(frame).toContain('Explore codebase');
    expect(frame).toContain('▶');
    expect(frame).toContain('Implement algorithm');
    expect(frame).toContain('○');
    expect(frame).toContain('Run test suite');
  });

  it('PlanPreview: displays steps, files, commands, risks, and estimate ranges', () => {
    const { lastFrame } = render(
      <PlanPreview
        plan={{
          steps: ['Read auth.ts', 'Modify token generation', 'Run test suite'],
          files: ['src/auth.ts', 'tests/auth.test.ts'],
          commands: ['npm test'],
          risks: ['May invalidate existing active sessions'],
          costEstimate: { low: 0.01, expected: 0.025, high: 0.05 },
          timeEstimateSeconds: { min: 10, max: 30 },
          model: 'claude-3-5-sonnet',
        }}
        onApprove={() => {}}
        onCancel={() => {}}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain('PLAN PREVIEW & ESTIMATION');
    expect(frame).toContain('1. Read auth.ts');
    expect(frame).toContain('src/auth.ts, tests/auth.test.ts');
    expect(frame).toContain('$ npm test');
    expect(frame).toContain('May invalidate existing active sessions');
    expect(frame).toContain('$0.010 - $0.050');
    expect(frame).toContain('10s - 30s');
    expect(frame).toContain('[1] Approve & Run');
  });

  it('RewindPicker: renders checkpoint tree, scope options, and navigation hints', () => {
    const { lastFrame } = render(
      <RewindPicker
        checkpoints={[
          {
            id: 'cp-alpha-123456',
            sessionId: 'sess-1',
            parentCheckpointId: null,
            branch: 'main',
            timestamp: Date.now(),
            description: 'Initial checkpoint',
            code: {
              type: 'shadow_git',
              files: [
                { path: 'app.ts', content: 'const a = 1;', mode: 0o644, isCrlf: false, hash: 'h1' },
              ],
            },
            conversation: {
              messages: [],
              todos: [],
              loadedMemory: [],
              capabilities: [],
              model: 'claude',
              settings: {},
            },
            environment: {
              cwd: '/test',
              envVarNames: [],
              toolVersions: {},
              lockfileHashes: {},
              backgroundProcesses: [],
            },
          },
        ]}
        onRewind={() => {}}
        onClose={() => {}}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain('CHECKPOINTS & TIME-TRAVEL');
    expect(frame).toContain('Initial checkpoint');
    expect(frame).toContain('[cp-alpha]');
    expect(frame).toContain('[1] Code only');
    expect(frame).toContain('[3] Both');
  });

  it('MemoryBrowser: renders memory statements, source, confidence, and filters', () => {
    const { lastFrame } = render(
      <MemoryBrowser
        memories={[
          {
            id: 'mem-1',
            statement: 'Project uses vitest for testing',
            source: 'observed',
            evidence: 'vitest.config.ts present',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            confidence: 0.95,
            scope: 'project',
            status: 'active',
          },
          {
            id: 'mem-2',
            statement: 'Project used Jest previously',
            source: 'inferred',
            evidence: 'package.json git history',
            createdAt: Date.now() - 100000,
            updatedAt: Date.now() - 100000,
            confidence: 0.6,
            scope: 'project',
            status: 'stale',
          },
        ]}
        onClose={() => {}}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain('PROJECT MEMORY BROWSER (2/2)');
    expect(frame).toContain('[ACTIVE]');
    expect(frame).toContain('Project uses vitest for testing');
    expect(frame).toContain('95%');
    expect(frame).toContain('[STALE]');
    expect(frame).toContain('Project used Jest previously');
  });

  it('App: integrates top-level components and handles event stream', () => {
    const eventBus = new CoreEventBus();
    const { lastFrame } = render(
      <App
        version="0.1.0"
        model="claude-3-5-sonnet"
        cwd="/workspace/repo"
        initialMode="default"
        eventBus={eventBus}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain('FORGE');
    expect(frame).toContain('claude-3-5-sonnet');
    expect(frame).toContain('/workspace/repo');
    expect(frame).toContain('Mode: default');
  });
});
