import { IClock, IEventBus } from '@forge/core';
import { UsageRecord } from './types.js';
import { calculateCost } from './pricing.js';
import { ISqliteDatabase, SqliteStore } from '../db/index.js';

export interface UsageLedgerOptions {
  readonly sqliteStore?: SqliteStore | undefined;
  readonly eventBus?: IEventBus | undefined;
}

export interface UsageQueryOptions {
  readonly since?: string | number | undefined;
  readonly until?: number | undefined;
  readonly sessionId?: string | undefined;
  readonly model?: string | undefined;
}

export interface UsageSummaryReport {
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly recordsCount: number;
  readonly averageLatencyMs: number;
  readonly records: readonly UsageRecord[];
}

export interface EstimateTuningRecord {
  readonly taskId: string;
  readonly estimatedCost: number;
  readonly actualCost: number;
  readonly estimatedTokens: number;
  readonly actualTokens: number;
  readonly varianceRatio: number;
}

export class UsageLedger {
  private readonly entries: UsageRecord[] = [];
  private readonly db?: ISqliteDatabase | undefined;
  private readonly eventBus?: IEventBus | undefined;

  constructor(
    private readonly clock: IClock,
    optionsOrEventBus: UsageLedgerOptions | IEventBus = {},
  ) {
    const options: UsageLedgerOptions =
      typeof (optionsOrEventBus as IEventBus).publish === 'function'
        ? { eventBus: optionsOrEventBus as IEventBus }
        : (optionsOrEventBus as UsageLedgerOptions);

    this.db = options.sqliteStore?.raw;
    this.eventBus = options.eventBus;

    this.initDb();

    if (this.eventBus) {
      this.eventBus.subscribe('usage.updated', (event) => {
        if (event.type === 'usage.updated' && event.actor !== 'ledger') {
          const payload = event.payload;
          void this.recordUsage({
            sessionId: payload.sessionId,
            model: payload.model,
            promptTokens: payload.inputTokens,
            completionTokens: payload.outputTokens,
            cacheReadTokens: payload.cacheReadTokens,
            cacheWriteTokens: payload.cacheWriteTokens,
          });
        }
      });
    }
  }

  private initDb(): void {
    if (!this.db) return;
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS usage_records (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          model TEXT NOT NULL,
          prompt_tokens INTEGER NOT NULL,
          completion_tokens INTEGER NOT NULL,
          cache_read_tokens INTEGER DEFAULT 0,
          cache_write_tokens INTEGER DEFAULT 0,
          total_tokens INTEGER NOT NULL,
          cost_usd REAL NOT NULL,
          latency_ms INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS estimate_tuning (
          task_id TEXT NOT NULL,
          estimated_cost REAL NOT NULL,
          actual_cost REAL NOT NULL,
          estimated_tokens INTEGER NOT NULL,
          actual_tokens INTEGER NOT NULL,
          variance_ratio REAL NOT NULL,
          timestamp INTEGER NOT NULL
        );
      `);

      const rows = this.db
        .prepare('SELECT * FROM usage_records ORDER BY timestamp ASC')
        .all() as Array<{
        id: string;
        session_id: string;
        timestamp: number;
        model: string;
        prompt_tokens: number;
        completion_tokens: number;
        cache_read_tokens?: number | undefined;
        cache_write_tokens?: number | undefined;
        total_tokens: number;
        cost_usd: number;
        latency_ms?: number | undefined;
      }>;
      for (const row of rows) {
        this.entries.push({
          id: row.id,
          sessionId: row.session_id,
          timestamp: row.timestamp,
          model: row.model,
          promptTokens: row.prompt_tokens,
          completionTokens: row.completion_tokens,
          cacheReadTokens: row.cache_read_tokens ?? 0,
          cacheWriteTokens: row.cache_write_tokens ?? 0,
          totalTokens: row.total_tokens,
          costUsd: row.cost_usd,
          latencyMs: row.latency_ms ?? 0,
        });
      }
    } catch {
      // Fallback
    }
  }

  async recordUsage(
    paramsOrSessionId:
      | string
      | {
          sessionId: string;
          model: string;
          promptTokens: number;
          completionTokens: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
          latencyMs?: number;
        },
    model?: string,
    promptTokens?: number,
    completionTokens?: number,
  ): Promise<UsageRecord> {
    const params =
      typeof paramsOrSessionId === 'string'
        ? {
            sessionId: paramsOrSessionId,
            model: model ?? 'claude-3-5-sonnet',
            promptTokens: promptTokens ?? 0,
            completionTokens: completionTokens ?? 0,
          }
        : paramsOrSessionId;

    const totalTokens = params.promptTokens + params.completionTokens;
    const costUsd = calculateCost(params.model, {
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      ...(params.cacheReadTokens !== undefined ? { cacheReadTokens: params.cacheReadTokens } : {}),
      ...(params.cacheWriteTokens !== undefined
        ? { cacheWriteTokens: params.cacheWriteTokens }
        : {}),
    });

    const now = this.clock.nowMs();
    const id = `use-${now}-${Math.random().toString(36).slice(2, 6)}`;

    const record: UsageRecord = {
      id,
      sessionId: params.sessionId,
      timestamp: now,
      model: params.model,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      cacheReadTokens: params.cacheReadTokens ?? 0,
      cacheWriteTokens: params.cacheWriteTokens ?? 0,
      totalTokens,
      costUsd,
      latencyMs: params.latencyMs ?? 0,
    };

    this.entries.push(record);

    if (this.db) {
      try {
        this.db.exec(`
          INSERT INTO usage_records
          (id, session_id, timestamp, model, prompt_tokens, completion_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost_usd, latency_ms)
          VALUES ('${record.id}', '${record.sessionId}', ${record.timestamp}, '${record.model}', ${record.promptTokens}, ${record.completionTokens}, ${record.cacheReadTokens}, ${record.cacheWriteTokens}, ${record.totalTokens}, ${record.costUsd}, ${record.latencyMs});
        `);
      } catch {
        // Fallback
      }
    }

    if (this.eventBus) {
      await this.eventBus.publish({
        id: `evt-usage-${record.id}`,
        type: 'usage.updated',
        timestamp: record.timestamp,
        actor: 'system',
        payload: {
          sessionId: record.sessionId,
          model: record.model,
          inputTokens: record.promptTokens,
          outputTokens: record.completionTokens,
          totalTokens: record.totalTokens,
          costUsd: record.costUsd,
          cacheReadTokens: record.cacheReadTokens,
          cacheWriteTokens: record.cacheWriteTokens,
        },
      });
    }

    return record;
  }

  parseSince(since: string | number): number {
    if (typeof since === 'number') return since;
    const now = this.clock.nowMs();
    const match = since.match(/^(\d+)([dhms])$/i);
    if (!match) return now - 7 * 24 * 60 * 60 * 1000;

    const val = parseInt(match[1]!, 10);
    const unit = match[2]!.toLowerCase();

    switch (unit) {
      case 'd':
        return now - val * 24 * 60 * 60 * 1000;
      case 'h':
        return now - val * 60 * 60 * 1000;
      case 'm':
        return now - val * 60 * 1000;
      case 's':
        return now - val * 1000;
      default:
        return now - 7 * 24 * 60 * 60 * 1000;
    }
  }

  queryUsage(options: UsageQueryOptions = {}): UsageSummaryReport {
    const minTimestamp = options.since !== undefined ? this.parseSince(options.since) : 0;
    const maxTimestamp = options.until ?? Infinity;

    const filtered = this.entries.filter((r) => {
      if (r.timestamp < minTimestamp || r.timestamp > maxTimestamp) return false;
      if (options.sessionId && r.sessionId !== options.sessionId) return false;
      if (options.model && r.model.toLowerCase() !== options.model.toLowerCase()) return false;
      return true;
    });

    const totalPromptTokens = filtered.reduce((acc, r) => acc + r.promptTokens, 0);
    const totalCompletionTokens = filtered.reduce((acc, r) => acc + r.completionTokens, 0);
    const totalTokens = filtered.reduce((acc, r) => acc + r.totalTokens, 0);
    const totalCostUsd = filtered.reduce((acc, r) => acc + r.costUsd, 0);
    const averageLatencyMs =
      filtered.length > 0 ? filtered.reduce((acc, r) => acc + r.latencyMs, 0) / filtered.length : 0;

    return {
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      recordsCount: filtered.length,
      averageLatencyMs: Math.round(averageLatencyMs),
      records: filtered,
    };
  }

  logEstimateVsActual(params: {
    taskId: string;
    estimatedCost: number;
    actualCost: number;
    estimatedTokens: number;
    actualTokens: number;
  }): EstimateTuningRecord {
    const varianceRatio =
      params.estimatedCost > 0
        ? Math.abs(params.actualCost - params.estimatedCost) / params.estimatedCost
        : 0;

    const record: EstimateTuningRecord = {
      taskId: params.taskId,
      estimatedCost: params.estimatedCost,
      actualCost: params.actualCost,
      estimatedTokens: params.estimatedTokens,
      actualTokens: params.actualTokens,
      varianceRatio,
    };

    if (this.db) {
      try {
        this.db.exec(`
          INSERT INTO estimate_tuning
          (task_id, estimated_cost, actual_cost, estimated_tokens, actual_tokens, variance_ratio, timestamp)
          VALUES ('${record.taskId}', ${record.estimatedCost}, ${record.actualCost}, ${record.estimatedTokens}, ${record.actualTokens}, ${record.varianceRatio}, ${this.clock.nowMs()});
        `);
      } catch {
        // Fallback
      }
    }

    return record;
  }

  getEntries(): readonly UsageRecord[] {
    return [...this.entries];
  }

  getTotalTokens(sessionId?: string): number {
    return this.entries
      .filter((r) => !sessionId || r.sessionId === sessionId)
      .reduce((sum, r) => sum + r.totalTokens, 0);
  }

  getTotalCost(sessionId?: string): number {
    return this.entries
      .filter((r) => !sessionId || r.sessionId === sessionId)
      .reduce((sum, r) => sum + r.costUsd, 0);
  }
}
