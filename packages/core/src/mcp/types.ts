export type McpTransportType = 'stdio' | 'http';

export interface McpServerConfig {
  readonly id: string;
  readonly transport: McpTransportType;
  readonly command?: string | undefined;
  readonly args?: readonly string[] | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly url?: string | undefined;
  readonly allowedTools?: readonly string[] | undefined;
  readonly autoApprove?: readonly string[] | undefined;
  readonly deniedTools?: readonly string[] | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface McpContentItem {
  readonly type: 'text' | 'image' | 'resource';
  readonly text?: string | undefined;
  readonly data?: string | undefined;
  readonly mimeType?: string | undefined;
}

export interface McpCallResult {
  readonly content: readonly McpContentItem[];
  readonly isError?: boolean | undefined;
}

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export interface IMcpProcess {
  send(payload: string): Promise<string>;
  close(): Promise<void>;
}

export interface IMcpProcessSpawner {
  spawn(config: McpServerConfig): Promise<IMcpProcess>;
}

export type HttpFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface IMcpClient {
  readonly serverId: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<readonly McpToolDefinition[]>;
  callTool(toolName: string, args: Readonly<Record<string, unknown>>): Promise<McpCallResult>;
  isConnected(): boolean;
}
