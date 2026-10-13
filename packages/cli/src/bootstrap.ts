import {
  SystemClock,
  CoreEventBus,
  ToolRegistry,
  AgentLoop,
  ILlmProvider,
  IFileSystem,
  IProcessRunner,
  IClock,
  AgentChatMessage,
} from '@forge/core';
import { CapabilityManager, PolicyEngine, AuditLogger } from '@forge/safety';
import { SessionManager, CheckpointStore, UsageLedger, SqliteStore } from '@forge/state';
import { NodeFileSystem } from './io/filesystem.js';
import { ExecaProcessRunner } from './io/process-runner.js';

export interface ForgeAppContainer {
  readonly clock: IClock;
  readonly fs: IFileSystem;
  readonly processRunner: IProcessRunner;
  readonly eventBus: CoreEventBus;
  readonly capabilities: CapabilityManager;
  readonly policyEngine: PolicyEngine;
  readonly auditLogger: AuditLogger;
  readonly sessionManager: SessionManager;
  readonly checkpointStore: CheckpointStore;
  readonly usageLedger: UsageLedger;
  readonly sqliteStore: SqliteStore;
  readonly tools: ToolRegistry;
  readonly agentLoop: AgentLoop;
}

export interface BootstrapOptions {
  readonly provider?: ILlmProvider;
  readonly clock?: IClock;
  readonly fs?: IFileSystem;
  readonly processRunner?: IProcessRunner;
  readonly sqlitePath?: string;
}

export class MockLlmProvider implements ILlmProvider {
  readonly name = 'mock-llm';
  async chat(_messages: readonly AgentChatMessage[]) {
    return {
      message: {
        role: 'assistant' as const,
        content: 'Task completed successfully.',
      },
    };
  }
}

export function bootstrapApp(options: BootstrapOptions = {}): ForgeAppContainer {
  const clock = options.clock ?? new SystemClock();
  const fs = options.fs ?? new NodeFileSystem();
  const processRunner = options.processRunner ?? new ExecaProcessRunner();
  const provider = options.provider ?? new MockLlmProvider();

  const eventBus = new CoreEventBus();
  const capabilities = new CapabilityManager();
  const policyEngine = new PolicyEngine(capabilities);
  const auditLogger = new AuditLogger(clock, eventBus);

  const sqliteStore = new SqliteStore({ filename: options.sqlitePath ?? ':memory:' });
  const sessionManager = new SessionManager(clock, eventBus);
  const checkpointStore = new CheckpointStore(clock, eventBus, fs);
  const usageLedger = new UsageLedger(clock, eventBus);

  const tools = new ToolRegistry();
  const agentLoop = new AgentLoop({
    clock,
    eventBus,
    provider,
    policyEngine,
    tools,
  });

  return {
    clock,
    fs,
    processRunner,
    eventBus,
    capabilities,
    policyEngine,
    auditLogger,
    sessionManager,
    checkpointStore,
    usageLedger,
    sqliteStore,
    tools,
    agentLoop,
  };
}
