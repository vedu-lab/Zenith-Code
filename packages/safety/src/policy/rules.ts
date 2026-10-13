import { ToolActionIntent, PolicyDecision } from '@forge/core';
import { PolicyRuleDefinition, PolicyLayer } from './types.js';
import { matchIntentPattern } from './matcher.js';

export const LAYER_PRECEDENCE: Record<PolicyLayer, number> = {
  org: 4,
  user: 3,
  project: 2,
  session: 1,
};

export class LayeredRuleStore {
  private rules: PolicyRuleDefinition[] = [];

  constructor(initialRules: readonly PolicyRuleDefinition[] = []) {
    this.rules = [...initialRules];
  }

  addRule(rule: PolicyRuleDefinition): void {
    this.rules.push(rule);
  }

  setLayerRules(layer: PolicyLayer, rules: readonly PolicyRuleDefinition[]): void {
    this.rules = this.rules.filter((r) => r.layer !== layer).concat(rules);
  }

  getRules(): readonly PolicyRuleDefinition[] {
    return [...this.rules];
  }

  /**
   * Evaluates rules against an intent.
   * "Deny beats allow": If ANY matching rule specifies 'deny', the result is 'deny'.
   * Otherwise, if any matching rule specifies 'ask', the result is 'ask'.
   * Otherwise, if any matching rule specifies 'allow', the result is 'allow'.
   */
  evaluate(intent: ToolActionIntent, workspaceRoot?: string): PolicyDecision | undefined {
    const matchingRules: PolicyRuleDefinition[] = [];

    for (const rule of this.rules) {
      if (matchIntentPattern(intent, rule.pattern, workspaceRoot)) {
        matchingRules.push(rule);
      }
    }

    if (matchingRules.length === 0) {
      return undefined;
    }

    // 1. Check for 'deny' (deny beats allow)
    const denyRule = matchingRules.find((r) => r.effect === 'deny');
    if (denyRule) {
      return {
        result: 'deny',
        reason:
          denyRule.description ??
          `Action '${intent.toolName}' was denied by rule '${denyRule.id}' (layer: ${denyRule.layer}, pattern: ${denyRule.pattern})`,
      };
    }

    // 2. Check for 'ask'
    const askRule = matchingRules.find((r) => r.effect === 'ask');
    if (askRule) {
      return {
        result: 'ask',
        reason:
          askRule.description ??
          `Action '${intent.toolName}' requires user confirmation per rule '${askRule.id}' (layer: ${askRule.layer})`,
        requiredCapabilities: [intent.actionType],
      };
    }

    // 3. Check for 'allow'
    const allowRule = matchingRules.find((r) => r.effect === 'allow');
    if (allowRule) {
      return {
        result: 'allow',
        reason:
          allowRule.description ??
          `Action '${intent.toolName}' authorized by rule '${allowRule.id}' (layer: ${allowRule.layer})`,
      };
    }

    return undefined;
  }
}

/**
 * Default standard security rules enforced out-of-the-box
 */
export function createDefaultSecurityRules(): PolicyRuleDefinition[] {
  return [
    // Protect secrets and credential files
    {
      id: 'default-deny-credentials',
      layer: 'org',
      effect: 'deny',
      pattern: 'fs.read(**/.env*)',
      description: 'Access to .env files is blocked by default safety policy',
    },
    {
      id: 'default-deny-ssh',
      layer: 'org',
      effect: 'deny',
      pattern: 'fs.read(~/.ssh/**)',
      description: 'Access to ~/.ssh directory is forbidden by safety policy',
    },
    {
      id: 'default-deny-aws',
      layer: 'org',
      effect: 'deny',
      pattern: 'fs.read(~/.aws/**)',
      description: 'Access to ~/.aws directory is forbidden by safety policy',
    },
    {
      id: 'default-deny-git-hooks-write',
      layer: 'org',
      effect: 'deny',
      pattern: 'fs.write(**/.git/hooks/**)',
      description:
        'Tampering with git hooks is strictly forbidden to prevent arbitrary code execution',
    },
    {
      id: 'default-deny-git-config-write',
      layer: 'org',
      effect: 'deny',
      pattern: 'fs.write(**/.git/config)',
      description:
        'Tampering with git config is strictly forbidden to prevent arbitrary code execution',
    },
    {
      id: 'default-deny-destructive-rm',
      layer: 'org',
      effect: 'deny',
      pattern: 'shell(rm -rf *)',
      description: 'Destructive deletion is blocked',
    },
    {
      id: 'default-deny-destructive-mkfs',
      layer: 'org',
      effect: 'deny',
      pattern: 'shell(mkfs*)',
      description: 'Filesystem formatting is blocked',
    },
    {
      id: 'default-deny-fork-bomb',
      layer: 'org',
      effect: 'deny',
      pattern: 'shell(*:(){ :|:& };:*)',
      description: 'Fork bombs are blocked',
    },
  ];
}
