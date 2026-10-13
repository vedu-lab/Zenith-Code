import { PolicyDecisionResult } from '@forge/core';

export type PolicyMode = 'default' | 'acceptEdits' | 'plan' | 'bypass';
export type PolicyLayer = 'org' | 'user' | 'project' | 'session';

export interface PolicyRuleDefinition {
  readonly id: string;
  readonly layer: PolicyLayer;
  readonly effect: PolicyDecisionResult; // 'allow' | 'deny' | 'ask'
  readonly pattern: string; // e.g. "fs.write(src/**)", "shell(npm test)", "shell(git *)", "net(api.github.com)", "mcp(github:*)"
  readonly description?: string | undefined;
}

export interface PolicySettings {
  readonly mode?: PolicyMode | undefined;
  readonly allowBypassInCi?: boolean | undefined;
  readonly rules?: readonly PolicyRuleDefinition[] | undefined;
}

export interface EvaluatedRuleDecision {
  readonly rule: PolicyRuleDefinition;
  readonly effect: PolicyDecisionResult;
  readonly reason: string;
}
