import { ToolActionIntent } from '@forge/core';

export type CapabilityAction =
  'fs:read' | 'fs:write' | 'exec:command' | 'net:request' | 'mcp:call' | 'state:modify' | '*';

export type CapabilityScope = 'task' | 'session';

export type CapabilityIssuer = 'system' | 'user_approval';

export interface CapabilityToken {
  readonly id: string;
  readonly resourcePattern: string; // e.g. "src/**", "git status", "api.github.com", "*"
  readonly action: CapabilityAction;
  readonly scope: CapabilityScope;
  readonly taskId?: string | undefined;
  readonly expiresAtMs: number;
  readonly maxUses: number;
  remainingUses: number;
  readonly issuer: CapabilityIssuer;
  readonly signature: string;
}

export interface IssueTokenOptions {
  readonly resourcePattern: string;
  readonly action: CapabilityAction;
  readonly scope?: CapabilityScope | undefined;
  readonly taskId?: string | undefined;
  readonly ttlMs?: number | undefined; // default e.g. 5 minutes
  readonly maxUses?: number | undefined; // default unlimited or specific count
  readonly issuer: CapabilityIssuer;
}

export interface ICapabilityHandle {
  readonly tokenId: string;
  readonly action: CapabilityAction;
  readonly target: string;
  readonly intent: ToolActionIntent;
  consume(): boolean;
  isValid(): boolean;
}
