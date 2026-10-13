export type AuditEventType =
  | 'model_request'
  | 'model_response'
  | 'tool_call'
  | 'file_read'
  | 'file_write'
  | 'policy_decision'
  | 'capability_grant'
  | 'approval';

export interface AuditEntry {
  readonly index: number;
  readonly timestamp: number;
  readonly type: AuditEventType;
  readonly payload: Record<string, unknown>;
  readonly prevHash: string;
  readonly hash: string;
}

export interface AuditVerifyResult {
  readonly valid: boolean;
  readonly entriesCount: number;
  readonly tamperedIndex?: number | undefined;
  readonly error?: string | undefined;
}
