import crypto from 'node:crypto';
import { AuditEntry } from './types.js';

export function exportToJsonl(entries: readonly AuditEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n');
}

export function exportToOpenTelemetry(
  entries: readonly AuditEntry[],
  serviceName: string = 'forge-agent',
): Record<string, unknown>[] {
  const traceId = crypto.randomBytes(16).toString('hex');

  return entries.map((entry) => {
    const spanId = crypto.randomBytes(8).toString('hex');
    const startTimeUnixNano = entry.timestamp * 1_000_000;

    return {
      traceId,
      spanId,
      name: `audit.${entry.type}`,
      kind: 1, // SPAN_KIND_INTERNAL
      startTimeUnixNano,
      endTimeUnixNano: startTimeUnixNano + 10_000,
      attributes: [
        { key: 'service.name', value: { stringValue: serviceName } },
        { key: 'audit.index', value: { intValue: entry.index } },
        { key: 'audit.type', value: { stringValue: entry.type } },
        { key: 'audit.hash', value: { stringValue: entry.hash } },
        { key: 'audit.prevHash', value: { stringValue: entry.prevHash } },
        {
          key: 'audit.payload',
          value: { stringValue: JSON.stringify(entry.payload) },
        },
      ],
      status: { code: 1 }, // STATUS_CODE_OK
    };
  });
}
