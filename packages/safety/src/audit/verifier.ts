import fs from 'node:fs';
import { AuditEntry, AuditVerifyResult } from './types.js';
import { AuditHashChain } from './chain.js';

export async function verifyAuditFile(filePath: string): Promise<AuditVerifyResult> {
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      entriesCount: 0,
      error: `Audit log file does not exist: '${filePath}'`,
    };
  }

  const rawContent = fs.readFileSync(filePath, 'utf8');
  const lines = rawContent.split(/\r?\n/).filter((l) => l.trim().length > 0);

  const entries: AuditEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as AuditEntry;
      entries.push(entry);
    } catch {
      return {
        valid: false,
        entriesCount: entries.length,
        tamperedIndex: i,
        error: `Invalid JSON syntax at line ${i + 1} of audit log`,
      };
    }
  }

  return AuditHashChain.verifyEntries(entries);
}
