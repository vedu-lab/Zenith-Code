import path from 'node:path';
import { ToolActionIntent } from '@forge/core';

export interface ParsedPattern {
  readonly category: 'fs.read' | 'fs.write' | 'fs.edit' | 'shell' | 'net' | 'mcp';
  readonly targetPattern: string;
}

/**
 * Parses pattern strings like "fs.write(src/**)", "shell(git *)", "net(api.github.com)", "mcp(github:*)"
 */
export function parsePattern(pattern: string): ParsedPattern | null {
  const trimmed = pattern.trim();
  const match = trimmed.match(/^([a-zA-Z._]+)\((.*)\)$/);
  if (!match) {
    return null;
  }

  const categoryRaw = match[1]?.toLowerCase();
  const targetPattern = match[2]?.trim() ?? '';

  switch (categoryRaw) {
    case 'fs.read':
    case 'fs:read':
      return { category: 'fs.read', targetPattern };
    case 'fs.write':
    case 'fs:write':
      return { category: 'fs.write', targetPattern };
    case 'fs.edit':
    case 'fs:edit':
      return { category: 'fs.edit', targetPattern };
    case 'shell':
    case 'exec':
    case 'exec:command':
      return { category: 'shell', targetPattern };
    case 'net':
    case 'network':
    case 'net:request':
      return { category: 'net', targetPattern };
    case 'mcp':
    case 'mcp:call':
      return { category: 'mcp', targetPattern };
    default:
      return null;
  }
}

/**
 * Converts a glob pattern like `src/**` or `*.ts` or `git *` into a regular expression.
 */
export function globToRegex(glob: string, isPath = true): RegExp {
  let regexStr = '';
  let i = 0;

  // Handle leading wildcard or path normalization
  const normalizedGlob = isPath ? glob.replace(/\\/g, '/') : glob;

  while (i < normalizedGlob.length) {
    const char = normalizedGlob[i]!;

    if (char === '*' && normalizedGlob[i + 1] === '*' && isPath) {
      if (normalizedGlob[i + 2] === '/') {
        regexStr += '(?:.*?/)?';
        i += 3;
      } else {
        regexStr += '.*?';
        i += 2;
      }
    } else if (char === '*') {
      if (isPath) {
        regexStr += '[^/]*?';
      } else {
        regexStr += '.*?';
      }
      i++;
    } else if (char === '?') {
      regexStr += isPath ? '[^/]' : '.';
      i++;
    } else if ('[\\](){}+.^$|'.includes(char)) {
      regexStr += '\\' + char;
      i++;
    } else {
      regexStr += char;
      i++;
    }
  }

  return new RegExp(`^${regexStr}$`, 'i');
}

/**
 * Checks whether a ToolActionIntent matches a pattern string.
 */
export function matchIntentPattern(
  intent: ToolActionIntent,
  patternStr: string,
  workspaceRoot?: string,
): boolean {
  const parsed = parsePattern(patternStr);
  if (!parsed) {
    return false;
  }

  const { category, targetPattern } = parsed;

  switch (intent.actionType) {
    case 'fs:read': {
      if (category !== 'fs.read') return false;
      return matchPath(intent.target, targetPattern, workspaceRoot);
    }

    case 'fs:write': {
      if (category !== 'fs.write' && category !== 'fs.edit') return false;
      return matchPath(intent.target, targetPattern, workspaceRoot);
    }

    case 'exec:command': {
      if (category !== 'shell') return false;
      return matchShellCommand(intent.target, targetPattern);
    }

    case 'net:request': {
      if (category !== 'net') return false;
      return matchNetworkTarget(intent.target, targetPattern);
    }

    case 'mcp:call': {
      if (category !== 'mcp') return false;
      return matchMcpTarget(intent.target, targetPattern);
    }

    default:
      return false;
  }
}

function matchPath(targetPath: string, pattern: string, workspaceRoot?: string): boolean {
  if (pattern === '*' || pattern === '**') {
    return true;
  }

  const normalizedTarget = targetPath.replace(/\\/g, '/');
  let relTarget = normalizedTarget;
  if (workspaceRoot) {
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
    if (normalizedTarget.startsWith(normalizedRoot)) {
      relTarget = path.relative(workspaceRoot, targetPath).replace(/\\/g, '/');
    }
  }

  const regex = globToRegex(pattern, true);
  return regex.test(relTarget) || regex.test(normalizedTarget);
}

function matchShellCommand(command: string, pattern: string): boolean {
  if (pattern === '*' || pattern === '**') {
    return true;
  }

  const trimmedCmd = command.trim();
  const trimmedPat = pattern.trim();

  // Direct prefix/glob match
  const regex = globToRegex(trimmedPat, false);
  if (regex.test(trimmedCmd)) {
    return true;
  }

  // Handle prefix commands like "git *" matching "git status", "git diff"
  if (trimmedPat.endsWith('*')) {
    const prefix = trimmedPat.slice(0, -1).trim();
    if (trimmedCmd === prefix || trimmedCmd.startsWith(prefix + ' ')) {
      return true;
    }
  }

  return false;
}

function matchNetworkTarget(target: string, pattern: string): boolean {
  if (pattern === '*' || pattern === '**') {
    return true;
  }

  // Target can be a hostname ("api.github.com") or URL ("https://api.github.com/repos")
  let host = target;
  try {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      host = new URL(target).hostname;
    }
  } catch {
    // Treat as raw host
  }

  const regex = globToRegex(pattern, false);
  return regex.test(host) || regex.test(target);
}

function matchMcpTarget(target: string, pattern: string): boolean {
  if (pattern === '*' || pattern === '**') {
    return true;
  }

  // MCP target is usually serverName:toolName, e.g. "github:create_issue"
  const regex = globToRegex(pattern, false);
  return regex.test(target);
}
