export interface ScanFinding {
  readonly type: 'secret' | 'pii';
  readonly patternName: string;
  readonly name: string;
  readonly matched: string;
}

export interface ScanResult {
  readonly hasSensitiveData: boolean;
  readonly findings: readonly ScanFinding[];
}

const SENSITIVE_PATTERNS: readonly {
  type: 'secret' | 'pii';
  name: string;
  regex: RegExp;
}[] = [
  // Secrets
  {
    type: 'secret',
    name: 'OpenAI API Key',
    regex: /sk-[a-zA-Z0-9_-]{20,}/,
  },
  {
    type: 'secret',
    name: 'Anthropic API Key',
    regex: /sk-ant-api[a-zA-Z0-9_-]{20,}/,
  },
  {
    type: 'secret',
    name: 'GitHub Token',
    regex: /gh[pousr]-[A-Za-z0-9_]{36,}/,
  },
  {
    type: 'secret',
    name: 'AWS Access Key',
    regex: /\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    type: 'secret',
    name: 'Private Key',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    type: 'secret',
    name: 'Bearer Token',
    regex: /bearer\s+[a-zA-Z0-9_\-\.]{25,}/i,
  },
  // PII
  {
    type: 'pii',
    name: 'Social Security Number',
    regex: /\b\d{3}-\d{2}-\d{4}\b/,
  },
  {
    type: 'pii',
    name: 'Credit Card Number',
    regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/,
  },
  {
    type: 'pii',
    name: 'Email Address',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  },
  {
    type: 'pii',
    name: 'Password in Text',
    regex: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{6,}["']?/i,
  },
];

export class MemoryScanner {
  scan(text: string): ScanResult {
    const findings: ScanFinding[] = [];

    for (const pat of SENSITIVE_PATTERNS) {
      const match = pat.regex.exec(text);
      if (match) {
        findings.push({
          type: pat.type,
          name: pat.name,
          patternName: pat.name,
          matched: match[0],
        });
      }
    }

    return {
      hasSensitiveData: findings.length > 0,
      findings,
    };
  }
}
