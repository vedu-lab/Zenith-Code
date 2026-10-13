import fs from 'node:fs';
import path from 'node:path';
import { IEventBus, ForgeEvent } from '@forge/core/events';
import { AuditHashChain } from './chain.js';
import { AuditEntry, AuditEventType } from './types.js';
import { SecretRedactor } from '../privacy/redaction.js';

export interface AuditLoggerOptions {
  readonly filePath?: string;
  readonly eventBus?: IEventBus;
  readonly secretRedactor?: SecretRedactor;
}

export class AuditLogger {
  private readonly chain: AuditHashChain;
  private readonly redactor: SecretRedactor;
  private readonly filePath: string | undefined;
  private isEnabled = true;

  constructor(options: AuditLoggerOptions = {}) {
    let initialEntries: readonly AuditEntry[] = [];
    this.filePath = options.filePath;

    if (this.filePath) {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      } else if (fs.existsSync(this.filePath)) {
        try {
          const raw = fs.readFileSync(this.filePath, 'utf8');
          const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
          const loaded: AuditEntry[] = [];
          for (const line of lines) {
            loaded.push(JSON.parse(line) as AuditEntry);
          }
          if (loaded.length > 0) {
            const check = AuditHashChain.verifyEntries(loaded);
            if (check.valid) {
              initialEntries = loaded;
            }
          }
        } catch {
          // Keep empty if unreadable
        }
      }
    }

    this.chain = new AuditHashChain(initialEntries);
    this.redactor = options.secretRedactor ?? new SecretRedactor();

    if (options.eventBus) {
      this.attachToEventBus(options.eventBus);
    }
  }

  getChain(): AuditHashChain {
    return this.chain;
  }

  getEntries(): readonly AuditEntry[] {
    return this.chain.getEntries();
  }

  private sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const jsonStr = JSON.stringify(payload);
    const { sanitized } = this.redactor.redact(jsonStr);
    return JSON.parse(sanitized) as Record<string, unknown>;
  }

  record(type: AuditEventType, payload: Record<string, unknown>): AuditEntry {
    if (!this.isEnabled) {
      throw new Error('Audit logging cannot be disabled; policy violation');
    }

    const sanitizedPayload = this.sanitizePayload(payload);
    const entry = this.chain.append(type, sanitizedPayload);

    if (this.filePath) {
      try {
        fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
      } catch {
        // Must never crash on disk write, but keep in memory chain
      }
    }

    return entry;
  }

  logModelRequest(
    model: string,
    messagesCount: number,
    toolsCount: number,
    metadata?: Record<string, unknown>,
  ): AuditEntry {
    return this.record('model_request', {
      model,
      messagesCount,
      toolsCount,
      ...(metadata ?? {}),
    });
  }

  logModelResponse(
    model: string,
    usage: { inputTokens: number; outputTokens: number; costUsd?: number },
    durationMs: number,
    metadata?: Record<string, unknown>,
  ): AuditEntry {
    return this.record('model_response', {
      model,
      usage,
      durationMs,
      ...(metadata ?? {}),
    });
  }

  logToolCall(
    toolName: string,
    input: Record<string, unknown>,
    output: unknown,
    exitCode: number,
    durationMs: number,
  ): AuditEntry {
    return this.record('tool_call', {
      toolName,
      input,
      output,
      exitCode,
      durationMs,
    });
  }

  logFileRead(filePath: string, contentHash: string, byteCount: number): AuditEntry {
    return this.record('file_read', {
      filePath,
      contentHash,
      byteCount,
    });
  }

  logFileWrite(
    filePath: string,
    contentHash: string,
    byteCount: number,
    isNew: boolean,
  ): AuditEntry {
    return this.record('file_write', {
      filePath,
      contentHash,
      byteCount,
      isNew,
    });
  }

  logPolicyDecision(
    action: string,
    target: string,
    decision: 'allow' | 'deny' | 'ask',
    reason?: string,
  ): AuditEntry {
    return this.record('policy_decision', {
      action,
      target,
      decision,
      ...(reason ? { reason } : {}),
    });
  }

  logCapabilityGrant(
    tokenId: string,
    action: string,
    resourcePattern: string,
    scope: string,
  ): AuditEntry {
    return this.record('capability_grant', {
      tokenId,
      action,
      resourcePattern,
      scope,
    });
  }

  logApproval(action: string, approvedBy: 'user' | 'policy', callId?: string): AuditEntry {
    return this.record('approval', {
      action,
      approvedBy,
      ...(callId ? { callId } : {}),
    });
  }

  private attachToEventBus(eventBus: IEventBus): void {
    eventBus.subscribe('tool.executed', (event: ForgeEvent) => {
      if (event.type === 'tool.executed') {
        const payload = event.payload;
        this.logToolCall(
          payload.toolName,
          { callId: payload.callId, turnIndex: payload.turnIndex },
          payload.output,
          payload.success ? 0 : 1,
          payload.durationMs,
        );
      }
    });

    eventBus.subscribe('file.read', (event: ForgeEvent) => {
      if (event.type === 'file.read') {
        const payload = event.payload;
        this.logFileRead(payload.filePath, 'sha256-read', payload.byteCount);
      }
    });

    eventBus.subscribe('file.written', (event: ForgeEvent) => {
      if (event.type === 'file.written') {
        const payload = event.payload;
        this.logFileWrite(payload.filePath, 'sha256-written', payload.byteCount, payload.isNew);
      }
    });

    eventBus.subscribe('usage.updated', (event: ForgeEvent) => {
      if (event.type === 'usage.updated') {
        const payload = event.payload;
        this.logModelResponse(
          payload.model,
          {
            inputTokens: payload.inputTokens,
            outputTokens: payload.outputTokens,
            costUsd: payload.costUsd,
          },
          0,
        );
      }
    });
  }
}
