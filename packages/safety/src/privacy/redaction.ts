import { RedactionMatch, RedactionLogEntry } from './types.js';

interface SecretRule {
  readonly type: string;
  readonly regex: RegExp;
  readonly placeholder: string;
}

const SECRET_PATTERNS: readonly SecretRule[] = [
  {
    type: 'Anthropic API Key',
    regex: /sk-ant-api[a-zA-Z0-9_\-]{20,}/g,
    placeholder: '[REDACTED_ANTHROPIC_KEY]',
  },
  {
    type: 'OpenAI API Key',
    regex: /sk-[a-zA-Z0-9_-]{20,}/g,
    placeholder: '[REDACTED_OPENAI_KEY]',
  },
  {
    type: 'GitHub Token',
    regex: /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{30,}/g,
    placeholder: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    type: 'AWS Access Key ID',
    regex: /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
    placeholder: '[REDACTED_AWS_KEY_ID]',
  },
  {
    type: 'AWS Secret Access Key',
    regex:
      /(?:aws_secret_access_key|secret_key|aws_secret)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    placeholder: '[REDACTED_AWS_SECRET_KEY]',
  },
  {
    type: 'Private Key',
    regex: /-----BEGIN (?:[A-Z ]+) PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z ]+) PRIVATE KEY-----/g,
    placeholder: '[REDACTED_PRIVATE_KEY]',
  },
  {
    type: 'Bearer Token',
    regex: /Bearer\s+([a-zA-Z0-9\-._~+/]+=*){25,}/gi,
    placeholder: 'Bearer [REDACTED_BEARER_TOKEN]',
  },
  {
    type: 'Generic API Key / Password in URL',
    regex: /https?:\/\/[^\s/@:]+:([^\s/@:]+)@/g,
    placeholder: 'https://[USER]:[REDACTED_PASSWORD]@',
  },
];

export class SecretRedactor {
  private readonly log: RedactionLogEntry[] = [];

  redact(input: string): { sanitized: string; matches: readonly RedactionMatch[] } {
    let sanitized = input;
    const matches: RedactionMatch[] = [];
    const countsByType = new Map<string, number>();

    for (const rule of SECRET_PATTERNS) {
      // Reset regex state if global
      rule.regex.lastIndex = 0;
      let matchCount = 0;

      sanitized = sanitized.replace(rule.regex, (match) => {
        matchCount++;
        matches.push({
          secretType: rule.type,
          placeholder: rule.placeholder,
          matchedLength: match.length,
        });
        return rule.placeholder;
      });

      if (matchCount > 0) {
        countsByType.set(rule.type, (countsByType.get(rule.type) ?? 0) + matchCount);
      }
    }

    const now = Date.now();
    for (const [secretType, count] of countsByType.entries()) {
      this.log.push({
        timestamp: now,
        secretType,
        count,
      });
    }

    return { sanitized, matches };
  }

  getRedactionLog(): readonly RedactionLogEntry[] {
    return [...this.log];
  }

  clearLog(): void {
    this.log.length = 0;
  }
}
