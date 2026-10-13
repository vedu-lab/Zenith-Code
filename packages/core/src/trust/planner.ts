import { IEventBus } from '../events/index.js';
import { IClock } from '../interfaces/index.js';
import { TrustPlan, PlanDriftReport } from './types.js';

export class TaskPlanner {
  constructor(
    private readonly eventBus: IEventBus,
    private readonly clock: IClock,
  ) {}

  createPlan(params: {
    readonly planId?: string | undefined;
    readonly steps: readonly string[];
    readonly files: readonly string[];
    readonly commands?: readonly string[] | undefined;
    readonly risks?: readonly string[] | undefined;
    readonly verificationMethod?: string | undefined;
    readonly estimatedCostUsd?: { low: number; expected: number; high: number } | undefined;
    readonly estimatedDurationSeconds?: { min: number; max: number } | undefined;
  }): TrustPlan {
    const planId =
      params.planId ?? `plan-${this.clock.nowMs()}-${Math.random().toString(36).slice(2, 6)}`;
    const costEstimate = params.estimatedCostUsd ?? {
      low: 0.005,
      expected: 0.02,
      high: 0.05,
    };
    const durationEstimate = params.estimatedDurationSeconds ?? {
      min: 15,
      max: 60,
    };

    const plan: TrustPlan = {
      planId,
      steps: params.steps,
      files: params.files,
      commands: params.commands ?? [],
      risks: params.risks ?? [],
      verificationMethod: params.verificationMethod ?? 'DoneGate multi-stage verification loop',
      costEstimateUsd: costEstimate,
      durationSecondsEstimate: durationEstimate,
    };

    void this.eventBus.publish({
      id: `plan-evt-${this.clock.nowMs()}`,
      type: 'plan.created',
      timestamp: this.clock.nowMs(),
      actor: 'agent',
      payload: {
        planId: plan.planId,
        steps: plan.steps,
        files: plan.files,
        commands: plan.commands,
        estimatedCostUsd: plan.costEstimateUsd.expected,
        estimatedDurationSeconds: plan.durationSecondsEstimate.max,
      },
    });

    return plan;
  }
}

export class PlanDriftDetector {
  constructor(
    private readonly eventBus: IEventBus,
    private readonly clock: IClock,
  ) {}

  checkDrift(
    plan: TrustPlan,
    touchedFiles: readonly string[],
    currentCostUsd: number = 0,
    currentTurns: number = 0,
  ): PlanDriftReport {
    const plannedFileSet = new Set(plan.files.map((f) => f.toLowerCase().trim()));
    const unplannedFiles: string[] = [];
    const unplannedDependencies: string[] = [];

    const depFiles = [
      'package.json',
      'pnpm-lock.yaml',
      'package-lock.json',
      'yarn.lock',
      'requirements.txt',
      'poetry.lock',
      'cargo.toml',
      'cargo.lock',
      'go.mod',
      'go.sum',
    ];

    for (const file of touchedFiles) {
      const lower = file.toLowerCase().trim();
      const isPlanned =
        plannedFileSet.has(lower) || Array.from(plannedFileSet).some((p) => lower.endsWith(p));

      if (!isPlanned) {
        unplannedFiles.push(file);
      }

      if (depFiles.some((dep) => lower.endsWith(dep)) && !isPlanned) {
        unplannedDependencies.push(file);
      }
    }

    const costSpike = currentCostUsd > plan.costEstimateUsd.high * 1.5;
    const turnSpike = currentTurns > 20;

    const hasDrift =
      unplannedFiles.length > 0 || unplannedDependencies.length > 0 || costSpike || turnSpike;

    const detailsParts: string[] = [];
    if (unplannedFiles.length > 0) {
      detailsParts.push(`Unplanned files touched: ${unplannedFiles.join(', ')}`);
    }
    if (unplannedDependencies.length > 0) {
      detailsParts.push(`Unplanned dependencies modified: ${unplannedDependencies.join(', ')}`);
    }
    if (costSpike) {
      detailsParts.push(
        `Cost spike: $${currentCostUsd.toFixed(4)} exceeds high estimate $${plan.costEstimateUsd.high.toFixed(4)} by >50%`,
      );
    }
    if (turnSpike) {
      detailsParts.push(`Turn spike: turn count (${currentTurns}) exceeds planned budget`);
    }

    const details = detailsParts.join('; ') || 'No drift detected.';

    if (hasDrift) {
      let driftType: 'unplanned_files' | 'unplanned_dependencies' | 'cost_spike' | 'turns_spike' =
        'unplanned_files';
      if (unplannedDependencies.length > 0) {
        driftType = 'unplanned_dependencies';
      } else if (costSpike) {
        driftType = 'cost_spike';
      } else if (turnSpike) {
        driftType = 'turns_spike';
      }

      void this.eventBus.publish({
        id: `drift-${this.clock.nowMs()}`,
        type: 'plan.drift_detected',
        timestamp: this.clock.nowMs(),
        actor: 'system',
        payload: {
          driftType,
          details,
          unplannedItems: unplannedFiles,
        },
      });
    }

    return {
      hasDrift,
      unplannedFiles,
      unplannedDependencies,
      costSpike,
      turnSpike,
      details,
    };
  }
}
