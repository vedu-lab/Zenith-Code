import path from 'node:path';
import { PolicyGate, ToolActionIntent, PolicyDecision } from '../interfaces/index.js';

export interface AttenuationOptions {
  readonly agentId: string;
  readonly worktreePath: string;
  readonly declaredOwnership?: readonly string[] | undefined;
  readonly basePolicyGate?: PolicyGate | undefined;
}

export class AttenuatedPolicyGate implements PolicyGate {
  readonly agentId: string;
  readonly worktreePath: string;
  readonly declaredOwnership?: readonly string[] | undefined;
  private readonly basePolicyGate?: PolicyGate | undefined;

  constructor(options: AttenuationOptions) {
    this.agentId = options.agentId;
    this.worktreePath = path.resolve(options.worktreePath);
    this.declaredOwnership = options.declaredOwnership;
    this.basePolicyGate = options.basePolicyGate;
  }

  async check(intent: ToolActionIntent): Promise<PolicyDecision> {
    // 1. If base policy gate denies, always deny
    if (this.basePolicyGate) {
      const baseDecision = await this.basePolicyGate.check(intent);
      if (baseDecision.result !== 'allow') {
        return baseDecision;
      }
    }

    // 2. Attenuation: File mutation tools (write_file, edit_file, multi_edit)
    if (
      intent.toolName === 'write_file' ||
      intent.toolName === 'edit_file' ||
      intent.toolName === 'multi_edit'
    ) {
      const targetPaths: string[] = [];

      if (intent.toolName === 'multi_edit') {
        const edits = intent.parameters['edits'];
        if (Array.isArray(edits)) {
          for (const item of edits) {
            if (item && typeof item === 'object' && 'path' in item) {
              targetPaths.push(String(item.path));
            }
          }
        }
      } else {
        const p = intent.parameters['path'];
        if (typeof p === 'string') {
          targetPaths.push(p);
        }
      }

      for (const targetPath of targetPaths) {
        // Enforce sandbox containment within worktree
        const resolvedTarget = path.isAbsolute(targetPath)
          ? path.resolve(targetPath)
          : path.resolve(this.worktreePath, targetPath);

        const relative = path.relative(this.worktreePath, resolvedTarget);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          return {
            result: 'deny',
            reason: `Attenuated capability violation: File path '${targetPath}' escapes agent worktree root '${this.worktreePath}'.`,
          };
        }

        // Enforce collaborate mode declared ownership
        if (this.declaredOwnership && this.declaredOwnership.length > 0) {
          const isOwned =
            this.isPathOwned(relative, this.declaredOwnership) ||
            this.isPathOwned(targetPath, this.declaredOwnership);
          if (!isOwned) {
            return {
              result: 'deny',
              reason: `Attenuated capability violation: Agent '${this.agentId}' does not own file '${targetPath}'. Declared ownership: [${this.declaredOwnership.join(', ')}]`,
            };
          }
        }
      }
    }

    // 3. Attenuation: Shell commands
    if (intent.toolName === 'bash') {
      const cmd = String(intent.parameters['command'] ?? '');
      // Prevent attempts to escape worktree root via cd
      if (
        cmd.includes('cd ..') ||
        cmd.includes('cd /') ||
        cmd.includes('cd ~') ||
        cmd.includes('cd $HOME')
      ) {
        return {
          result: 'deny',
          reason: `Attenuated capability violation: Shell command attempts to change directory outside worktree.`,
        };
      }
    }

    return {
      result: 'allow',
      reason: `Authorized under attenuated sub-agent policy for ${this.agentId}`,
    };
  }

  async evaluate(intent: ToolActionIntent): Promise<PolicyDecision> {
    return this.check(intent);
  }

  private isPathOwned(filePath: string, ownershipPatterns: readonly string[]): boolean {
    const normalized = filePath.replace(/\\/g, '/');

    for (const pattern of ownershipPatterns) {
      const normalizedPat = pattern.replace(/\\/g, '/');
      if (normalizedPat === '*' || normalizedPat === '**') {
        return true;
      }

      // Convert simple glob pattern to regex
      const regexStr =
        '^' +
        normalizedPat
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '.*')
          .replace(/(?<!\.)\*/g, '[^/]*') +
        '$';

      const rx = new RegExp(regexStr);
      if (rx.test(normalized) || normalized.startsWith(normalizedPat.replace(/\*.*$/, ''))) {
        return true;
      }
    }

    return false;
  }
}
