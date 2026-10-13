import { describe, it, expect } from 'vitest';
import { ComplexityClassifier, EscalationEngine, CoreEventBus, SystemClock } from '../src/index.js';

describe('Fast Mode & Complexity Escalation', () => {
  const eventBus = new CoreEventBus();
  const clock = new SystemClock();

  describe('ComplexityClassifier', () => {
    it('classifies simple questions and typo fixes to fast model', () => {
      const q = ComplexityClassifier.classify('What does calculateTotal function do?');
      expect(q.level).toBe('simple');
      expect(q.modelRole).toBe('fast');

      const typo = ComplexityClassifier.classify('Fix typo in README.md');
      expect(typo.level).toBe('simple');
      expect(typo.modelRole).toBe('fast');
    });

    it('classifies complex multi-file refactors and security tasks to main model', () => {
      const refactor = ComplexityClassifier.classify(
        'Refactor authentication system to support multi-tenant OAuth2 and database migration',
        4,
      );
      expect(refactor.level).toBe('complex');
      expect(refactor.modelRole).toBe('main');
    });
  });

  describe('EscalationEngine', () => {
    it('escalates to main model when verification failures exceed threshold', () => {
      const engine = new EscalationEngine(eventBus, clock, {
        maxFailedVerificationAttempts: 2,
      });

      let escalationEventFired = false;
      eventBus.subscribe('model.escalated', () => {
        escalationEventFired = true;
      });

      const decision = engine.evaluateEscalation({
        currentModelRole: 'fast',
        currentModelName: 'qwen-fast',
        failedVerificationAttempts: 2,
        touchedFilesCount: 1,
        toolValidationErrorsCount: 0,
        currentContextTokens: 4000,
      });

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.targetModelRole).toBe('main');
      expect(decision.trigger).toBe('attempts_exceeded');
      expect(escalationEventFired).toBe(true);
    });

    it('escalates when touched files exceed threshold', () => {
      const engine = new EscalationEngine(eventBus, clock, {
        maxFilesTouchedBeforeEscalation: 3,
      });

      const decision = engine.evaluateEscalation({
        currentModelRole: 'fast',
        currentModelName: 'haiku',
        failedVerificationAttempts: 0,
        touchedFilesCount: 4, // 4 > 3
        toolValidationErrorsCount: 0,
        currentContextTokens: 5000,
      });

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.trigger).toBe('files_exceeded');
    });

    it('escalates when model signals low confidence', () => {
      const engine = new EscalationEngine(eventBus, clock);

      const decision = engine.evaluateEscalation({
        currentModelRole: 'fast',
        currentModelName: 'fast-model',
        failedVerificationAttempts: 0,
        touchedFilesCount: 1,
        toolValidationErrorsCount: 0,
        currentContextTokens: 2000,
        modelConfidence: 'low',
      });

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.trigger).toBe('low_confidence');
    });

    it('escalates when context window is exceeded', () => {
      const engine = new EscalationEngine(eventBus, clock, {
        fastModelMaxContextTokens: 16000,
      });

      const decision = engine.evaluateEscalation({
        currentModelRole: 'fast',
        currentModelName: 'fast-model',
        failedVerificationAttempts: 0,
        touchedFilesCount: 1,
        toolValidationErrorsCount: 0,
        currentContextTokens: 18000, // 18k > 16k
      });

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.trigger).toBe('context_overflow');
    });
  });
});
