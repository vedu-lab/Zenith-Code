import { EvidenceTag, EvidenceRecord, ClaimWithEvidence, VerificationStage } from './types.js';

export class EvidenceCollector {
  private readonly records: EvidenceRecord[] = [];
  private readonly claims: ClaimWithEvidence[] = [];
  private readonly notCheckedItems: Set<string> = new Set();

  recordEvidence(record: EvidenceRecord): void {
    this.records.push(record);
  }

  addClaim(claim: string, tag: EvidenceTag, evidence?: EvidenceRecord, note?: string): void {
    // If tagged as Verified but no evidence or evidence failed, downgrade to Not checked or Inferred
    let actualTag = tag;
    if (tag === 'Verified') {
      if (!evidence || evidence.exitCode !== 0) {
        actualTag = evidence ? 'Inferred' : 'Not checked';
      }
    }

    this.claims.push({
      claim,
      tag: actualTag,
      evidence: actualTag === 'Verified' ? evidence : undefined,
      note,
    });
  }

  addNotChecked(item: string): void {
    this.notCheckedItems.add(item);
  }

  getRecords(): readonly EvidenceRecord[] {
    return this.records;
  }

  getClaims(): readonly ClaimWithEvidence[] {
    return this.claims;
  }

  getNotChecked(): readonly string[] {
    return Array.from(this.notCheckedItems);
  }

  findEvidenceForStage(stage: VerificationStage): EvidenceRecord | undefined {
    return this.records.find((r) => r.stage === stage && r.exitCode === 0);
  }

  formatTrustReport(summaryHeader: string): string {
    const lines: string[] = [summaryHeader, ''];

    // 1. Evidence-backed claims
    lines.push('### Claims & Verification Status');
    if (this.claims.length === 0) {
      lines.push('- No claims recorded.');
    } else {
      for (const item of this.claims) {
        let tagBadge = `[${item.tag.toUpperCase()}]`;
        if (item.tag === 'Verified' && item.evidence?.command) {
          tagBadge += ` (cmd: \`${item.evidence.command}\`)`;
        }
        lines.push(`- ${tagBadge} ${item.claim}${item.note ? ` — *${item.note}*` : ''}`);
      }
    }
    lines.push('');

    // 2. Mandatory "What I did not check" section
    lines.push('### What I did not check');
    if (this.notCheckedItems.size === 0) {
      lines.push('- Unspecified external network dependencies or production services.');
    } else {
      for (const item of this.notCheckedItems) {
        lines.push(`- ${item}`);
      }
    }
    lines.push('');

    // 3. Evidence Log Table
    if (this.records.length > 0) {
      lines.push('### Verification Evidence Log');
      lines.push('| Stage | Command | Exit Code | Duration | Output Excerpt |');
      lines.push('| :--- | :--- | :--- | :--- | :--- |');
      for (const rec of this.records) {
        const cmd = rec.command ? `\`${rec.command}\`` : 'N/A';
        const out = rec.outputExcerpt.replace(/\n/g, ' ').slice(0, 60);
        lines.push(`| ${rec.stage} | ${cmd} | ${rec.exitCode} | ${rec.durationMs}ms | ${out} |`);
      }
    }

    return lines.join('\n');
  }
}
