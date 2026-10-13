import path from 'node:path';
import {
  SystemClock,
  CoreEventBus,
  ToolRegistry,
  AgentLoop,
  IFileSystem,
  IProcessRunner,
  IClock,
  IEventBus,
  PolicyGate,
  FileReadTracker,
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  MultiEditTool,
  ListDirTool,
  GrepTool,
  BashTool,
  TodoWriteTool,
  ForgeConfig,
  loadConfig,
  ProviderManager,
  IProvider,
  SystemPromptBuilder,
  HeadlessRunner,
} from '@forge/core';
import {
  CapabilityManager,
  PolicyEngine,
  PolicyMode,
  AuditLogger,
  SandboxManager,
  SecretRedactor,
  OfflineGuard,
} from '@forge/safety';
import { SessionManager, CheckpointStore, UsageLedger, SqliteStore } from '@forge/state';
import { NodeFileSystem } from './io/filesystem.js';
import { ExecaProcessRunner } from './io/process-runner.js';

export interface ForgeAppContainer {
  readonly clock: IClock;
  readonly fs: IFileSystem;
  readonly processRunner: IProcessRunner;
  readonly eventBus: IEventBus;
  readonly capabilities: CapabilityManager;
  readonly policyEngine: PolicyEngine;
  readonly auditLogger: AuditLogger;
  readonly sandboxManager: SandboxManager;
  readonly secretRedactor: SecretRedactor;
  readonly offlineGuard: OfflineGuard;
  readonly sessionManager: SessionManager;
  readonly checkpointStore: CheckpointStore;
  readonly usageLedger: UsageLedger;
  readonly sqliteStore: SqliteStore;
  readonly fileTracker: FileReadTracker;
  readonly tools: ToolRegistry;
  readonly config: ForgeConfig;
  readonly providerManager: ProviderManager;
  readonly provider: IProvider;
  readonly promptBuilder: SystemPromptBuilder;
  readonly agentLoop: AgentLoop;
  readonly headlessRunner: HeadlessRunner;
}

export interface BootstrapOptions {
  readonly configOverrides?: Partial<ForgeConfig> | undefined;
  readonly provider?: IProvider | undefined;
  readonly clock?: IClock | undefined;
  readonly fs?: IFileSystem | undefined;
  readonly processRunner?: IProcessRunner | undefined;
  readonly sqlitePath?: string | undefined;
  readonly policyGate?: PolicyGate | undefined;
  readonly policyMode?: PolicyMode | undefined;
  readonly offline?: boolean | undefined;
  readonly auditFilePath?: string | undefined;
  readonly projectRoot?: string | undefined;
}

export async function bootstrapApp(options: BootstrapOptions = {}): Promise<ForgeAppContainer> {
  const clock = options.clock ?? new SystemClock();
  const fs = options.fs ?? new NodeFileSystem();
  const processRunner = options.processRunner ?? new ExecaProcessRunner();
  const projectRoot = options.projectRoot ?? process.cwd();

  const eventBus = new CoreEventBus();
  const capabilities = new CapabilityManager();
  const secretRedactor = new SecretRedactor();
  const offlineGuard = new OfflineGuard(options.offline ?? false);

  const policyEngine = new PolicyEngine(capabilities, {
    workspaceRoot: projectRoot,
    mode: options.policyMode ?? 'default',
    eventBus,
  });

  const sandboxManager = new SandboxManager({
    workspaceRoot: projectRoot,
  });

  const auditPath = options.auditFilePath ?? path.join(projectRoot, '.forge', 'audit.jsonl');
  const auditLogger = new AuditLogger({
    filePath: auditPath,
    eventBus,
    secretRedactor,
  });

  // Tools are gated by the real PolicyEngine
  const policyGate = options.policyGate ?? policyEngine;

  // Load layered config
  const config = await loadConfig({
    cliOverrides: options.configOverrides,
    projectRoot,
    fs,
  });

  // Providers
  const providerManager = new ProviderManager(config);
  const provider = options.provider ?? providerManager.getProviderForRole('main').provider;

  // Tools & Tracking
  const fileTracker = new FileReadTracker();
  const tools = new ToolRegistry();
  tools.register(new ReadFileTool(fs, fileTracker, policyGate, eventBus));
  tools.register(new WriteFileTool(fs, fileTracker, policyGate, eventBus));
  tools.register(new EditFileTool(fs, fileTracker, policyGate, eventBus));
  tools.register(new MultiEditTool(fs, fileTracker, policyGate, eventBus));
  tools.register(new ListDirTool(fs, projectRoot, policyGate, eventBus));
  tools.register(new GrepTool(fs, processRunner, projectRoot, policyGate, eventBus));
  tools.register(
    new BashTool(processRunner, fs, projectRoot, config.tools.maxOutputBytes, policyGate, eventBus),
  );
  tools.register(new TodoWriteTool(policyGate, eventBus));

  // State Management
  const sqliteStore = new SqliteStore({ filename: options.sqlitePath ?? ':memory:' });
  const sessionManager = new SessionManager(clock, eventBus);
  const checkpointStore = new CheckpointStore(clock, eventBus, fs);
  const usageLedger = new UsageLedger(clock, eventBus);

  // Engine & Prompt
  const promptBuilder = new SystemPromptBuilder(fs, projectRoot);
  const agentLoop = new AgentLoop(provider, tools, eventBus, clock);
  const headlessRunner = new HeadlessRunner(agentLoop, promptBuilder, eventBus, config);

  return {
    clock,
    fs,
    processRunner,
    eventBus,
    capabilities,
    policyEngine,
    auditLogger,
    sandboxManager,
    secretRedactor,
    offlineGuard,
    sessionManager,
    checkpointStore,
    usageLedger,
    sqliteStore,
    fileTracker,
    tools,
    config,
    providerManager,
    provider,
    promptBuilder,
    agentLoop,
    headlessRunner,
  };
}
