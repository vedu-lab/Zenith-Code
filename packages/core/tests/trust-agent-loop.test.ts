import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentLoop,
  DoneGate,
  EvidenceCollector,
  TaskPlanner,
  PlanDriftDetector,
  EscalationEngine,
  HumanHandoffManager,
  ToolRegistry,
  CoreEventBus,
  SystemClock,
  IProvider,
  IProcessRunner,
  IFileSystem,
  Message,
  ToolDefinition,
  ProviderStreamOptions,
  ProviderStreamEvent,
  ProcessRunResult,
  FileStatResult,
} from '../src/index.js';

class MockLlmProvider implements IProvider {
  constructor(private readonly responses: ProviderStreamEvent[][] = []) {}

  async *stream(
    _messages: readonly Message[],
    _tools: readonly ToolDefinition[],
    _options?: ProviderStreamOptions,
  ): AsyncIterable<ProviderStreamEvent> {
    const nextEvents = this.responses.shift() ?? [
      { type: 'text_delta', delta: 'Task completed successfully.' },
      { type: 'stop_reason', reason: 'end_turn' },
    ];
    for (const evt of nextEvents) {
      yield evt;
    }
  }
}

class MockRunner implements IProcessRunner {
  constructor(
    private readonly exitCode: number = 0,
    private readonly stdout: string = 'ok',
  ) {}

  async run(): Promise<ProcessRunResult> {
    return {
      stdout: this.stdout,
      stderr: this.exitCode !== 0 ? 'failure' : '',
      exitCode: this.exitCode,
    };
  }
}

class MockFs implements IFileSystem {
  private files = new Map<string, string>();

  set(path: string, content: string): void {
    this.files.set(path, content);
  }

  async readFile(filePath: string): Promise<string> {
    return this.files.get(filePath) ?? '';
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async mkdir(): Promise<void> {}
  async readDir(): Promise<readonly string[]> {
    return Array.from(this.files.keys());
  }
  async stat(_filePath: string): Promise<FileStatResult> {
    return { size: 0, isDirectory: false, mtimeMs: 0 };
  }
  preserveLineEndings(_orig: string, newContent: string): string {
    return newContent;
  }
}

describe('Trustworthy AgentLoop Integration', () => {
  let eventBus: CoreEventBus;
  let clock: SystemClock;
  let tools: ToolRegistry;

  beforeEach(() => {
    eventBus = new CoreEventBus();
    clock = new SystemClock();
    tools = new ToolRegistry();
  });

  it('verifies completed task through DoneGate and formats trust report', async () => {
    const provider = new MockLlmProvider([
      [
        { type: 'text_delta', delta: 'I am done with the changes.' },
        { type: 'stop_reason', reason: 'end_turn' },
      ],
    ]);

    const runner = new MockRunner(0, 'Tests passed');
    const fs = new MockFs();
    const evidenceCollector = new EvidenceCollector();

    const doneGate = new DoneGate(runner, fs, clock, eventBus, evidenceCollector, {
      maxAttempts: 2,
      testCommand: 'pnpm test',
    });

    const loop = new AgentLoop(provider, tools, eventBus, clock);
    const result = await loop.run('Verify system status', {
      sessionId: 'sess-1',
      doneGate,
      evidenceCollector,
    });

    expect(result.completed).toBe(true);
    expect(result.stopReason).toBe('verified');
    expect(result.trustReport).toBeDefined();
    expect(result.trustReport).toContain('### Claims & Verification Status');
    expect(result.trustReport).toContain('### What I did not check');
  });

  it('deliberately unfixable task ends in Human Handoff with repro commands, NOT false success', async () => {
    // LLM attempts to finish on turn 1 and turn 2
    const provider = new MockLlmProvider([
      [
        { type: 'text_delta', delta: 'I made the fix.' },
        { type: 'stop_reason', reason: 'end_turn' },
      ],
      [
        { type: 'text_delta', delta: 'I tried fixing it again.' },
        { type: 'stop_reason', reason: 'end_turn' },
      ],
    ]);

    // Runner always fails verification (exit code 1)
    const runner = new MockRunner(1, 'Critical compiler failure in dependency');
    const fs = new MockFs();
    const evidenceCollector = new EvidenceCollector();
    const handoffManager = new HumanHandoffManager(eventBus, clock);

    const doneGate = new DoneGate(runner, fs, clock, eventBus, evidenceCollector, {
      maxAttempts: 2,
      testCommand: 'cargo build',
    });

    const loop = new AgentLoop(provider, tools, eventBus, clock);
    const result = await loop.run('Fix impossible dependency conflict', {
      sessionId: 'sess-unfixable',
      doneGate,
      handoffManager,
      evidenceCollector,
    });

    // MUST NOT claim success!
    expect(result.completed).toBe(false);
    expect(result.stopReason).toBe('verification_failed');

    // MUST produce human handoff brief
    expect(result.handoffBrief).toBeDefined();
    expect(result.handoffBrief?.attempts.length).toBeGreaterThan(0);
    expect(result.handoffBrief?.reproCommands).toContain('cargo build');
  });

  it('escalates to main model when verification fails repeatedly on fast model', async () => {
    const provider = new MockLlmProvider([
      [
        { type: 'text_delta', delta: 'First try on fast model.' },
        { type: 'stop_reason', reason: 'end_turn' },
      ],
      [
        { type: 'text_delta', delta: 'Second try after escalation.' },
        { type: 'stop_reason', reason: 'end_turn' },
      ],
    ]);

    let runnerFail = true;
    const runner: IProcessRunner = {
      async run(): Promise<ProcessRunResult> {
        if (runnerFail) {
          runnerFail = false; // Fails first time, passes second time
          return { stdout: '', stderr: 'error', exitCode: 1 };
        }
        return { stdout: 'All tests passed', stderr: '', exitCode: 0 };
      },
    };

    const fs = new MockFs();
    const evidenceCollector = new EvidenceCollector();
    const escalator = new EscalationEngine(eventBus, clock, {
      maxFailedVerificationAttempts: 1, // Escalate after 1 failed attempt!
    });

    let escalationFired = false;
    eventBus.subscribe('model.escalated', () => {
      escalationFired = true;
    });

    const doneGate = new DoneGate(runner, fs, clock, eventBus, evidenceCollector, {
      maxAttempts: 3,
      testCommand: 'pnpm test',
    });

    const loop = new AgentLoop(provider, tools, eventBus, clock);
    const result = await loop.run('Fix subtle bug', {
      sessionId: 'sess-esc',
      doneGate,
      escalator,
      evidenceCollector,
      fastModel: 'fast-model',
      mainModel: 'main-model',
    });

    expect(escalationFired).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.activeModel).toBe('main-model');
  });

  it('detects plan drift when touched files deviate from approved plan', () => {
    const planner = new TaskPlanner(eventBus, clock);
    const driftDetector = new PlanDriftDetector(eventBus, clock);

    const plan = planner.createPlan({
      steps: ['Fix auth.ts'],
      files: ['src/auth.ts'],
    });

    const report = driftDetector.checkDrift(plan, ['src/auth.ts', 'src/billing.ts']);
    expect(report.hasDrift).toBe(true);
    expect(report.unplannedFiles).toContain('src/billing.ts');
  });
});
