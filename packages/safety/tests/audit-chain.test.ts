import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  AuditHashChain,
  AuditLogger,
  GENESIS_HASH,
  verifyAuditFile,
  exportToJsonl,
  exportToOpenTelemetry,
  AuditEntry,
} from '../src/audit/index.js';
import { SecretRedactor } from '../src/privacy/redaction.js';

describe('Audit Log & Hash Chain Cryptographic Ledger', () => {
  let tempDir: string;
  let auditFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-audit-test-'));
    auditFilePath = path.join(tempDir, 'audit.jsonl');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('maintains valid SHA-256 hash chain starting from genesis block', () => {
    const chain = new AuditHashChain();

    const entry0 = chain.append('policy_decision', { action: 'fs:read', target: 'index.ts' });
    expect(entry0.index).toBe(0);
    expect(entry0.prevHash).toBe(GENESIS_HASH);
    expect(entry0.hash).toHaveLength(64);

    const entry1 = chain.append('tool_call', { toolName: 'read_file', exitCode: 0 });
    expect(entry1.index).toBe(1);
    expect(entry1.prevHash).toBe(entry0.hash);

    const entry2 = chain.append('model_response', { model: 'claude-3-5-sonnet', tokens: 150 });
    expect(entry2.index).toBe(2);
    expect(entry2.prevHash).toBe(entry1.hash);

    const verifyResult = chain.verify();
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.entriesCount).toBe(3);
  });

  it('detects tampering when an entry payload is altered', () => {
    const chain = new AuditHashChain();
    chain.append('policy_decision', { target: 'file1.txt' });
    chain.append('tool_call', { toolName: 'read_file' });
    chain.append('file_write', { filePath: 'out.txt' });

    const entries = [...chain.getEntries()];
    // Attacker alters payload of entry 1 without updating hash
    const tamperedEntries: AuditEntry[] = [
      entries[0]!,
      {
        ...entries[1]!,
        payload: { toolName: 'malicious_tool_call' },
      },
      entries[2]!,
    ];

    const result = AuditHashChain.verifyEntries(tamperedEntries);
    expect(result.valid).toBe(false);
    expect(result.tamperedIndex).toBe(1);
    expect(result.error).toContain('Payload hash mismatch');
  });

  it('detects tampering when an entry is removed or inserted', () => {
    const chain = new AuditHashChain();
    chain.append('policy_decision', { id: 1 });
    chain.append('policy_decision', { id: 2 });
    chain.append('policy_decision', { id: 3 });

    const entries = [...chain.getEntries()];
    // Attacker deletes entry 1
    const tampered = [entries[0]!, entries[2]!];

    const result = AuditHashChain.verifyEntries(tampered);
    expect(result.valid).toBe(false);
    expect(result.tamperedIndex).toBe(1);
    expect(result.error).toContain('Index mismatch');
  });

  it('redacts secrets at write time before adding to hash chain', () => {
    const redactor = new SecretRedactor();
    const logger = new AuditLogger({ secretRedactor: redactor });

    const secretKey = 'sk-ant-api03-abcdef1234567890abcdef1234567890';
    const entry = logger.logToolCall(
      'bash',
      { command: `export ANTHROPIC_API_KEY=${secretKey}` },
      'Done',
      0,
      120,
    );

    const entryJson = JSON.stringify(entry);
    // Secret must NOT be in the audit entry
    expect(entryJson).not.toContain(secretKey);
    expect(entryJson).toContain('[REDACTED_ANTHROPIC_KEY]');

    // Secret must be recorded in the redaction log
    expect(redactor.getRedactionLog()).toHaveLength(1);
    expect(redactor.getRedactionLog()[0]!.secretType).toBe('Anthropic API Key');
  });

  it('persists append-only log to disk and verifies via verifyAuditFile', async () => {
    const logger = new AuditLogger({ filePath: auditFilePath });

    logger.logPolicyDecision('fs:read', 'main.ts', 'allow');
    logger.logToolCall('read_file', { filePath: 'main.ts' }, 'hello', 0, 50);
    logger.logFileWrite('output.txt', 'hash-123', 100, true);

    expect(fs.existsSync(auditFilePath)).toBe(true);

    // Verify valid audit file
    const verifyResult = await verifyAuditFile(auditFilePath);
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.entriesCount).toBe(3);

    // Tamper with the file on disk
    fs.appendFileSync(auditFilePath, '{"index": 3, "invalid": true}\n');
    const corruptedResult = await verifyAuditFile(auditFilePath);
    expect(corruptedResult.valid).toBe(false);
  });

  it('exports audit entries to JSONL and OpenTelemetry format', () => {
    const chain = new AuditHashChain();
    chain.append('model_request', { model: 'gemini-2.5-pro' });
    chain.append('model_response', { tokens: 500 });

    const entries = chain.getEntries();
    const jsonl = exportToJsonl(entries);
    expect(jsonl.split('\n')).toHaveLength(2);

    const otel = exportToOpenTelemetry(entries, 'forge-test-service');
    expect(otel).toHaveLength(2);
    expect(otel[0]!['traceId']).toBeDefined();
    expect(otel[0]!['name']).toBe('audit.model_request');
  });
});
