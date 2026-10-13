import { IPolicyEngine, ToolActionIntent, PolicyDecision } from '@forge/core';
import { CapabilityManager, CapabilityType } from '../capabilities/index.js';

export interface PolicyRule {
  readonly id: string;
  readonly description: string;
  evaluate(intent: ToolActionIntent): PolicyDecision | undefined;
}

export class PolicyEngine implements IPolicyEngine {
  private readonly rules: PolicyRule[] = [];

  constructor(private readonly capabilities: CapabilityManager) {
    this.registerDefaultRules();
  }

  addRule(rule: PolicyRule): void {
    this.rules.unshift(rule); // user rules have precedence
  }

  async check(intent: ToolActionIntent): Promise<PolicyDecision> {
    return this.evaluate(intent);
  }

  async evaluate(intent: ToolActionIntent): Promise<PolicyDecision> {
    for (const rule of this.rules) {
      const decision = rule.evaluate(intent);
      if (decision) {
        return decision;
      }
    }

    // Capability-based check
    const requiredType = intent.actionType as CapabilityType;
    if (this.capabilities.hasCapability(requiredType, intent.target)) {
      return {
        result: 'allow',
        reason: `Action '${intent.toolName}' authorized by granted capability '${requiredType}'`,
      };
    }

    return {
      result: 'ask',
      reason: `Action '${intent.toolName}' requires user confirmation (no explicit capability for ${intent.target})`,
      requiredCapabilities: [requiredType],
    };
  }

  private registerDefaultRules(): void {
    // Rule: Deny access to secrets and sensitive system files
    this.rules.push({
      id: 'deny-secrets-and-sensitive-files',
      description: 'Block read/write access to credentials, .env files, and OS directories',
      evaluate: (intent) => {
        const lower = intent.target.toLowerCase();
        if (
          lower.includes('.env') ||
          lower.includes('id_rsa') ||
          lower.includes('.git/credentials') ||
          lower.startsWith('/etc/') ||
          lower.startsWith('/root/') ||
          lower.startsWith('c:\\windows\\system32')
        ) {
          return {
            result: 'deny',
            reason: `Access to sensitive target '${intent.target}' is strictly denied by safety policy.`,
          };
        }
        return undefined;
      },
    });

    // Rule: Deny destructive commands
    this.rules.push({
      id: 'deny-destructive-commands',
      description: 'Block irreversible system destruction commands',
      evaluate: (intent) => {
        if (intent.actionType === 'exec:command') {
          const cmd = intent.target.trim().toLowerCase();
          if (
            cmd.startsWith('rm -rf /') ||
            cmd.includes(':(){ :|:& };:') ||
            cmd.startsWith('format c:') ||
            cmd.startsWith('mkfs')
          ) {
            return {
              result: 'deny',
              reason: `Command '${intent.target}' matches destructive command blacklist.`,
            };
          }
        }
        return undefined;
      },
    });
  }
}
