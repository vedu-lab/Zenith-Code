import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { ISandboxBackend, SandboxProfile, SandboxBackendType } from '../types.js';
import { scrubEnvironment } from '../scrub.js';

export class HostIsolationBackend implements ISandboxBackend {
  readonly name: SandboxBackendType = 'host_isolated';
  readonly isAvailable = true;

  validateTarget(
    targetPath: string,
    profile: SandboxProfile,
  ): { allowed: boolean; reason?: string } {
    // 1. Path traversal escape check ('..' component)
    if (targetPath.split(/[/\\]/).includes('..')) {
      return {
        allowed: false,
        reason: `Path traversal escape attempt detected using '..' in '${targetPath}'`,
      };
    }

    // 2. Sensitive paths check (~/.ssh, ~/.aws, browser profiles, .git/hooks, .git/config, .env)
    const homeDir = os.homedir();
    const resolvedPath = path.resolve(profile.workspaceRoot, targetPath);

    const sensitiveList = [
      path.join(homeDir, '.ssh'),
      path.join(homeDir, '.aws'),
      path.join(homeDir, '.gnupg'),
      path.join(homeDir, '.config', 'gcloud'),
      path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome'),
      path.join(homeDir, '.mozilla', 'firefox'),
      path.join(homeDir, 'AppData', 'Local', 'Google', 'Chrome'),
    ];

    for (const sens of sensitiveList) {
      if (resolvedPath.toLowerCase().startsWith(sens.toLowerCase())) {
        return {
          allowed: false,
          reason: `Access to sensitive path '${sens}' is forbidden by sandbox profile`,
        };
      }
    }

    // Protect .git/hooks, .git/config, and .git directory tampering
    const lower = resolvedPath.toLowerCase();
    if (lower.includes(path.join('.git', 'hooks').toLowerCase())) {
      return {
        allowed: false,
        reason: 'Tampering with git hooks is strictly forbidden to prevent code execution escapes',
      };
    }
    if (lower.endsWith(path.join('.git', 'config').toLowerCase())) {
      return {
        allowed: false,
        reason: 'Tampering with git config is strictly forbidden to prevent code execution escapes',
      };
    }
    if (path.basename(resolvedPath).startsWith('.env')) {
      return {
        allowed: false,
        reason: 'Access to .env credentials is forbidden by sandbox profile',
      };
    }
    // Protect agent's own config and sandbox profile from tampering
    if (
      lower.includes(path.join('.forge', 'config').toLowerCase()) ||
      lower.includes(path.join('.forge', 'settings').toLowerCase()) ||
      lower.includes(path.join('.forge', 'sandbox').toLowerCase())
    ) {
      return {
        allowed: false,
        reason: 'Tampering with the agent config or sandbox profile is strictly forbidden',
      };
    }

    // 3. Symlink escape check: ensure symlinks cannot point outside workspace
    try {
      if (fs.existsSync(resolvedPath)) {
        const lstat = fs.lstatSync(resolvedPath);
        if (lstat.isSymbolicLink()) {
          const realTarget = fs.realpathSync(resolvedPath);
          const isInsideAllowed = profile.writePaths.some((wp) => {
            const rel = path.relative(wp, realTarget);
            return !rel.startsWith('..') && !path.isAbsolute(rel);
          });
          if (!isInsideAllowed) {
            return {
              allowed: false,
              reason: `Symlink escape detected: '${targetPath}' points outside allowed root to '${realTarget}'`,
            };
          }
        }
      }
    } catch {
      // Ignore stat error on non-existent paths
    }

    // 4. Write boundary check
    const isInsideWriteRoot = profile.writePaths.some((allowedRoot) => {
      const rel = path.relative(allowedRoot, resolvedPath);
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    });

    if (!isInsideWriteRoot) {
      return {
        allowed: false,
        reason: `Target path '${targetPath}' is outside the designated write sandbox (allowed: ${profile.writePaths.join(', ')})`,
      };
    }

    return { allowed: true };
  }

  wrapCommand(
    command: string,
    args: readonly string[],
    _profile: SandboxProfile,
  ): { command: string; args: readonly string[]; env: Record<string, string> } {
    const { env } = scrubEnvironment(process.env);
    return { command, args, env };
  }
}
