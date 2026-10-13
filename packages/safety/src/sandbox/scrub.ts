const SENSITIVE_ENV_PATTERNS = [
  /key/i,
  /secret/i,
  /token/i,
  /password/i,
  /passwd/i,
  /auth/i,
  /credential/i,
  /jwt/i,
  /bearer/i,
  /^AWS_/i,
  /^GITHUB_/i,
  /^GH_/i,
  /^ANTHROPIC_/i,
  /^OPENAI_/i,
  /^GEMINI_/i,
  /^GOOGLE_/i,
  /^DATABASE_/i,
  /^PRIVATE_/i,
];

// Dangerous env variables that allow hijacking process execution or git hooks
const DANGEROUS_SYSTEM_ENV = new Set([
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_HOOKS_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'BASH_ENV',
  'ENV',
  'PROMPT_COMMAND',
  'PYTHONPATH',
  'PERL5LIB',
  'RUBYOPT',
]);

const ALLOWLISTED_SAFE_ENV = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'COLORTERM',
  'TMPDIR',
  'TMP',
  'TEMP',
  'PWD',
  'NODE_ENV',
  'CI',
]);

export interface ScrubbedEnvResult {
  readonly env: Record<string, string>;
  readonly strippedKeys: readonly string[];
}

/**
 * Scrubs environment variables to prevent secret leakage and arbitrary code execution escapes.
 */
export function scrubEnvironment(
  rawEnv: NodeJS.ProcessEnv = process.env,
  customAllowlist: readonly string[] = [],
): ScrubbedEnvResult {
  const resultEnv: Record<string, string> = {};
  const strippedKeys: string[] = [];

  const extraAllow = new Set(customAllowlist);

  for (const [key, value] of Object.entries(rawEnv)) {
    if (value === undefined) continue;

    // Explicitly dangerous execution hijacking variables are unconditionally blocked
    if (DANGEROUS_SYSTEM_ENV.has(key)) {
      strippedKeys.push(key);
      continue;
    }

    // Check custom allowlist
    if (extraAllow.has(key)) {
      resultEnv[key] = value;
      continue;
    }

    // Check safe allowlist
    if (ALLOWLISTED_SAFE_ENV.has(key)) {
      resultEnv[key] = value;
      continue;
    }

    // Check sensitive regex patterns (API keys, secrets, tokens)
    const isSensitive = SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitive) {
      strippedKeys.push(key);
      continue;
    }

    // Default: permit non-sensitive general config
    resultEnv[key] = value;
  }

  return { env: resultEnv, strippedKeys };
}
