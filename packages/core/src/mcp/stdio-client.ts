import {
  IMcpClient,
  IMcpProcess,
  IMcpProcessSpawner,
  JsonRpcRequest,
  JsonRpcResponse,
  McpCallResult,
  McpServerConfig,
  McpToolDefinition,
} from './types.js';
import { ToolExecutionError } from '../errors/index.js';

export class StdioMcpClient implements IMcpClient {
  readonly serverId: string;
  private readonly config: McpServerConfig;
  private readonly spawner: IMcpProcessSpawner;
  private process: IMcpProcess | null = null;
  private requestId = 0;
  private connected = false;

  constructor(config: McpServerConfig, spawner: IMcpProcessSpawner) {
    this.serverId = config.id;
    this.config = config;
    this.spawner = spawner;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.process = await this.spawner.spawn(this.config);
    this.connected = true;

    // Handshake
    try {
      await this.sendRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'forge',
          version: '0.1.0',
        },
      });
    } catch (error) {
      this.connected = false;
      if (this.process) {
        await this.process.close().catch(() => {});
        this.process = null;
      }
      throw new ToolExecutionError(
        `mcp:${this.serverId}`,
        `Failed to initialize MCP stdio server '${this.serverId}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.process) {
      await this.process.close().catch(() => {});
      this.process = null;
    }
  }

  isConnected(): boolean {
    return this.connected && this.process !== null;
  }

  async listTools(): Promise<readonly McpToolDefinition[]> {
    this.ensureConnected();
    const response = await this.sendRpcRequest('tools/list', {});
    const result = response.result as { tools?: readonly McpToolDefinition[] } | undefined;
    return result?.tools ?? [];
  }

  async callTool(
    toolName: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<McpCallResult> {
    this.ensureConnected();
    const response = await this.sendRpcRequest('tools/call', {
      name: toolName,
      arguments: args,
    });

    const result = response.result as McpCallResult | undefined;
    if (!result) {
      throw new ToolExecutionError(
        `mcp:${this.serverId}:${toolName}`,
        `Invalid response received from MCP server '${this.serverId}' for tool '${toolName}'`,
      );
    }

    return {
      content: result.content ?? [],
      ...(result.isError !== undefined ? { isError: result.isError } : {}),
    };
  }

  private ensureConnected(): void {
    if (!this.connected || !this.process) {
      throw new ToolExecutionError(
        `mcp:${this.serverId}`,
        `MCP client for server '${this.serverId}' is not connected. Call connect() first.`,
      );
    }
  }

  private async sendRpcRequest(method: string, params: unknown): Promise<JsonRpcResponse> {
    if (!this.process) {
      throw new ToolExecutionError(`mcp:${this.serverId}`, 'Process is not active');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const rawResponse = await this.process.send(JSON.stringify(request));
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(rawResponse) as JsonRpcResponse;
    } catch (err) {
      throw new ToolExecutionError(
        `mcp:${this.serverId}`,
        `Failed to parse JSON-RPC response from '${this.serverId}': ${String(err)}`,
      );
    }

    if (parsed.error) {
      throw new ToolExecutionError(
        `mcp:${this.serverId}`,
        `MCP JSON-RPC error from '${this.serverId}' (${parsed.error.code}): ${parsed.error.message}`,
      );
    }

    return parsed;
  }
}
