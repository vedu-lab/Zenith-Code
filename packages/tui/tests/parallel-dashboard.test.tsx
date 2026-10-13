import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import {
  ParallelDashboard,
  ReviewerReportView,
  ParallelDashboardData,
  findSlashCommand,
} from '../src/index.js';

describe('Parallel TUI Components', () => {
  it('ParallelDashboard: renders multi-agent status, costs, test states, and cost warning banner', () => {
    const data: ParallelDashboardData = {
      runId: 'run-123',
      mode: 'compete',
      costWarning:
        'Warning: Running 2 parallel agents costs approximately 2 times as much. Total cap: $1.00.',
      totalCostUsd: 0.145,
      totalCostCapUsd: 1.0,
      maxConcurrency: 2,
      agents: [
        {
          agentId: 'agent-1',
          name: 'Fast Minimal',
          model: 'claude-3-5-haiku',
          strategy: 'minimal_patch',
          status: 'completed',
          costUsd: 0.045,
          budgetUsd: 0.25,
          elapsedMs: 2500,
          testStatus: 'passed',
          touchedFilesCount: 1,
        },
        {
          agentId: 'agent-2',
          name: 'Deep Refactor',
          model: 'claude-3-5-sonnet',
          strategy: 'refactor',
          status: 'running',
          costUsd: 0.1,
          budgetUsd: 0.35,
          elapsedMs: 4500,
          testStatus: 'pending',
          touchedFilesCount: 3,
        },
      ],
      reviewerSummary: 'Agent 1 passed all verifications with lower cost and cleaner diff.',
      winnerId: 'agent-1',
    };

    const { lastFrame } = render(<ParallelDashboard data={data} />);
    const frame = lastFrame();

    expect(frame).toContain('PARALLEL AGENTS DASHBOARD');
    expect(frame).toContain('[COMPETE MODE]');
    expect(frame).toContain(
      'Warning: Running 2 parallel agents costs approximately 2 times as much',
    );
    expect(frame).toContain('Fast Minimal');
    expect(frame).toContain('Deep Refactor');
    expect(frame).toContain('COMPLETED');
    expect(frame).toContain('RUNNING');
    expect(frame).toContain('✓ PASS');
    expect(frame).toContain('Agent 1 passed all verifications');
    expect(frame).toContain("Top Candidate: Agent 'agent-1'");
  });

  it('ReviewerReportView: renders ranked candidates, diff preview, and user approval gate', () => {
    let approved = false;
    let rejected = false;

    const diffSample = `--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,3 +1,3 @@\n-const a = 1;\n+const a = 2;`;

    const { lastFrame } = render(
      <ReviewerReportView
        summary="Agent 1 scored 95/100 and resolved the issue with zero test regressions."
        winnerId="agent-1"
        recommendedStrategy="pick"
        diff={diffSample}
        candidates={[
          { agentId: 'agent-1', rank: 1, score: 95, testPassed: true },
          { agentId: 'agent-2', rank: 2, score: 55, testPassed: false },
        ]}
        onApprove={() => {
          approved = true;
        }}
        onReject={() => {
          rejected = true;
        }}
      />,
    );

    const frame = lastFrame();

    expect(frame).toContain('REVIEWER AGENT EVALUATION & RECONCILIATION');
    expect(frame).toContain("Top Ranked Winner: Agent 'agent-1'");
    expect(frame).toContain('Agent 1 scored 95/100');
    expect(frame).toContain("Rank 1: Agent 'agent-1' (Score: 95/100)");
    expect(frame).toContain("Rank 2: Agent 'agent-2' (Score: 55/100)");
    expect(frame).toContain('USER APPROVAL REQUIRED BEFORE MERGING TO WORKING TREE');
    expect(frame).toContain(
      'Your active working tree will remain completely clean unless explicitly approved',
    );
    expect(frame).toContain('Approve & Merge to Working Tree');
    expect(frame).toContain('Reject (Leave Working Tree Clean)');
    expect(approved).toBe(false);
    expect(rejected).toBe(false);
  });

  it('Slash Commands: supports /parallel, /compete, and /collaborate commands', () => {
    const parallelCmd = findSlashCommand('/parallel');
    expect(parallelCmd).toBeDefined();
    expect(parallelCmd?.cmd.name).toBe('/parallel');

    const competeCmd = findSlashCommand('/compete fix auth token bug');
    expect(competeCmd).toBeDefined();
    expect(competeCmd?.cmd.name).toBe('/compete');
    expect(competeCmd?.args).toBe('fix auth token bug');

    const collabCmd = findSlashCommand('/collaborate build auth and billing');
    expect(collabCmd).toBeDefined();
    expect(collabCmd?.cmd.name).toBe('/collaborate');
    expect(collabCmd?.args).toBe('build auth and billing');
  });
});
