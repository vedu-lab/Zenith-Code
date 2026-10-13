import { IEventBus } from '../events/index.js';
import { IClock } from '../interfaces/index.js';
import { ComplexityClassification, EscalationConfig, EscalationDecision } from './types.js';

export class ComplexityClassifier {
  static classify(prompt: string, estimatedFilesCount: number = 1): ComplexityClassification {
    const trimmed = prompt.trim();
    const lower = trimmed.toLowerCase();

    // 1. Informational queries / questions
    const isQuestion =
      /^(what|how|why|where|when|who|can you explain|explain|describe|tell me)\b/i.test(lower) ||
      (trimmed.endsWith('?') && !lower.includes('fix') && !lower.includes('refactor'));

    if (isQuestion) {
      return {
        level: 'simple',
        modelRole: 'fast',
        reason: 'Informational query or explanation requiring low compute.',
      };
    }

    // 2. Simple single-file edits / renames / typos / docs
    const isTrivialEdit =
      /^(rename|fix typo|add comment|update readme|format|clean up)\b/i.test(lower) ||
      (estimatedFilesCount <= 1 &&
        (lower.includes('rename') || lower.includes('typo') || lower.includes('comment')));

    if (isTrivialEdit) {
      return {
        level: 'simple',
        modelRole: 'fast',
        reason: 'Targeted single-file edit or rename suitable for fast model.',
      };
    }

    // 3. Multi-file refactor / architecture / deep debugging / migrations
    const isComplex =
      estimatedFilesCount > 2 ||
      lower.includes('refactor') ||
      lower.includes('architect') ||
      lower.includes('security') ||
      lower.includes('migrate') ||
      lower.includes('concurrency') ||
      lower.includes('database migration');

    if (isComplex) {
      return {
        level: 'complex',
        modelRole: 'main',
        reason: 'Multi-file change, architectural modification, or complex debugging task.',
      };
    }

    // Default moderate
    return {
      level: 'moderate',
      modelRole: 'fast',
      reason: 'Standard localized modification starting on fast model.',
    };
  }
}

interface ResolvedEscalationConfig {
  readonly maxFailedVerificationAttempts: number;
  readonly maxFilesTouchedBeforeEscalation: number;
  readonly maxToolValidationErrors: number;
  readonly fastModelMaxContextTokens: number;
}

export class EscalationEngine {
  private readonly config: ResolvedEscalationConfig;

  constructor(
    private readonly eventBus: IEventBus,
    private readonly clock: IClock,
    config: EscalationConfig = {},
  ) {
    this.config = {
      maxFailedVerificationAttempts: config.maxFailedVerificationAttempts ?? 2,
      maxFilesTouchedBeforeEscalation: config.maxFilesTouchedBeforeEscalation ?? 3,
      maxToolValidationErrors: config.maxToolValidationErrors ?? 2,
      fastModelMaxContextTokens: config.fastModelMaxContextTokens ?? 32_000,
    };
  }

  evaluateEscalation(state: {
    readonly currentModelRole: 'fast' | 'main';
    readonly currentModelName: string;
    readonly mainModelName?: string | undefined;
    readonly failedVerificationAttempts: number;
    readonly touchedFilesCount: number;
    readonly toolValidationErrorsCount: number;
    readonly currentContextTokens: number;
    readonly modelConfidence?: 'low' | 'high' | undefined;
  }): EscalationDecision {
    if (state.currentModelRole === 'main') {
      return {
        shouldEscalate: false,
        targetModelRole: 'main',
        reason: 'Already operating on main model.',
      };
    }

    const mainModel = state.mainModelName ?? 'main';

    // 1. Verification failures threshold
    if (state.failedVerificationAttempts >= this.config.maxFailedVerificationAttempts) {
      const reason = `Verification failed ${state.failedVerificationAttempts} times on fast model (threshold: ${this.config.maxFailedVerificationAttempts}).`;
      this.emitEscalation(state.currentModelName, mainModel, reason, {
        failedVerificationAttempts: state.failedVerificationAttempts,
      });
      return {
        shouldEscalate: true,
        targetModelRole: 'main',
        reason,
        trigger: 'attempts_exceeded',
      };
    }

    // 2. Touched files threshold
    if (state.touchedFilesCount > this.config.maxFilesTouchedBeforeEscalation) {
      const reason = `Scope expanded: ${state.touchedFilesCount} files touched (threshold: ${this.config.maxFilesTouchedBeforeEscalation}).`;
      this.emitEscalation(state.currentModelName, mainModel, reason, {
        touchedFilesCount: state.touchedFilesCount,
      });
      return {
        shouldEscalate: true,
        targetModelRole: 'main',
        reason,
        trigger: 'files_exceeded',
      };
    }

    // 3. Tool validation error loops
    if (state.toolValidationErrorsCount >= this.config.maxToolValidationErrors) {
      const reason = `Repeated tool validation errors (${state.toolValidationErrorsCount}) encountered on fast model.`;
      this.emitEscalation(state.currentModelName, mainModel, reason, {
        toolValidationErrorsCount: state.toolValidationErrorsCount,
      });
      return {
        shouldEscalate: true,
        targetModelRole: 'main',
        reason,
        trigger: 'tool_errors_exceeded',
      };
    }

    // 4. Model signals low confidence / uncertainty
    if (state.modelConfidence === 'low') {
      const reason = 'Model explicitly signaled low confidence or high uncertainty.';
      this.emitEscalation(state.currentModelName, mainModel, reason, {
        modelConfidence: 'low',
      });
      return {
        shouldEscalate: true,
        targetModelRole: 'main',
        reason,
        trigger: 'low_confidence',
      };
    }

    // 5. Context overflow
    if (state.currentContextTokens > this.config.fastModelMaxContextTokens) {
      const reason = `Context tokens (${state.currentContextTokens}) exceeded fast model window limit (${this.config.fastModelMaxContextTokens}).`;
      this.emitEscalation(state.currentModelName, mainModel, reason, {
        currentContextTokens: state.currentContextTokens,
      });
      return {
        shouldEscalate: true,
        targetModelRole: 'main',
        reason,
        trigger: 'context_overflow',
      };
    }

    return {
      shouldEscalate: false,
      targetModelRole: 'main',
      reason: 'No escalation threshold triggered; continuing on fast model.',
    };
  }

  private emitEscalation(
    fromModel: string,
    toModel: string,
    reason: string,
    thresholdDetails: Record<string, unknown>,
  ): void {
    void this.eventBus.publish({
      id: `esc-${this.clock.nowMs()}`,
      type: 'model.escalated',
      timestamp: this.clock.nowMs(),
      actor: 'system',
      payload: {
        fromModel,
        toModel,
        reason,
        thresholdDetails,
      },
    });
  }
}
