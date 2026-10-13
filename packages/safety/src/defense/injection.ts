import {
  InjectionSource,
  InjectionSeverity,
  InjectionFinding,
  InjectionInspectionResult,
} from './types.js';

interface InjectionPattern {
  readonly name: string;
  readonly regex: RegExp;
  readonly severity: InjectionSeverity;
  readonly score: number;
  readonly description: string;
}

const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  {
    name: 'Instruction Override / Ignore',
    regex:
      /(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions|prompts|rules|directives)/i,
    severity: 'critical',
    score: 40,
    description: 'Attempts to wipe or override agent system instructions',
  },
  {
    name: 'System Prompt Impersonation',
    regex: /(?:\[\s*SYSTEM\s*\]|<\|im_start\|>system|<system>|SYSTEM\s+OVERRIDE:|<<SYS>>)/i,
    severity: 'critical',
    score: 40,
    description: 'Emits system-level framing tokens or role delimiters',
  },
  {
    name: 'Privilege Escalation Request',
    regex:
      /(?:grant\s+(?:all\s+)?capabilities|elevate\s+privileges|bypass(?:es|ing)?\s+policy|disable\s+(?:safety|sandbox|policy)|request(?:s)?\s+(?:root|admin|administrator|bypass)\s+(?:access|capabilities|permissions))/i,
    severity: 'high',
    score: 35,
    description: 'Attempts to request elevated permissions or bypass policy gate',
  },
  {
    name: 'Secret Exfiltration Directive',
    regex:
      /(?:send|exfiltrate|upload|curl|post)\s+(?:the\s+contents\s+of\s+)?(?:\.env|\.ssh|aws_secret|token|password|credentials)/i,
    severity: 'high',
    score: 30,
    description: 'Directs the agent to send sensitive local secrets to an external target',
  },
  {
    name: 'Agent Role Hijack',
    regex: /(?:you\s+are\s+now|act\s+as)\s+(?:DAN|unfiltered|jailbroken|an\s+unrestricted\s+AI)/i,
    severity: 'high',
    score: 25,
    description: 'Attempts to jailbreak or change agent operational persona',
  },
  {
    name: 'Hidden Directive Wrapper',
    regex: /<!--\s*(?:system|admin|secret\s+instruction)[\s\S]*?-->/i,
    severity: 'medium',
    score: 20,
    description: 'Hidden HTML comments disguising directives to the model',
  },
];

export class PromptInjectionGuard {
  inspect(content: string, source: InjectionSource): InjectionInspectionResult {
    const findings: InjectionFinding[] = [];
    let riskScore = 0;

    for (const pattern of INJECTION_PATTERNS) {
      const match = pattern.regex.exec(content);
      if (match) {
        findings.push({
          patternName: pattern.name,
          matchedText: match[0],
          severity: pattern.severity,
          description: pattern.description,
        });
        riskScore += pattern.score;
      }
    }

    riskScore = Math.min(100, riskScore);
    const hasInjection = findings.length > 0;

    let sanitizedContent: string | undefined = undefined;
    if (hasInjection) {
      sanitizedContent = this.sanitize(content, source);
    }

    return {
      hasInjection,
      riskScore,
      findings,
      sanitizedContent,
    };
  }

  sanitize(content: string, source: InjectionSource): string {
    // Neutralize dangerous tags and wrap with explicit untrusted boundary
    let text = content
      .replace(/<\|im_start\|>/gi, '[UNTRUSTED_DELIMITER]')
      .replace(/<\|im_end\|>/gi, '[UNTRUSTED_DELIMITER]')
      .replace(/<<SYS>>/gi, '[UNTRUSTED_SYS]')
      .replace(/<\/SYS>/gi, '[UNTRUSTED_SYS]');

    return `[UNTRUSTED_DATA_BOUNDARY source="${source}"]\n${text}\n[/UNTRUSTED_DATA_BOUNDARY]`;
  }
}
