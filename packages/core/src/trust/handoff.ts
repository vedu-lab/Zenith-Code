import { IEventBus } from '../events/index.js';
import { IClock } from '../interfaces/index.js';
import { Message } from '../provider/types.js';
import { HandoffBrief, AttemptLog } from './types.js';

export class HumanHandoffManager {
  constructor(
    private readonly eventBus: IEventBus,
    private readonly clock: IClock,
  ) {}

  createHandoffBrief(params: {
    readonly goal: string;
    readonly reason:
      | 'verification_failed'
      | 'budget_exhausted'
      | 'policy_denial'
      | 'loop_detected'
      | 'user_requested';
    readonly checkpointId?: string | undefined;
    readonly currentDiffSummary: string;
    readonly attempts: readonly AttemptLog[];
    readonly leadingHypothesis: string;
    readonly hypothesisEvidence: string;
    readonly verifiedItems?: readonly string[] | undefined;
    readonly unverifiedItems?: readonly string[] | undefined;
    readonly openQuestions?: readonly string[] | undefined;
    readonly nextSteps?: readonly string[] | undefined;
    readonly reproCommands?: readonly string[] | undefined;
  }): HandoffBrief {
    const handoffId = `handoff-${this.clock.nowMs()}-${Math.random().toString(36).slice(2, 6)}`;

    const brief: HandoffBrief = {
      handoffId,
      goal: params.goal,
      checkpointId: params.checkpointId,
      currentDiffSummary: params.currentDiffSummary,
      attempts: params.attempts,
      leadingHypothesis: params.leadingHypothesis,
      hypothesisEvidence: params.hypothesisEvidence,
      verifiedItems: params.verifiedItems ?? [],
      unverifiedItems: params.unverifiedItems ?? [],
      openQuestions: params.openQuestions ?? [],
      nextSteps: params.nextSteps ?? [],
      reproCommands: params.reproCommands ?? [],
    };

    void this.eventBus.publish({
      id: `handoff-evt-${this.clock.nowMs()}`,
      type: 'handoff.created',
      timestamp: this.clock.nowMs(),
      actor: 'system',
      payload: {
        handoffId,
        reason: params.reason,
        briefSummary: `Handoff generated: ${params.reason} (${params.attempts.length} attempts logged)`,
        checkpointId: params.checkpointId,
      },
    });

    return brief;
  }

  toMarkdown(brief: HandoffBrief): string {
    const lines: string[] = [
      `# 🤝 Human Handoff Brief (${brief.handoffId})`,
      '',
      `**Goal:** ${brief.goal}`,
      brief.checkpointId ? `**Checkpoint ID:** \`${brief.checkpointId}\`` : '',
      '',
      '## Current Status & Changes',
      '```diff',
      brief.currentDiffSummary.trim() || 'No active diff recorded.',
      '```',
      '',
      '## Attempts & Failure Reasons',
    ];

    if (brief.attempts.length === 0) {
      lines.push('- No attempts recorded prior to handoff.');
    } else {
      for (const att of brief.attempts) {
        lines.push(`### Attempt ${att.attemptNumber}: ${att.action}`);
        lines.push(`- **Failure reason:** ${att.failureReason}`);
      }
    }
    lines.push('');

    lines.push('## Leading Hypothesis & Evidence');
    lines.push(`- **Hypothesis:** ${brief.leadingHypothesis}`);
    lines.push(`- **Evidence:** ${brief.hypothesisEvidence}`);
    lines.push('');

    lines.push('## Verified vs. Unverified');
    lines.push('### Verified:');
    if (brief.verifiedItems.length === 0) {
      lines.push('- None');
    } else {
      for (const item of brief.verifiedItems) {
        lines.push(`- [✔] ${item}`);
      }
    }

    lines.push('### Unverified / Not Checked:');
    if (brief.unverifiedItems.length === 0) {
      lines.push('- None');
    } else {
      for (const item of brief.unverifiedItems) {
        lines.push(`- [?] ${item}`);
      }
    }
    lines.push('');

    if (brief.openQuestions.length > 0) {
      lines.push('## Open Questions');
      for (const q of brief.openQuestions) {
        lines.push(`- ${q}`);
      }
      lines.push('');
    }

    if (brief.nextSteps.length > 0) {
      lines.push('## Recommended Next Steps');
      for (const s of brief.nextSteps) {
        lines.push(`1. ${s}`);
      }
      lines.push('');
    }

    if (brief.reproCommands.length > 0) {
      lines.push('## Exact Reproduction Commands');
      lines.push('```bash');
      for (const cmd of brief.reproCommands) {
        lines.push(cmd);
      }
      lines.push('```');
      lines.push('');
    }

    return lines.filter((l) => l !== undefined).join('\n');
  }

  toPrDescription(brief: HandoffBrief): string {
    return [
      `## Summary of Handoff: ${brief.goal}`,
      '',
      '### Context & Hypothesis',
      brief.leadingHypothesis,
      '',
      '### What was attempted',
      ...brief.attempts.map(
        (a) => `- **Attempt ${a.attemptNumber}:** ${a.action} (${a.failureReason})`,
      ),
      '',
      '### Next steps for reviewer / collaborator',
      ...brief.nextSteps.map((s) => `- ${s}`),
    ].join('\n');
  }

  resumeFromHandoff(brief: HandoffBrief): readonly Message[] {
    const summary = this.toMarkdown(brief);
    return [
      {
        role: 'system',
        content: `You are resuming work from a structured Human Handoff Brief. Focus on resolving the failed verification or blockers documented below. Do not repeat failed attempts.\n\n${summary}`,
      },
      {
        role: 'user',
        content: `Continue task: "${brief.goal}". Address the open questions and execute the recommended next steps.`,
      },
    ];
  }
}
