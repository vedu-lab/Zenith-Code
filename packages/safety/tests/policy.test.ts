import { describe, it, expect } from 'vitest';
import { CapabilityManager } from '../src/capabilities/index.js';
import { PolicyEngine } from '../src/policy/index.js';
import { AuditLogger } from '../src/audit/index.js';

describe('Safety Package Base Tests', () => {
  describe('CapabilityManager', () => {
    it('should manage capabilities correctly', () => {
      const caps = new CapabilityManager();
      expect(caps.hasCapability('fs:read')).toBe(false);

      caps.grant('fs:read', 'src/*');
      expect(caps.hasCapability('fs:read', 'src/app.ts')).toBe(true);
      expect(caps.hasCapability('fs:read', 'docs/readme.md')).toBe(false);

      caps.grant('fs:write', '*');
      expect(caps.hasCapability('fs:write', 'anything')).toBe(true);

      caps.revokeAction('fs:write', '*');
      expect(caps.hasCapability('fs:write', 'anything')).toBe(false);
    });
  });

  describe('PolicyEngine', () => {
    it('should deny sensitive file access regardless of capabilities', async () => {
      const caps = new CapabilityManager();
      caps.grant('fs:read', '*');
      const policy = new PolicyEngine(caps);

      const decision = await policy.evaluate({
        toolName: 'read_file',
        actionType: 'fs:read',
        target: '.env.production',
        parameters: {},
      });

      expect(decision.result).toBe('deny');
      expect(decision.reason).toContain('blocked');
    });

    it('should deny destructive commands', async () => {
      const caps = new CapabilityManager();
      caps.grant('exec:command', '*');
      const policy = new PolicyEngine(caps);

      const decision = await policy.evaluate({
        toolName: 'execute_command',
        actionType: 'exec:command',
        target: 'rm -rf / --no-preserve-root',
        parameters: {},
      });

      expect(decision.result).toBe('deny');
      expect(decision.reason.toLowerCase()).toContain('destructive');
    });

    it('should allow benign action when capability is granted', async () => {
      const caps = new CapabilityManager();
      caps.grant('fs:read', 'README.md');
      const policy = new PolicyEngine(caps);

      const decision = await policy.evaluate({
        toolName: 'read_file',
        actionType: 'fs:read',
        target: 'README.md',
        parameters: {},
      });

      expect(decision.result).toBe('allow');
    });

    it('should ask for confirmation when capability is missing', async () => {
      const caps = new CapabilityManager();
      const policy = new PolicyEngine(caps);

      const decision = await policy.evaluate({
        toolName: 'read_file',
        actionType: 'fs:read',
        target: 'config.json',
        parameters: {},
      });

      expect(decision.result).toBe('ask');
    });
  });

  describe('AuditLogger', () => {
    it('should record audit entries into hash chain', () => {
      const logger = new AuditLogger();

      const entry = logger.logPolicyDecision('fs:read', 'file.txt', 'allow', 'Test reason');
      expect(entry.type).toBe('policy_decision');
      expect(entry.index).toBe(0);
      expect(logger.getEntries()).toHaveLength(1);
    });
  });
});
