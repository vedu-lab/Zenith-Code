import {
  IPolicyEngine,
  ToolActionIntent,
  PolicyDecision,
  PolicyGate,
  IEventBus,
} from '@forge/core';
import { CapabilityManager } from '../capabilities/manager.js';
import { ICapabilityHandle, CapabilityAction } from '../capabilities/types.js';
import { LayeredRuleStore, createDefaultSecurityRules } from './rules.js';
import { PolicyMode, PolicySettings, PolicyRuleDefinition } from './types.js';

export interface PolicyEngineOptions {
  readonly workspaceRoot?: string | undefined;
  readonly mode?: PolicyMode | undefined;
  readonly settings?: PolicySettings | undefined;
  readonly isCi?: boolean | undefined;
  readonly eventBus?: IEventBus | undefined;
}

export class PolicyEngine implements IPolicyEngine, PolicyGate {
  private readonly ruleStore: LayeredRuleStore;
  private mode: PolicyMode;
  private readonly workspaceRoot: string;
  private readonly isCi: boolean;
  private readonly allowBypassInCi: boolean;
  private currentTaskId: string | undefined;

  constructor(
    readonly capabilities: CapabilityManager = new CapabilityManager(),
    options: PolicyEngineOptions = {},
  ) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.mode = options.mode ?? options.settings?.mode ?? 'default';
    this.isCi = options.isCi ?? Boolean(process.env['CI'] || process.env['GITHUB_ACTIONS']);
    this.allowBypassInCi = options.settings?.allowBypassInCi ?? false;

    // Initialize layered rule store with default security rules
    const defaultRules = createDefaultSecurityRules();
    const customRules = options.settings?.rules ?? [];
    this.ruleStore = new LayeredRuleStore([...defaultRules, ...customRules]);
  }

  setMode(mode: PolicyMode): void {
    this.mode = mode;
  }

  getMode(): PolicyMode {
    return this.mode;
  }

  setCurrentTaskId(taskId: string | undefined): void {
    this.currentTaskId = taskId;
  }

  addRule(rule: PolicyRuleDefinition): void {
    this.ruleStore.addRule(rule);
  }

  getRuleStore(): LayeredRuleStore {
    return this.ruleStore;
  }

  /**
   * Main gatekeeper method implementing IPolicyEngine and PolicyGate.
   * Single gate for fs read/write/edit, shell, network, web_fetch, and every MCP tool call.
   */
  async check(intent: ToolActionIntent): Promise<PolicyDecision> {
    const { decision } = await this.authorize(intent);
    return decision;
  }

  async evaluate(intent: ToolActionIntent): Promise<PolicyDecision> {
    return this.check(intent);
  }

  /**
   * Authorizes an intent and returns a validated capability handle.
   * Tools must hold this handle to execute operations.
   */
  async authorize(intent: ToolActionIntent): Promise<{
    decision: PolicyDecision;
    handle?: ICapabilityHandle | undefined;
  }> {
    // 1. Bypass Mode check
    if (this.mode === 'bypass') {
      if (this.isCi && !this.allowBypassInCi) {
        return {
          decision: {
            result: 'deny',
            reason:
              'Policy bypass mode is strictly disabled in CI environments unless explicitly permitted by organization policy.',
          },
        };
      }
      // Issue an ephemeral bypass handle
      this.capabilities.issueToken({
        action: '*',
        resourcePattern: '*',
        scope: 'task',
        taskId: this.currentTaskId,
        ttlMs: 60000,
        issuer: 'system',
      });
      const handle = this.capabilities.findMatchingCapability(intent, this.currentTaskId);
      return {
        decision: {
          result: 'allow',
          reason:
            '[WARNING: POLICY BYPASS ACTIVE] Tool action permitted without security verification.',
        },
        ...(handle ? { handle } : {}),
      };
    }

    // 2. Plan Mode check (Strictly Read-Only)
    if (this.mode === 'plan') {
      if (intent.actionType !== 'fs:read') {
        return {
          decision: {
            result: 'deny',
            reason: `Action '${intent.toolName}' is forbidden in Plan Mode. Plan Mode is strictly read-only.`,
          },
        };
      }
    }

    // 3. Layered Rules check (Deny beats allow)
    const ruleDecision = this.ruleStore.evaluate(intent, this.workspaceRoot);
    if (ruleDecision) {
      if (ruleDecision.result === 'allow') {
        // Issue/retrieve capability handle
        const handle =
          this.capabilities.findMatchingCapability(intent, this.currentTaskId) ??
          this.issueRuleAuthorizedHandle(intent);
        return { decision: ruleDecision, handle };
      }
      return { decision: ruleDecision };
    }

    // 4. AcceptEdits Mode check
    if (this.mode === 'acceptEdits') {
      if (
        (intent.actionType === 'fs:write' || intent.actionType === 'fs:read') &&
        this.isInsideWorkspace(intent.target)
      ) {
        const handle =
          this.capabilities.findMatchingCapability(intent, this.currentTaskId) ??
          this.issueRuleAuthorizedHandle(intent);
        return {
          decision: {
            result: 'allow',
            reason: `Auto-authorized file action in acceptEdits mode: ${intent.target}`,
          },
          handle,
        };
      }
    }

    // 5. Capability Token lookup (Default mode)
    const matchingHandle = this.capabilities.findMatchingCapability(intent, this.currentTaskId);
    if (matchingHandle) {
      return {
        decision: {
          result: 'allow',
          reason: `Action '${intent.toolName}' authorized by granted capability token '${matchingHandle.tokenId}'`,
        },
        handle: matchingHandle,
      };
    }

    // 6. Default fallback: Safe by default -> Ask for confirmation
    return {
      decision: {
        result: 'ask',
        reason: `Action '${intent.toolName}' on '${intent.target}' requires explicit user confirmation.`,
        requiredCapabilities: [intent.actionType],
      },
    };
  }

  private isInsideWorkspace(targetPath: string): boolean {
    const normalizedTarget = targetPath.replace(/\\/g, '/');
    const normalizedRoot = this.workspaceRoot.replace(/\\/g, '/');
    return (
      !normalizedTarget.includes('..') &&
      (normalizedTarget.startsWith(normalizedRoot) || !normalizedTarget.startsWith('/'))
    );
  }

  private issueRuleAuthorizedHandle(intent: ToolActionIntent): ICapabilityHandle {
    this.capabilities.issueToken({
      action: intent.actionType as CapabilityAction,
      resourcePattern: intent.target,
      scope: 'task',
      taskId: this.currentTaskId,
      ttlMs: 5 * 60 * 1000,
      issuer: 'system',
    });
    return this.capabilities.findMatchingCapability(intent, this.currentTaskId)!;
  }
}
