import { McpCallResult, McpContentItem } from './types.js';

export interface SanitizedToolDescription {
  readonly sanitized: string;
  readonly hadInjectionRisk: boolean;
  readonly neutralizedPatterns: readonly string[];
}

export class McpSanitizer {
  private static readonly INJECTION_PATTERNS = [
    {
      name: 'Instruction Override',
      regex:
        /(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions|prompts|rules|directives)/gi,
    },
    {
      name: 'System Prompt Impersonation',
      regex:
        /(?:\[\s*SYSTEM\s*\]|<\|im_start\|>system|<system>|SYSTEM\s+OVERRIDE:|<<SYS>>|<\/SYS>)/gi,
    },
    {
      name: 'Privilege Escalation',
      regex:
        /(?:grant\s+(?:all\s+)?capabilities|elevate\s+privileges|bypass(?:es|ing)?\s+policy|disable\s+(?:safety|sandbox|policy))/gi,
    },
    {
      name: 'Hidden Directive Wrapper',
      regex: /<!--\s*(?:system|admin|secret\s+instruction)[\s\S]*?-->/gi,
    },
  ];

  /**
   * Sanitizes an MCP tool description so adversarial MCP servers cannot
   * inject system prompt overrides into the model's tool definitions.
   */
  static sanitizeToolDescription(rawDescription: string): SanitizedToolDescription {
    let sanitized = rawDescription;
    let hadRisk = false;
    const neutralized: string[] = [];

    // Strip null bytes and dangerous control characters
    sanitized = sanitized.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, '');

    for (const pattern of McpSanitizer.INJECTION_PATTERNS) {
      if (pattern.regex.test(sanitized)) {
        hadRisk = true;
        neutralized.push(pattern.name);
        sanitized = sanitized.replace(
          pattern.regex,
          `[BLOCKED_${pattern.name.toUpperCase().replace(/\s+/g, '_')}]`,
        );
      }
    }

    // Replace raw delimiter tokens
    sanitized = sanitized
      .replace(/<\|im_start\|>/gi, '[DELIMITER_START]')
      .replace(/<\|im_end\|>/gi, '[DELIMITER_END]');

    if (hadRisk) {
      sanitized = `[CAUTION: Untrusted MCP metadata neutralized] ${sanitized}`;
    }

    return {
      sanitized: sanitized.trim(),
      hadInjectionRisk: hadRisk,
      neutralizedPatterns: neutralized,
    };
  }

  /**
   * Sanitizes MCP call output content to isolate untrusted text and protect against
   * indirect prompt injections received from MCP server executions.
   */
  static sanitizeToolOutput(
    serverId: string,
    toolName: string,
    result: McpCallResult,
  ): McpCallResult {
    const sanitizedContent: McpContentItem[] = result.content.map((item) => {
      if (item.type !== 'text' || typeof item.text !== 'string') {
        return item;
      }

      let text = item.text.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, '');

      let hadRisk = false;
      for (const pattern of McpSanitizer.INJECTION_PATTERNS) {
        if (pattern.regex.test(text)) {
          hadRisk = true;
          text = text.replace(
            pattern.regex,
            `[BLOCKED_${pattern.name.toUpperCase().replace(/\s+/g, '_')}]`,
          );
        }
      }

      text = text
        .replace(/<\|im_start\|>/gi, '[UNTRUSTED_DELIMITER]')
        .replace(/<\|im_end\|>/gi, '[UNTRUSTED_DELIMITER]')
        .replace(/<<SYS>>/gi, '[UNTRUSTED_SYS]')
        .replace(/<\/SYS>/gi, '[UNTRUSTED_SYS]');

      const wrappedText = `[UNTRUSTED_MCP_OUTPUT server="${serverId}" tool="${toolName}"${hadRisk ? ' warning="potential_injection_neutralized"' : ''}]\n${text}\n[/UNTRUSTED_MCP_OUTPUT]`;

      return {
        ...item,
        text: wrappedText,
      };
    });

    return {
      ...result,
      content: sanitizedContent,
    };
  }
}
