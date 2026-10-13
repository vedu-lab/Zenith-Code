import { describe, it, expect } from 'vitest';
import { HumanHandoffManager, CoreEventBus, SystemClock } from '../src/index.js';

describe('Human Handoff & Resume-from-Handoff', () => {
  const eventBus = new CoreEventBus();
  const clock = new SystemClock();

  it('generates a structured one-screen brief and emits handoff.created', () => {
    const manager = new HumanHandoffManager(eventBus, clock);
    let eventReceived = false;

    eventBus.subscribe('handoff.created', () => {
      eventReceived = true;
    });

    const brief = manager.createHandoffBrief({
      goal: 'Migrate users table to postgres',
      reason: 'verification_failed',
      checkpointId: 'cp-failed-123',
      currentDiffSummary: '+ ALTER TABLE users ADD COLUMN uuid UUID;',
      attempts: [
        {
          attemptNumber: 1,
          action: 'Run db migration script',
          failureReason: 'Unique constraint violation on email column',
        },
        {
          attemptNumber: 2,
          action: 'Deduplicate test emails before migration',
          failureReason: 'Locked table timeout on foreign key cascade',
        },
      ],
      leadingHypothesis: 'Existing rows in production dump violate unique email constraint',
      hypothesisEvidence: 'Database logs indicate conflict on row ID 42',
      verifiedItems: ['Postgres connection established', 'Schema migration syntax valid'],
      unverifiedItems: ['Data integrity of legacy customer accounts'],
      openQuestions: ['Should duplicate email accounts be merged or archived?'],
      nextSteps: ['Run deduplication query with user confirmation', 'Re-apply migration'],
      reproCommands: ['pnpm test:migration'],
    });

    expect(brief.handoffId).toBeDefined();
    expect(brief.attempts).toHaveLength(2);
    expect(eventReceived).toBe(true);

    // Markdown export
    const md = manager.toMarkdown(brief);
    expect(md).toContain('Human Handoff Brief');
    expect(md).toContain('cp-failed-123');
    expect(md).toContain('Unique constraint violation on email column');
    expect(md).toContain('pnpm test:migration');

    // PR description export
    const prDesc = manager.toPrDescription(brief);
    expect(prDesc).toContain('Summary of Handoff');
    expect(prDesc).toContain('Attempt 1:');

    // Resume from handoff context
    const resumeMessages = manager.resumeFromHandoff(brief);
    expect(resumeMessages).toHaveLength(2);
    expect(resumeMessages[0]?.role).toBe('system');
    expect(resumeMessages[0]?.content).toContain('Human Handoff Brief');
    expect(resumeMessages[1]?.role).toBe('user');
    expect(resumeMessages[1]?.content).toContain(
      'Continue task: "Migrate users table to postgres"',
    );
  });
});
