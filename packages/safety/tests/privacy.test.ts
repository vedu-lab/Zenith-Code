import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { OfflineGuard, AgentIgnoreFilter } from '../src/privacy/offline.js';
import { SecretRedactor } from '../src/privacy/redaction.js';

describe('Offline Mode, Privacy Redaction & AgentIgnore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-privacy-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Offline Mode Network Guard', () => {
    it('permits localhost model endpoints in offline mode', () => {
      const guard = new OfflineGuard(true);

      expect(guard.validateUrl('http://localhost:11434/v1/chat/completions').allowed).toBe(true);
      expect(guard.validateUrl('http://127.0.0.1:8080/completion').allowed).toBe(true);
      expect(guard.validateUrl('http://[::1]:1234/v1').allowed).toBe(true);
    });

    it('blocks non-local endpoints, external APIs, and telemetry in offline mode', () => {
      const guard = new OfflineGuard(true);

      const anthropic = guard.validateUrl('https://api.anthropic.com/v1/messages');
      expect(anthropic.allowed).toBe(false);
      expect(anthropic.reason).toContain('Offline mode enabled');

      const openai = guard.validateUrl('https://api.openai.com/v1/chat/completions');
      expect(openai.allowed).toBe(false);

      const webFetch = guard.validateAction('web_fetch');
      expect(webFetch.allowed).toBe(false);
      expect(webFetch.reason).toContain('Offline mode is active');

      const telemetry = guard.validateAction('telemetry');
      expect(telemetry.allowed).toBe(false);
    });
  });

  describe('Secret Redactor', () => {
    it('redacts all key secret patterns and maintains redaction log', () => {
      const redactor = new SecretRedactor();

      const sample = `
        const anthropic = "sk-ant-api03-abcdef1234567890abcdef1234567890";
        const openai = "sk-1234567890abcdef1234567890abcdef";
        const github = "ghp_123456789012345678901234567890123456";
        const awsKey = "AKIAIOSFODNN7EXAMPLE";
        const bearer = "Bearer ya29.a0AfH6SMAexampleTokenValueHere12345";
      `;

      const { sanitized, matches } = redactor.redact(sample);

      expect(sanitized).not.toContain('sk-ant-api03');
      expect(sanitized).not.toContain('ghp_1234');
      expect(sanitized).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(sanitized).toContain('[REDACTED_ANTHROPIC_KEY]');
      expect(sanitized).toContain('[REDACTED_OPENAI_KEY]');
      expect(sanitized).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(sanitized).toContain('[REDACTED_AWS_KEY_ID]');

      expect(matches.length).toBeGreaterThanOrEqual(4);

      const log = redactor.getRedactionLog();
      expect(log.length).toBeGreaterThanOrEqual(4);
      expect(log.some((entry) => entry.secretType === 'Anthropic API Key')).toBe(true);
    });
  });

  describe('AgentIgnore Filter', () => {
    it('honors .agentignore file and patterns', () => {
      const agentIgnorePath = path.join(tempDir, '.agentignore');
      fs.writeFileSync(
        agentIgnorePath,
        `
# Comments must be ignored
.env*
secrets/**
*.key
database.sqlite
`,
        'utf8',
      );

      const filter = new AgentIgnoreFilter(tempDir);

      expect(filter.isIgnored('.env')).toBe(true);
      expect(filter.isIgnored('.env.local')).toBe(true);
      expect(filter.isIgnored('secrets/private.txt')).toBe(true);
      expect(filter.isIgnored('id_rsa.key')).toBe(true);
      expect(filter.isIgnored('database.sqlite')).toBe(true);

      // Normal source files are not ignored
      expect(filter.isIgnored('src/index.ts')).toBe(false);
      expect(filter.isIgnored('README.md')).toBe(false);
    });
  });
});
