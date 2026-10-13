import crypto from 'node:crypto';
import { AuditEntry, AuditEventType, AuditVerifyResult } from './types.js';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
  return `{${entries.join(',')}}`;
}

export function computeEntryHash(
  index: number,
  timestamp: number,
  type: string,
  payload: Record<string, unknown>,
  prevHash: string,
): string {
  const content = `${index}:${timestamp}:${type}:${canonicalJson(payload)}:${prevHash}`;
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export class AuditHashChain {
  private readonly entries: AuditEntry[] = [];

  append(type: AuditEventType, payload: Record<string, unknown>): AuditEntry {
    const index = this.entries.length;
    const timestamp = Date.now();
    const prevEntry = index > 0 ? this.entries[index - 1] : undefined;
    const prevHash = prevEntry ? prevEntry.hash : GENESIS_HASH;
    const hash = computeEntryHash(index, timestamp, type, payload, prevHash);

    const entry: AuditEntry = {
      index,
      timestamp,
      type,
      payload,
      prevHash,
      hash,
    };

    this.entries.push(entry);
    return entry;
  }

  getEntries(): readonly AuditEntry[] {
    return [...this.entries];
  }

  get length(): number {
    return this.entries.length;
  }

  verify(): AuditVerifyResult {
    return AuditHashChain.verifyEntries(this.entries);
  }

  static verifyEntries(entries: readonly AuditEntry[]): AuditVerifyResult {
    if (entries.length === 0) {
      return { valid: true, entriesCount: 0 };
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) {
        return {
          valid: false,
          entriesCount: entries.length,
          tamperedIndex: i,
          error: `Missing audit entry at position ${i}`,
        };
      }

      // Check index continuity
      if (entry.index !== i) {
        return {
          valid: false,
          entriesCount: entries.length,
          tamperedIndex: i,
          error: `Index mismatch at position ${i}: expected index ${i}, got ${entry.index}`,
        };
      }

      // Check previous hash link
      const prev = i > 0 ? entries[i - 1] : undefined;
      const expectedPrevHash = prev ? prev.hash : GENESIS_HASH;
      if (entry.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          entriesCount: entries.length,
          tamperedIndex: i,
          error: `Broken hash chain at index ${i}: prevHash '${entry.prevHash}' does not match prior hash '${expectedPrevHash}'`,
        };
      }

      // Check content integrity
      const expectedHash = computeEntryHash(
        entry.index,
        entry.timestamp,
        entry.type,
        entry.payload,
        entry.prevHash,
      );
      if (entry.hash !== expectedHash) {
        return {
          valid: false,
          entriesCount: entries.length,
          tamperedIndex: i,
          error: `Payload hash mismatch at index ${i}: recorded '${entry.hash}', recomputed '${expectedHash}'`,
        };
      }
    }

    return { valid: true, entriesCount: entries.length };
  }
}
