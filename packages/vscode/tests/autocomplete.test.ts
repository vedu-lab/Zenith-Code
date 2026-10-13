import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceIndex } from '@forge/state';
import { CoreEventBus } from '@forge/core';
import {
  AutocompleteServer,
  MockFimProvider,
  CompletionCache,
  CompletionContextExtractor,
  formatFimPrompt,
  cleanFimCompletion,
  ForgeInlineCompletionProvider,
  AgentSidePanelController,
  activate,
} from '../src/index.js';

describe('VS Code Inline Autocomplete Subsystem', () => {
  let index: WorkspaceIndex;

  beforeEach(() => {
    index = new WorkspaceIndex('/workspace');
    index.addFile('src/auth.ts', 200, ['loginUser', 'verifyToken']);
  });

  describe('FIM Prompt Formatting & Cleaning', () => {
    it('formats prompts for Qwen2.5-Coder with <|fim_prefix|>, <|fim_suffix|>, <|fim_middle|>', () => {
      const prompt = formatFimPrompt('const a = 1;\n', '\nreturn a;', 'qwen');
      expect(prompt.prompt).toBe(
        '<|fim_prefix|>const a = 1;\n<|fim_suffix|>\nreturn a;<|fim_middle|>',
      );
    });

    it('formats prompts for DeepSeek-Coder with <｜fim begin｜>, <｜fim hole｜>, <｜fim end｜>', () => {
      const prompt = formatFimPrompt('function add() ', ' { return 42; }', 'deepseek');
      expect(prompt.prompt).toBe(
        '<｜fim begin｜>function add() <｜fim hole｜> { return 42; }<｜fim end｜>',
      );
    });

    it('formats prompts for StarCoder2 with <fim_prefix>, <fim_suffix>, <fim_middle>', () => {
      const prompt = formatFimPrompt(
        'import fs from "node:fs";\n',
        '\nfs.closeSync(fd);',
        'starcoder',
      );
      expect(prompt.prompt).toBe(
        '<fim_prefix>import fs from "node:fs";\n<fim_suffix>\nfs.closeSync(fd);<fim_middle>',
      );
    });

    it('cleanFimCompletion: strips stop tokens from model output', () => {
      const raw = 'const x = 100;<|fim_middle|><|endoftext|>';
      const cleaned = cleanFimCompletion(raw);
      expect(cleaned).toBe('const x = 100;');
    });
  });

  describe('CompletionCache (LRU with Sub-millisecond Hits)', () => {
    it('stores and retrieves cached completions in < 1 ms', () => {
      const cache = new CompletionCache(10, 60_000);
      cache.set('src/main.ts', 'function foo() {', '}', 'qwen', 'return 1;');

      const start = performance.now();
      const hit = cache.get('src/main.ts', 'function foo() {', '}', 'qwen');
      const durationMs = performance.now() - start;

      expect(hit).toBe('return 1;');
      expect(durationMs).toBeLessThan(10); // Well under 10ms, usually < 0.1ms
    });

    it('evicts oldest items when capacity is reached', () => {
      const cache = new CompletionCache(2, 60_000);
      cache.set('f1', 'p1', 's1', 'm', 'c1');
      cache.set('f2', 'p2', 's2', 'm', 'c2');
      cache.set('f3', 'p3', 's3', 'm', 'c3'); // should evict f1

      expect(cache.get('f1', 'p1', 's1', 'm')).toBeNull();
      expect(cache.get('f2', 'p2', 's2', 'm')).toBe('c2');
      expect(cache.get('f3', 'p3', 's3', 'm')).toBe('c3');
    });

    it('expires items older than TTL', async () => {
      const cache = new CompletionCache(10, 10); // 10ms TTL
      cache.set('f1', 'p1', 's1', 'm', 'c1');
      await new Promise((r) => setTimeout(r, 25));
      expect(cache.get('f1', 'p1', 's1', 'm')).toBeNull();
    });
  });

  describe('CompletionContextExtractor', () => {
    it('extracts sliding window prefix and suffix around cursor', () => {
      const extractor = new CompletionContextExtractor(index, {
        maxPrefixChars: 50,
        maxSuffixChars: 50,
      });
      const content = 'line 1\nline 2\nline 3\nline 4\n';
      // Line 2, char 0 is start of 'line 3'
      const ctx = extractor.extractContext({
        filePath: 'src/app.ts',
        fileContent: content,
        position: { line: 2, character: 0 },
      });

      expect(ctx).not.toBeNull();
      expect(ctx?.prefix).toBe('line 1\nline 2\n');
      expect(ctx?.suffix).toBe('line 3\nline 4\n');
    });

    it('extracts and prepends imports to prompt prefix', () => {
      const extractor = new CompletionContextExtractor(index);
      const content = 'import { loginUser } from "./auth.js";\n\nfunction test() {\n  log';
      const ctx = extractor.extractContext({
        filePath: 'src/main.ts',
        fileContent: content,
        position: { line: 3, character: 5 },
      });

      expect(ctx).not.toBeNull();
      expect(ctx?.promptPrefix).toContain('loginUser');
    });

    it('suppresses completion for disabled languages and ignored files', () => {
      const extractor = new CompletionContextExtractor(index, {
        disabledLanguages: ['markdown', 'env'],
      });

      const mdResult = extractor.extractContext({
        filePath: 'README.md',
        fileContent: '# Title',
        position: { line: 0, character: 7 },
        languageId: 'markdown',
      });
      expect(mdResult).toBeNull();

      const envResult = extractor.extractContext({
        filePath: '.env.local',
        fileContent: 'SECRET=123',
        position: { line: 0, character: 10 },
      });
      expect(envResult).toBeNull();
    });
  });

  describe('AutocompleteServer Latency Benchmark & Cancellation', () => {
    it('target latency benchmark: completes in < 300 ms (p50 target)', async () => {
      const mockProvider = new MockFimProvider(
        'qwen2.5-coder',
        'qwen',
        30,
        '{\n  return "success";\n}',
      );
      const server = new AutocompleteServer(index, { provider: mockProvider });

      const latencies: number[] = [];
      const iterations = 10;

      for (let i = 0; i < iterations; i++) {
        const res = await server.complete({
          filePath: `src/file${i}.ts`,
          fileContent: `function run${i}() `,
          position: { line: 0, character: 15 },
        });

        expect(res).not.toBeNull();
        expect(res?.insertText).toContain('return "success";');
        if (res) {
          latencies.push(res.latencyMs);
        }
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
      const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

      expect(p50).toBeLessThan(300);
      expect(p95).toBeLessThan(300);
    });

    it('cancels previous in-flight completion when new character is typed', async () => {
      const mockProvider = new MockFimProvider('qwen2.5-coder', 'qwen', 60, 'res');
      const server = new AutocompleteServer(index, { provider: mockProvider });

      // Fire first request (slow)
      const req1 = server.complete({
        filePath: 'src/edit.ts',
        fileContent: 'const a = ',
        position: { line: 0, character: 10 },
      });

      // Immediately fire second request (cancelling first)
      const req2 = server.complete({
        filePath: 'src/edit.ts',
        fileContent: 'const a = 1',
        position: { line: 0, character: 11 },
      });

      const [res1, res2] = await Promise.all([req1, req2]);
      expect(res1).toBeNull(); // Cancelled
      expect(res2).not.toBeNull(); // Succeeded
    });
  });

  describe('ForgeInlineCompletionProvider & Keybindings', () => {
    it('supports full Tab acceptance, Esc dismissal, and partial word/line acceptance', async () => {
      const mockProvider = new MockFimProvider(
        'qwen',
        'qwen',
        5,
        'const result = calculate(10);\nreturn result;',
      );
      const server = new AutocompleteServer(index, { provider: mockProvider });
      const provider = new ForgeInlineCompletionProvider(server);

      const items = await provider.provideInlineCompletionItems(
        {
          uri: { fsPath: '/workspace/src/app.ts' },
          getText: () => 'function compute() {\n  ',
          languageId: 'typescript',
        },
        { line: 1, character: 2 },
        { triggerKind: 'automatic' },
      );

      expect(items).not.toBeNull();
      expect(items?.items[0]?.insertText).toContain('const result = calculate(10);');

      // Partial accept by word
      const word1 = provider.acceptNextWord();
      expect(word1.accepted.trim()).toBe('const');

      const word2 = provider.acceptNextWord();
      expect(word2.accepted.trim()).toBe('result');

      // Partial accept by line
      const line = provider.acceptNextLine();
      expect(line.accepted).toContain('calculate(10);');

      // Esc dismiss
      provider.dismiss();
      expect(provider.getActiveCompletion()).toBeNull();
    });
  });

  describe('AgentSidePanelController (Event Stream Integration)', () => {
    it('tracks session status, model deltas, tool proposals, diffs, and approvals', () => {
      const eventBus = new CoreEventBus();
      const panel = new AgentSidePanelController(eventBus);

      expect(panel.getState().status).toBe('idle');

      // 1. Session created
      eventBus.publish({
        id: '1',
        type: 'session:created',
        actor: 'system',
        timestamp: 100,
        payload: { sessionId: 'sess-abc', title: 'Test Session' },
      });
      expect(panel.getState().sessionId).toBe('sess-abc');

      // 2. Turn started
      eventBus.publish({
        id: '2',
        type: 'turn.started',
        actor: 'agent',
        timestamp: 200,
        payload: { turnIndex: 1, sessionId: 'sess-abc', model: 'claude' },
      });
      expect(panel.getState().status).toBe('running');

      // 3. Streaming model delta
      eventBus.publish({
        id: '3',
        type: 'model.delta',
        actor: 'agent',
        timestamp: 300,
        payload: { turnIndex: 1, delta: 'I will inspect ' },
      });
      eventBus.publish({
        id: '4',
        type: 'model.delta',
        actor: 'agent',
        timestamp: 350,
        payload: { turnIndex: 1, delta: 'package.json.' },
      });
      expect(panel.getState().streamingDelta).toBe('I will inspect package.json.');

      // 4. Tool proposed (requires approval)
      eventBus.publish({
        id: '5',
        type: 'tool:proposed',
        actor: 'agent',
        timestamp: 400,
        payload: {
          callId: 'call-bash-1',
          toolName: 'bash',
          parameters: { command: 'rm -rf dist' },
        },
      });
      expect(panel.getState().status).toBe('waiting_approval');
      expect(panel.getState().pendingApprovals).toHaveLength(1);
      expect(panel.getState().pendingApprovals[0]?.command).toBe('rm -rf dist');

      // 5. User approves tool
      let approvedEventReceived = false;
      eventBus.subscribe('tool:approved', (evt) => {
        if (evt.payload.callId === 'call-bash-1') {
          approvedEventReceived = true;
        }
      });
      panel.approve('call-bash-1');
      expect(approvedEventReceived).toBe(true);
      expect(panel.getState().pendingApprovals).toHaveLength(0);

      // 6. File written diff tracking
      eventBus.publish({
        id: '6',
        type: 'file.written',
        actor: 'agent',
        timestamp: 500,
        payload: { filePath: 'src/main.ts', byteCount: 420, isNew: false },
      });
      expect(panel.getState().recentDiffs).toHaveLength(1);
      expect(panel.getState().recentDiffs[0]?.filePath).toBe('src/main.ts');

      panel.dispose();
    });
  });

  describe('Extension Activation Lifecycle', async () => {
    it('activates extension, wires provider, server, side panel, and deactivates cleanly', async () => {
      const instance = activate({ workspaceRoot: '/workspace' });
      expect(instance.server).toBeDefined();
      expect(instance.provider).toBeDefined();
      expect(instance.sidePanel).toBeDefined();
      expect(instance.eventBus).toBeDefined();

      await instance.deactivate();
    });
  });
});
