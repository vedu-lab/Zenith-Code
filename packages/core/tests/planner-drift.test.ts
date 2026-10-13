import { describe, it, expect } from 'vitest';
import { TaskPlanner, PlanDriftDetector, CoreEventBus, SystemClock } from '../src/index.js';

describe('Plan-First & Plan Drift Detection', () => {
  const eventBus = new CoreEventBus();
  const clock = new SystemClock();

  it('TaskPlanner creates structured plan and emits plan.created event', () => {
    const planner = new TaskPlanner(eventBus, clock);
    let planEventReceived = false;

    eventBus.subscribe('plan.created', () => {
      planEventReceived = true;
    });

    const plan = planner.createPlan({
      steps: ['Inspect database schemas', 'Update user table migration', 'Run migration tests'],
      files: ['src/db/user.ts', 'migrations/001_users.sql'],
      commands: ['pnpm test:db'],
      risks: ['Table lock during column addition'],
      estimatedCostUsd: { low: 0.01, expected: 0.03, high: 0.06 },
    });

    expect(plan.steps).toHaveLength(3);
    expect(plan.files).toHaveLength(2);
    expect(plan.costEstimateUsd.expected).toBe(0.03);
    expect(planEventReceived).toBe(true);
  });

  it('PlanDriftDetector flags unplanned files and dependencies', () => {
    const planner = new TaskPlanner(eventBus, clock);
    const plan = planner.createPlan({
      steps: ['Fix auth typo'],
      files: ['src/auth.ts'],
      estimatedCostUsd: { low: 0.005, expected: 0.01, high: 0.02 },
    });

    const driftDetector = new PlanDriftDetector(eventBus, clock);

    // Scenario 1: Touched planned file only -> No drift
    const cleanReport = driftDetector.checkDrift(plan, ['src/auth.ts'], 0.01, 2);
    expect(cleanReport.hasDrift).toBe(false);

    // Scenario 2: Touched unplanned files and modified package.json -> Drift!
    let driftEventCaught = false;
    eventBus.subscribe('plan.drift_detected', () => {
      driftEventCaught = true;
    });

    const driftReport = driftDetector.checkDrift(
      plan,
      ['src/auth.ts', 'src/billing.ts', 'package.json'],
      0.015,
      3,
    );

    expect(driftReport.hasDrift).toBe(true);
    expect(driftReport.unplannedFiles).toContain('src/billing.ts');
    expect(driftReport.unplannedDependencies).toContain('package.json');
    expect(driftEventCaught).toBe(true);
  });

  it('PlanDriftDetector flags cost spikes exceeding plan threshold', () => {
    const planner = new TaskPlanner(eventBus, clock);
    const plan = planner.createPlan({
      steps: ['Optimize query'],
      files: ['src/query.ts'],
      estimatedCostUsd: { low: 0.01, expected: 0.02, high: 0.04 },
    });

    const driftDetector = new PlanDriftDetector(eventBus, clock);
    // Cost spikes to $0.07 (which is > 0.04 * 1.5)
    const report = driftDetector.checkDrift(plan, ['src/query.ts'], 0.07, 4);

    expect(report.hasDrift).toBe(true);
    expect(report.costSpike).toBe(true);
    expect(report.details).toContain('Cost spike');
  });
});
