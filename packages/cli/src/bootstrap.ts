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
  AllowAllPolicyGate,
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
import { CapabilityManager, PolicyEngine, AuditLogger } from '@forge/safety';
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
  readonly projectRoot?: string | undefined;
}

export async function bootstrapApp(options: BootstrapOptions = {}): Promise<ForgeAppContainer> {
  const clock = options.clock ?? new SystemClock();
  const fs = options.fs ?? new NodeFileSystem();
  const processRunner = options.processRunner ?? new ExecaProcessRunner();
  const projectRoot = options.projectRoot ?? process.cwd();

  const eventBus = new CoreEventBus();
  const capabilities = new CapabilityManager();
  const policyEngine = new PolicyEngine(capabilities);
  const auditLogger = new AuditLogger(clock, eventBus);

  const policyGate = options.policyGate ?? new AllowAllPolicyGate();

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
