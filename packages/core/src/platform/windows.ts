import path from 'node:path';

export type ShellType = 'powershell' | 'cmd' | 'bash' | 'zsh' | 'sh';

export interface ShellEnvironmentInfo {
  readonly platform: 'win32' | 'darwin' | 'linux' | 'other';
  readonly isWindows: boolean;
  readonly shellType: ShellType;
  readonly shellExecutable: string;
  readonly defaultLineEnding: '\r\n' | '\n';
  readonly pathSeparator: '\\' | '/';
}

/**
 * Detects the host OS, active shell, and environment conventions.
 */
export function detectShellEnvironment(
  customEnv?: Readonly<Record<string, string>>,
  overridePlatform?: string,
): ShellEnvironmentInfo {
  const env = customEnv ?? (process.env as Record<string, string>);
  const currentPlatform = overridePlatform ?? process.platform;
  const isWindows = currentPlatform === 'win32';

  let shellType: ShellType = isWindows ? 'powershell' : 'bash';
  let shellExecutable = isWindows ? 'powershell.exe' : '/bin/bash';

  if (isWindows) {
    const comSpec = env['COMSPEC'] ?? '';
    const psModulePath = env['PSModulePath'];

    // If running inside bash on Windows (Git Bash, MSYS2)
    if (env['MSYSTEM'] || (env['SHELL'] && env['SHELL'].toLowerCase().endsWith('bash.exe'))) {
      shellType = 'bash';
      shellExecutable = env['SHELL'] ?? 'bash.exe';
    } else if (psModulePath || env['POWERSHELL_DISTRIBUTION_CHANNEL']) {
      shellType = 'powershell';
      shellExecutable = env['PWSH'] ?? 'powershell.exe';
    } else if (comSpec.toLowerCase().endsWith('cmd.exe')) {
      shellType = 'cmd';
      shellExecutable = comSpec || 'cmd.exe';
    }
  } else {
    const rawShell = env['SHELL'] ?? '';
    if (rawShell.endsWith('zsh')) {
      shellType = 'zsh';
      shellExecutable = rawShell;
    } else if (rawShell.endsWith('bash')) {
      shellType = 'bash';
      shellExecutable = rawShell;
    } else {
      shellType = 'sh';
      shellExecutable = rawShell || '/bin/sh';
    }
  }

  const platformName =
    currentPlatform === 'win32'
      ? 'win32'
      : currentPlatform === 'darwin'
        ? 'darwin'
        : currentPlatform === 'linux'
          ? 'linux'
          : 'other';

  return {
    platform: platformName,
    isWindows,
    shellType,
    shellExecutable,
    defaultLineEnding: isWindows ? '\r\n' : '\n',
    pathSeparator: isWindows ? '\\' : '/',
  };
}

/**
 * Detects whether a text document uses CRLF or LF line endings.
 */
export function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/[^\r]\n/g) || []).length;
  return crlfCount > lfCount ? '\r\n' : '\n';
}

/**
 * Enforces a consistent line ending across a string.
 */
export function preserveLineEnding(content: string, targetLineEnding: '\r\n' | '\n'): string {
  // First normalize all newlines to LF, then convert to target
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (targetLineEnding === '\r\n') {
    return normalized.replace(/\n/g, '\r\n');
  }
  return normalized;
}

/**
 * Normalizes file paths cross-platform:
 * - Handles Windows drive letters (C:\...)
 * - Handles Windows extended-length paths (\\?\)
 * - Normalizes slashes according to platform or standard form
 */
export function normalizePlatformPath(
  targetPath: string,
  isWindows = process.platform === 'win32',
): string {
  if (!targetPath) return targetPath;

  let cleaned = targetPath;
  // Handle long path prefix \\?\ or \\?\UNC\
  const hasLongPathPrefix = cleaned.startsWith('\\\\?\\');
  if (hasLongPathPrefix) {
    cleaned = cleaned.slice(4);
  }

  if (isWindows) {
    // Ensure drive letters are uppercase C:\ instead of c:\
    if (/^[a-zA-Z]:/.test(cleaned)) {
      cleaned = cleaned[0]!.toUpperCase() + cleaned.slice(1);
    }
    // Normalize to Windows backslashes
    cleaned = cleaned.replace(/\//g, '\\');
    return path.win32.normalize(cleaned);
  }

  return path.posix.normalize(cleaned.replace(/\\/g, '/'));
}

/**
 * Compares two paths taking case-insensitivity into account on Windows.
 */
export function arePathsEqual(
  pathA: string,
  pathB: string,
  isWindows = process.platform === 'win32',
): boolean {
  const normA = normalizePlatformPath(pathA, isWindows);
  const normB = normalizePlatformPath(pathB, isWindows);

  if (isWindows) {
    return normA.toLowerCase() === normB.toLowerCase();
  }
  return normA === normB;
}

/**
 * Formulates platform-specific instructions for the system prompt.
 */
export function getPlatformPromptContext(shellInfo: ShellEnvironmentInfo): string {
  if (shellInfo.isWindows) {
    return `[ENVIRONMENT: Windows Native (${shellInfo.shellType.toUpperCase()})]
- Operating System: Windows (Native, not WSL).
- Primary Shell: ${shellInfo.shellExecutable} (${shellInfo.shellType}).
- Filesystem & Paths: Windows drive letters (e.g. C:\\...) and backslashes. Case-insensitive filesystem.
- Line Endings: Preserve existing CRLF (\\r\\n) line endings in Windows source files.
- Shell Commands: When running shell commands, use ${
      shellInfo.shellType === 'powershell'
        ? 'PowerShell cmdlets (e.g. Get-ChildItem, Select-String, Test-Path, Set-Content). Avoid Unix-only binaries like grep/sed/cat.'
        : shellInfo.shellType === 'cmd'
          ? 'cmd.exe syntax (dir, findstr, type). Avoid Unix-only binaries.'
          : 'Git Bash / MSYS syntax.'
    }`;
  }

  return `[ENVIRONMENT: ${shellInfo.platform.toUpperCase()} (${shellInfo.shellType.toUpperCase()})]
- Operating System: ${shellInfo.platform}.
- Primary Shell: ${shellInfo.shellExecutable} (${shellInfo.shellType}).
- Path format: POSIX slashes (/), LF (\\n) line endings.`;
}
