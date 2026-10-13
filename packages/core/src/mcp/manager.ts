import { z } from 'zod';
import { ITool } from '../tools/base.js';
import { ToolRegistry } from '../tools/registry.js';
import { PolicyGate, ToolActionIntent } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';
import { PolicyViolationError, ToolExecutionError } from '../errors/index.js';
import {
  IMcpClient,
  IMcpProcessSpawner,
  HttpFetchFn,
  McpCallResult,
  McpServerConfig,
} from './types.js';
import { StdioMcpClient } from './stdio-client.js';
import { HttpMcpClient } from './http-client.js';
import { McpSanitizer } from './sanitizer.js';

export class McpToolWrapper implements ITool<Record<string, unknown>, McpCallResult> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType<Record<string, unknown>>;
  readonly isReadOnly: boolean = false;

  constructor(
    readonly serverId: string,
    readonly rawToolName: string,
    private readonly client: IMcpClient,
    private readonly serverConfig: McpServerConfig,
    private readonly policyGate: PolicyGate,
    private readonly eventBus?: IEventBus | undefined,
    rawDescription?: string,
    private readonly parametersSchema: Record<string, unknown> = {},
  ) {
    this.name = `mcp__${serverId}__${rawToolName}`;
    const sanitizedDesc = McpSanitizer.sanitizeToolDescription(rawDescription ?? rawToolName);
    this.description = `[MCP:${serverId}] ${sanitizedDesc.sanitized}`;
    this.schema = z.record(z.unknown());
  }

  getParametersSchema(): Record<string, unknown> {
    return this.parametersSchema;
  }

  async execute(input: Record<string, unknown>): Promise<McpCallResult> {
    // 1. Check server-level configured allowlist/denylist
    if (this.serverConfig.deniedTools?.includes(this.rawToolName)) {
      throw new PolicyViolationError(
        this.name,
        `Tool '${this.rawToolName}' is denied by MCP server configuration for '${this.serverId}'`,
      );
    }

    if (
      this.serverConfig.allowedTools &&
      !this.serverConfig.allowedTools.includes(this.rawToolName)
    ) {
      throw new PolicyViolationError(
        this.name,
        `Tool '${this.rawToolName}' is not in the allowed tools list for '${this.serverId}'`,
      );
    }

    const startMs = Date.now();
    const callId = `call-mcp-${startMs}-${Math.random().toString(36).slice(2, 7)}`;

    // 2. Publish tool.requested event
    if (this.eventBus) {
      await this.eventBus.publish({
        id: `evt-req-${callId}`,
        type: 'tool.requested',
        timestamp: startMs,
        actor: 'agent',
        payload: {
          turnIndex: 0,
          callId,
          toolName: this.name,
          parameters: input,
        },
      });
    }

    // 3. Formulate Policy Intent: action 'mcp:call', target 'server:tool'
    const intent: ToolActionIntent = {
      actionType: 'mcp:call',
      toolName: this.name,
      target: `${this.serverId}:${this.rawToolName}`,
      parameters: input,
    };

    // 4. Evaluate against central PolicyGate
    const gate = this.policyGate as unknown as {
      check?: (i: ToolActionIntent) => Promise<{ result: string; reason: string }>;
      evaluate?: (i: ToolActionIntent) => Promise<{ result: string; reason: string }>;
    };

    const decision =
      typeof gate.check === 'function' ? await gate.check(intent) : await gate.evaluate!(intent);

    if (decision.result !== 'allow') {
      const reason =
        decision.result === 'ask'
          ? `MCP tool '${this.name}' requires authorization: ${decision.reason}`
          : decision.reason;
      throw new PolicyViolationError(this.name, reason, {
        intentTarget: intent.target,
        parameters: intent.parameters,
      });
    }

    // 5. Execute tool call via client
    try {
      const rawResult = await this.client.callTool(this.rawToolName, input);

      // 6. Treat tool outputs as untrusted: sanitize against prompt injections
      const sanitizedResult = McpSanitizer.sanitizeToolOutput(
        this.serverId,
        this.rawToolName,
        rawResult,
      );

      const durationMs = Date.now() - startMs;
      if (this.eventBus) {
        await this.eventBus.publish({
          id: `evt-exec-${callId}`,
          type: 'tool.executed',
          timestamp: Date.now(),
          actor: 'tool',
          payload: {
            turnIndex: 0,
            callId,
            toolName: this.name,
            success: !sanitizedResult.isError,
            durationMs,
            output: sanitizedResult,
          },
        });
      }

      return sanitizedResult;
    } catch (error) {
      const durationMs = Date.now() - startMs;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.eventBus) {
        await this.eventBus.publish({
          id: `evt-exec-fail-${callId}`,
          type: 'tool.executed',
          timestamp: Date.now(),
          actor: 'tool',
          payload: {
            turnIndex: 0,
            callId,
            toolName: this.name,
            success: false,
            durationMs,
            error: errorMessage,
          },
        });
      }

      if (error instanceof PolicyViolationError || error instanceof ToolExecutionError) {
        throw error;
      }
      throw new ToolExecutionError(this.name, errorMessage, error);
    }
  }
}

export interface McpManagerOptions {
  readonly policyGate: PolicyGate;
  readonly toolRegistry: ToolRegistry;
  readonly eventBus?: IEventBus | undefined;
  readonly spawner?: IMcpProcessSpawner | undefined;
  readonly fetchFn?: HttpFetchFn | undefined;
}

export class McpManager {
  private readonly clients = new Map<string, IMcpClient>();
  private readonly configs = new Map<string, McpServerConfig>();
  private readonly registeredToolNames = new Map<string, string[]>();

  constructor(private readonly options: McpManagerOptions) {}

  async registerServer(config: McpServerConfig, customClient?: IMcpClient): Promise<number> {
    this.configs.set(config.id, config);

    let client = customClient;
    if (!client) {
      if (config.transport === 'stdio') {
        if (!this.options.spawner) {
          throw new Error(
            `Cannot register stdio MCP server '${config.id}' without an IMcpProcessSpawner`,
          );
        }
        client = new StdioMcpClient(config, this.options.spawner);
      } else if (config.transport === 'http') {
        client = new HttpMcpClient(config, this.options.fetchFn);
      } else {
        throw new Error(
          `Unsupported transport type '${(config as { transport: string }).transport}'`,
        );
      }
    }

    await client.connect();
    this.clients.set(config.id, client);

    const tools = await client.listTools();
    const toolNames: string[] = [];

    for (const toolDef of tools) {
      // Check server allowlist / denylist filters
      if (config.deniedTools?.includes(toolDef.name)) {
        continue;
      }
      if (config.allowedTools && !config.allowedTools.includes(toolDef.name)) {
        continue;
      }

      const wrapper = new McpToolWrapper(
        config.id,
        toolDef.name,
        client,
        config,
        this.options.policyGate,
        this.options.eventBus,
        toolDef.description,
        toolDef.inputSchema,
      );

      this.options.toolRegistry.register(wrapper as unknown as ITool<unknown, unknown>);
      toolNames.push(wrapper.name);
    }

    this.registeredToolNames.set(config.id, toolNames);
    return toolNames.length;
  }

  async unregisterServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client) {
      await client.disconnect().catch(() => {});
      this.clients.delete(serverId);
    }
    this.configs.delete(serverId);
    this.registeredToolNames.delete(serverId);
  }

  getServerConfigs(): readonly McpServerConfig[] {
    return Array.from(this.configs.values());
  }

  async disconnectAll(): Promise<void> {
    for (const [, client] of this.clients) {
      await client.disconnect().catch(() => {});
    }
    this.clients.clear();
    this.configs.clear();
    this.registeredToolNames.clear();
  }
}
