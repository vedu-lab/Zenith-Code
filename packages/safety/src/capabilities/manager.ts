import { ToolActionIntent } from '@forge/core';
import {
  CapabilityToken,
  IssueTokenOptions,
  CapabilityAction,
  ICapabilityHandle,
} from './types.js';
import { TokenSigner } from './tokens.js';
import { CapabilityHandle } from './handle.js';
import { globToRegex } from '../policy/matcher.js';

export class CapabilityManager {
  private readonly tokens = new Map<string, CapabilityToken>();
  private readonly signer = new TokenSigner();

  /**
   * Issues an unforgeable cryptographic capability token.
   * Can only be called by system initialization or authorized user approval.
   */
  issueToken(options: IssueTokenOptions, nowMs = Date.now()): CapabilityToken {
    const token = this.signer.issueToken(options, nowMs);
    this.tokens.set(token.id, token);
    return token;
  }

  /**
   * Backward-compatible grant method for simple capability strings
   */
  grant(
    action: CapabilityAction,
    resourcePattern = '*',
    scope: 'task' | 'session' = 'session',
  ): CapabilityToken {
    return this.issueToken({
      action,
      resourcePattern,
      scope,
      issuer: 'system',
      ttlMs: 24 * 60 * 60 * 1000, // 24 hours
    });
  }

  /**
   * Backward-compatible revoke method
   */
  revokeAction(action: CapabilityAction, resourcePattern = '*'): void {
    for (const token of this.tokens.values()) {
      if (token.action === action && token.resourcePattern === resourcePattern) {
        this.tokens.delete(token.id);
      }
    }
  }

  /**
   * Revoke token by unique ID (CLI: forge caps revoke <token-id>)
   */
  revoke(tokenId: string): boolean {
    return this.tokens.delete(tokenId);
  }

  revokeToken(tokenId: string): boolean {
    return this.revoke(tokenId);
  }

  /**
   * Revokes all tokens associated with a completed or rewound task
   */
  revokeTask(taskId: string): number {
    let count = 0;
    for (const [id, token] of this.tokens.entries()) {
      if (token.scope === 'task' && token.taskId === taskId) {
        this.tokens.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Cleans up expired tokens
   */
  purgeExpired(nowMs = Date.now()): number {
    let count = 0;
    for (const [id, token] of this.tokens.entries()) {
      if (this.signer.isExpired(token, nowMs)) {
        this.tokens.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Checks whether a valid capability token exists and is authorized for the given intent.
   * Returns a CapabilityHandle if valid, or undefined if no capability matches.
   */
  findMatchingCapability(
    intent: ToolActionIntent,
    currentTaskId?: string,
    nowMs = Date.now(),
  ): ICapabilityHandle | undefined {
    this.purgeExpired(nowMs);

    for (const token of this.tokens.values()) {
      // 1. Signature validity
      if (!this.signer.verifySignature(token)) {
        continue;
      }

      // 2. Expiry & use count
      if (this.signer.isExpired(token, nowMs)) {
        continue;
      }

      // 3. Task scoping
      if (
        token.scope === 'task' &&
        token.taskId &&
        currentTaskId &&
        token.taskId !== currentTaskId
      ) {
        continue;
      }

      // 4. Action matching
      if (token.action !== '*' && token.action !== intent.actionType) {
        continue;
      }

      // 5. Resource pattern matching
      if (!this.matchesResource(intent.target, token.resourcePattern, intent.actionType)) {
        continue;
      }

      // Found valid matching capability
      return new CapabilityHandle(token, token.action, intent.target, intent, this.signer);
    }

    return undefined;
  }

  /**
   * Backward-compatible simple boolean check
   */
  hasCapability(action: CapabilityAction, target?: string, currentTaskId?: string): boolean {
    const dummyIntent: ToolActionIntent = {
      toolName: 'check',
      actionType: action as ToolActionIntent['actionType'],
      target: target ?? '*',
      parameters: {},
    };
    return this.findMatchingCapability(dummyIntent, currentTaskId) !== undefined;
  }

  /**
   * Attenuates capabilities for sub-agents:
   * A sub-agent can only receive an attenuated subset of parent capabilities.
   * Throws an error or returns null if sub-agent attempts privilege escalation.
   */
  attenuate(
    parentTokens: readonly CapabilityToken[],
    requested: IssueTokenOptions,
    nowMs = Date.now(),
  ): CapabilityToken | null {
    // Check if at least one parent token covers the requested capability
    const coveringParent = parentTokens.find((parent) => {
      if (!this.signer.verifySignature(parent) || this.signer.isExpired(parent, nowMs)) {
        return false;
      }
      if (parent.action !== '*' && parent.action !== requested.action) {
        return false;
      }
      if (parent.resourcePattern !== '*' && parent.resourcePattern !== requested.resourcePattern) {
        // Must be a subset pattern
        if (!requested.resourcePattern.startsWith(parent.resourcePattern.replace(/\*+$/, ''))) {
          return false;
        }
      }
      return true;
    });

    if (!coveringParent) {
      // Sub-agent attempted privilege escalation: request exceeds parent permissions
      return null;
    }

    // Attenuate: expiry and use counts cannot exceed covering parent
    const maxExpiresAt = Math.min(
      coveringParent.expiresAtMs,
      nowMs + (requested.ttlMs ?? 5 * 60 * 1000),
    );
    const ttlMs = maxExpiresAt - nowMs;
    const maxUses = Math.min(coveringParent.remainingUses, requested.maxUses ?? 10);

    return this.issueToken(
      {
        action: requested.action,
        resourcePattern: requested.resourcePattern,
        scope: 'task',
        taskId: requested.taskId,
        ttlMs,
        maxUses,
        issuer: 'system',
      },
      nowMs,
    );
  }

  /**
   * Lists capability tokens (CLI: forge caps list)
   */
  listTokens(includeExpired = false, nowMs = Date.now()): readonly CapabilityToken[] {
    const all = Array.from(this.tokens.values());
    if (includeExpired) {
      return all;
    }
    return all.filter((t) => !this.signer.isExpired(t, nowMs) && this.signer.verifySignature(t));
  }

  listActiveTokens(nowMs = Date.now()): readonly CapabilityToken[] {
    return this.listTokens(false, nowMs);
  }

  /**
   * Matches a target string against a capability resource pattern
   */
  private matchesResource(target: string, pattern: string, actionType: string): boolean {
    if (pattern === '*' || pattern === '**') {
      return true;
    }
    const isPath = actionType === 'fs:read' || actionType === 'fs:write';
    const regex = globToRegex(pattern, isPath);
    const normalizedTarget = isPath ? target.replace(/\\/g, '/') : target;
    return regex.test(normalizedTarget);
  }
}
