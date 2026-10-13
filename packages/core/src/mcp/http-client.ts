import {
  HttpFetchFn,
  IMcpClient,
  JsonRpcRequest,
  JsonRpcResponse,
  McpCallResult,
  McpServerConfig,
  McpToolDefinition,
} from './types.js';
import { ToolExecutionError } from '../errors/index.js';

export class HttpMcpClient implements IMcpClient {
  readonly serverId: string;
  private readonly config: McpServerConfig;
  private readonly fetchFn: HttpFetchFn;
  private requestId = 0;
  private connected = false;

  constructor(config: McpServerConfig, fetchFn?: HttpFetchFn) {
    if (!config.url) {
      throw new Error(`HTTP MCP server config for '${config.id}' must provide a url`);
    }
    this.serverId = config.id;
    this.config = config;
    this.fetchFn = fetchFn ?? ((url, init) => globalThis.fetch(url, init));
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      await this.sendRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'forge',
          version: '0.1.0',
        },
      });
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw new ToolExecutionError(
        `mcp:${this.serverId}`,
        `Failed to initialize MCP HTTP server '${this.serverId}' at ${this.config.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
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
        `Invalid response from MCP server '${this.serverId}' for tool '${toolName}'`,
      );
    }

    return {
      content: result.content ?? [],
      ...(result.isError !== undefined ? { isError: result.isError } : {}),
    };
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new ToolExecutionError(
        `mcp:${this.serverId}`,
        `MCP client for server '${this.serverId}' is not connected. Call connect() first.`,
      );
    }
  }

  private async sendRpcRequest(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const controller = new AbortController();
    const timeout = this.config.timeoutMs ?? 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await this.fetchFn(this.config.url!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const parsed = (await response.json()) as JsonRpcResponse;
      if (parsed.error) {
        throw new ToolExecutionError(
          `mcp:${this.serverId}`,
          `MCP error (${parsed.error.code}): ${parsed.error.message}`,
        );
      }

      return parsed;
    } catch (err) {
      if (err instanceof ToolExecutionError) throw err;
      throw new ToolExecutionError(
        `mcp:${this.serverId}`,
        `HTTP request to MCP server '${this.serverId}' failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
