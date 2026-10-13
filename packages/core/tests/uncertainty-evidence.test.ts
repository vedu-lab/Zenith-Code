import { describe, it, expect } from 'vitest';
import { EvidenceCollector } from '../src/index.js';

describe('Uncertainty Signaling & Evidence Weighting', () => {
  it('correctly tags claims backed by empirical evidence as Verified', () => {
    const collector = new EvidenceCollector();
    collector.recordEvidence({
      stage: 'existing_tests',
      command: 'pnpm test',
      exitCode: 0,
      outputExcerpt: 'All 15 tests passed',
      durationMs: 420,
      timestamp: Date.now(),
    });

    collector.addClaim('Auth token validation passes', 'Verified', {
      stage: 'existing_tests',
      command: 'pnpm test',
      exitCode: 0,
      outputExcerpt: 'All 15 tests passed',
      durationMs: 420,
      timestamp: Date.now(),
    });

    const claims = collector.getClaims();
    expect(claims[0]?.tag).toBe('Verified');
    expect(claims[0]?.evidence?.command).toBe('pnpm test');
  });

  it('downgrades claims tagged as Verified without empirical evidence to Inferred or Not checked', () => {
    const collector = new EvidenceCollector();

    // Model claimed "Verified" without any command execution evidence!
    collector.addClaim('Performance is improved', 'Verified');

    const claims = collector.getClaims();
    expect(claims[0]?.tag).toBe('Not checked');
  });

  it('downgrades claims where command execution failed to Inferred', () => {
    const collector = new EvidenceCollector();

    collector.addClaim('Database migration works', 'Verified', {
      stage: 'smoke_command',
      command: 'migrate up',
      exitCode: 1, // Exit code 1!
      outputExcerpt: 'Migration error: connection refused',
      durationMs: 100,
      timestamp: Date.now(),
    });

    const claims = collector.getClaims();
    expect(claims[0]?.tag).toBe('Inferred');
  });

  it('formats trust report with mandatory "What I did not check" section', () => {
    const collector = new EvidenceCollector();
    collector.addClaim('Local unit tests pass', 'Inferred');
    collector.addNotChecked('Load testing under 10k concurrent users');
    collector.addNotChecked('Production database failover');

    const report = collector.formatTrustReport('### Verification Summary');

    expect(report).toContain('### Claims & Verification Status');
    expect(report).toContain('[INFERRED] Local unit tests pass');
    expect(report).toContain('### What I did not check');
    expect(report).toContain('Load testing under 10k concurrent users');
    expect(report).toContain('Production database failover');
  });
});
