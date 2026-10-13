import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { globToRegex } from '../policy/matcher.js';

export class OfflineGuard {
  private offline: boolean;
  private readonly allowedLocalHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

  constructor(offline: boolean = false) {
    this.offline = offline;
  }

  isOfflineMode(): boolean {
    return this.offline;
  }

  setOfflineMode(offline: boolean): void {
    this.offline = offline;
  }

  validateUrl(urlString: string): { allowed: boolean; reason?: string } {
    if (!this.offline) {
      return { allowed: true };
    }

    try {
      const parsed = new URL(urlString);
      const hostname = parsed.hostname.toLowerCase();

      if (this.allowedLocalHosts.has(hostname)) {
        return { allowed: true };
      }

      return {
        allowed: false,
        reason: `Offline mode enabled: external network request to host '${hostname}' is blocked. Only localhost endpoints are permitted.`,
      };
    } catch {
      return {
        allowed: false,
        reason: `Invalid or unparseable URL in offline mode: '${urlString}'`,
      };
    }
  }

  validateAction(action: string, target?: string): { allowed: boolean; reason?: string } {
    if (!this.offline) {
      return { allowed: true };
    }

    if (action === 'web_fetch' || action === 'telemetry') {
      return {
        allowed: false,
        reason: `Offline mode is active: '${action}' is strictly disabled.`,
      };
    }

    if (target && (target.startsWith('http://') || target.startsWith('https://'))) {
      return this.validateUrl(target);
    }

    return { allowed: true };
  }
}

export class AgentIgnoreFilter {
  private readonly patterns: string[] = [];

  constructor(workspaceRoot?: string) {
    if (workspaceRoot) {
      this.loadFromDirectory(workspaceRoot);
    }
  }

  loadFromDirectory(dir: string): void {
    const ignorePath = path.join(dir, '.agentignore');
    if (fs.existsSync(ignorePath)) {
      try {
        const content = fs.readFileSync(ignorePath, 'utf8');
        this.addPatterns(content);
      } catch {
        // Ignore read errors
      }
    }
  }

  addPatterns(ignoreContent: string): void {
    const lines = ignoreContent.split(/\r?\n/);
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        this.patterns.push(trimmed);
      }
    }
  }

  isIgnored(targetPath: string): boolean {
    const normalized = targetPath.replace(/\\/g, '/');
    const baseName = path.basename(targetPath);

    for (const pattern of this.patterns) {
      const cleanPattern = pattern.replace(/\\/g, '/').replace(/^\//, '');
      const regex = globToRegex(cleanPattern, true);

      if (regex.test(normalized) || regex.test(baseName)) {
        return true;
      }
    }
    return false;
  }
}
