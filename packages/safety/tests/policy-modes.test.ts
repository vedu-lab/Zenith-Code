import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../src/policy/engine.js';
import { CapabilityManager } from '../src/capabilities/manager.js';
import { LayeredRuleStore } from '../src/policy/rules.js';

describe('Policy Modes, Rule Layers & Deny Beats Allow', () => {
  describe('Deny Beats Allow & Layer Precedence', () => {
    it('enforces deny beats allow across all layers', () => {
      const store = new LayeredRuleStore([
        {
          id: 'org-deny-env',
          layer: 'org',
          effect: 'deny',
          pattern: 'fs.write(.env*)',
        },
        {
          id: 'user-allow-all-writes',
          layer: 'user',
          effect: 'allow',
          pattern: 'fs.write(*)',
        },
      ]);

      const decision = store.evaluate(
        {
          toolName: 'write_file',
          actionType: 'fs:write',
          target: '.env.local',
          parameters: {},
        },
        '/test/workspace',
      );

      expect(decision).toBeDefined();
      expect(decision!.result).toBe('deny');
      expect(decision!.reason).toContain('denied');
    });

    it('higher layer (org) overrides lower layer (project)', () => {
      const store = new LayeredRuleStore([
        {
          id: 'org-rule',
          layer: 'org',
          effect: 'deny',
          pattern: 'shell(rm *)',
        },
        {
          id: 'project-rule',
          layer: 'project',
          effect: 'allow',
          pattern: 'shell(rm *)',
        },
      ]);

      const decision = store.evaluate(
        {
          toolName: 'bash',
          actionType: 'exec:command',
          target: 'rm -f test.txt',
          parameters: {},
        },
        '/test/workspace',
      );

      expect(decision!.result).toBe('deny');
    });
  });

  describe('Policy Modes Enforcement', () => {
    it('Plan Mode: strictly read-only, denies all writes, execs, and net requests', async () => {
      const engine = new PolicyEngine(new CapabilityManager(), { mode: 'plan' });

      // fs:read is allowed in Plan Mode
      const readDecision = await engine.check({
        toolName: 'read_file',
        actionType: 'fs:read',
        target: 'src/main.ts',
        parameters: {},
      });
      // Without token or rule, defaults to ask, but not denied by mode
      expect(readDecision.result).not.toBe('deny');

      // fs:write is denied in Plan Mode
      const writeDecision = await engine.check({
        toolName: 'write_file',
        actionType: 'fs:write',
        target: 'src/main.ts',
        parameters: {},
      });
      expect(writeDecision.result).toBe('deny');
      expect(writeDecision.reason).toContain('forbidden in Plan Mode');

      // exec:command is denied in Plan Mode
      const execDecision = await engine.check({
        toolName: 'bash',
        actionType: 'exec:command',
        target: 'npm test',
        parameters: {},
      });
      expect(execDecision.result).toBe('deny');
      expect(execDecision.reason).toContain('forbidden in Plan Mode');
    });

    it('AcceptEdits Mode: automatically authorizes file writes inside workspace', async () => {
      const workspaceRoot = '/app/repo';
      const engine = new PolicyEngine(new CapabilityManager(), {
        mode: 'acceptEdits',
        workspaceRoot,
      });

      // Inside workspace file write
      const insideDecision = await engine.check({
        toolName: 'write_file',
        actionType: 'fs:write',
        target: '/app/repo/src/index.ts',
        parameters: {},
      });
      expect(insideDecision.result).toBe('allow');
      expect(insideDecision.reason).toContain('acceptEdits');

      // Outside workspace file write is NOT auto-authorized
      const outsideDecision = await engine.check({
        toolName: 'write_file',
        actionType: 'fs:write',
        target: '/etc/hosts',
        parameters: {},
      });
      expect(outsideDecision.result).not.toBe('allow');
    });

    it('Bypass Mode: warns loudly and allows in non-CI environment', async () => {
      const engine = new PolicyEngine(new CapabilityManager(), {
        mode: 'bypass',
        isCi: false,
      });

      const decision = await engine.check({
        toolName: 'write_file',
        actionType: 'fs:write',
        target: 'anything.txt',
        parameters: {},
      });

      expect(decision.result).toBe('allow');
      expect(decision.reason).toContain('[WARNING: POLICY BYPASS ACTIVE]');
    });

    it('Bypass Mode: strictly blocked in CI unless explicitly permitted by org policy', async () => {
      // In CI, allowBypassInCi is false by default
      const engineCi = new PolicyEngine(new CapabilityManager(), {
        mode: 'bypass',
        isCi: true,
        settings: { allowBypassInCi: false },
      });

      const decision = await engineCi.check({
        toolName: 'write_file',
        actionType: 'fs:write',
        target: 'anything.txt',
        parameters: {},
      });

      expect(decision.result).toBe('deny');
      expect(decision.reason).toContain(
        'Policy bypass mode is strictly disabled in CI environments',
      );

      // When allowBypassInCi is true
      const engineCiPermitted = new PolicyEngine(new CapabilityManager(), {
        mode: 'bypass',
        isCi: true,
        settings: { allowBypassInCi: true },
      });

      const allowedDecision = await engineCiPermitted.check({
        toolName: 'write_file',
        actionType: 'fs:write',
        target: 'anything.txt',
        parameters: {},
      });

      expect(allowedDecision.result).toBe('allow');
    });
  });
});
