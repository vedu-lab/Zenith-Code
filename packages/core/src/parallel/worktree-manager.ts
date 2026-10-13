import path from 'node:path';
import { IFileSystem, IProcessRunner, IClock } from '../interfaces/index.js';
import { WorktreeInfo } from './types.js';
import { CleanupRegistry } from './cleanup-registry.js';

export interface WorktreeManagerOptions {
  readonly workspaceRoot: string;
  readonly fs: IFileSystem;
  readonly processRunner?: IProcessRunner | undefined;
  readonly clock: IClock;
  readonly cleanupRegistry?: CleanupRegistry | undefined;
}

export class WorktreeManager {
  readonly workspaceRoot: string;
  private readonly fs: IFileSystem;
  private readonly processRunner?: IProcessRunner | undefined;
  private readonly clock: IClock;
  private readonly cleanupRegistry: CleanupRegistry;
  private readonly activeWorktrees = new Map<string, WorktreeInfo>();

  constructor(options: WorktreeManagerOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.fs = options.fs;
    this.processRunner = options.processRunner;
    this.clock = options.clock;
    this.cleanupRegistry = options.cleanupRegistry ?? CleanupRegistry.getInstance();
  }

  /**
   * Creates an isolated workspace for the agent.
   * Prefers `git worktree` when git is available and healthy, otherwise falls back
   * to a fully isolated sandboxed filesystem copy.
   */
  async createWorktree(agentId: string): Promise<WorktreeInfo> {
    const timestamp = this.clock.nowMs();
    const branchName = `forge-worktree-${agentId}-${timestamp}`;
    const targetPath = path.join(this.workspaceRoot, '.forge', 'worktrees', agentId);

    // Ensure parent dir exists
    await this.fs.mkdir(path.dirname(targetPath));

    // Try git worktree first if runner is available
    let createdWithGit = false;
    if (this.processRunner) {
      try {
        const checkGit = await this.processRunner.run(
          'git',
          ['rev-parse', '--is-inside-work-tree'],
          {
            cwd: this.workspaceRoot,
          },
        );

        if (checkGit.exitCode === 0 && checkGit.stdout.trim() === 'true') {
          // Clean up any stale worktree or branch with same name
          await this.processRunner.run('git', ['worktree', 'remove', '--force', targetPath], {
            cwd: this.workspaceRoot,
          });

          const addRes = await this.processRunner.run(
            'git',
            ['worktree', 'add', '-b', branchName, targetPath, 'HEAD'],
            { cwd: this.workspaceRoot },
          );

          if (addRes.exitCode === 0) {
            createdWithGit = true;
          }
        }
      } catch {
        // Fall back to sandboxed copy
        createdWithGit = false;
      }
    }

    if (!createdWithGit) {
      // Fallback: Copy files into sandboxed directory
      await this.fs.mkdir(targetPath);
      await this.copyDirectoryRecursive(this.workspaceRoot, targetPath);
      await this.fs.writeFile(path.join(targetPath, '.forge-worktree'), String(timestamp));
    }

    const info: WorktreeInfo = {
      agentId,
      path: targetPath,
      isGitWorktree: createdWithGit,
      branchName: createdWithGit ? branchName : undefined,
      createdAtMs: timestamp,
    };

    this.activeWorktrees.set(agentId, info);

    // Register with cleanup registry for guaranteed cleanup on interrupt / crash
    this.cleanupRegistry.register(`worktree-${agentId}`, async () => {
      await this.removeWorktree(agentId);
    });

    return info;
  }

  /**
   * Removes an agent's worktree and prunes associated branches.
   */
  async removeWorktree(agentId: string): Promise<void> {
    const info = this.activeWorktrees.get(agentId);
    if (!info) return;

    this.activeWorktrees.delete(agentId);
    this.cleanupRegistry.unregister(`worktree-${agentId}`);

    if (info.isGitWorktree && this.processRunner) {
      try {
        await this.processRunner.run('git', ['worktree', 'remove', '--force', info.path], {
          cwd: this.workspaceRoot,
        });
        if (info.branchName) {
          await this.processRunner.run('git', ['branch', '-D', info.branchName], {
            cwd: this.workspaceRoot,
          });
        }
      } catch {
        // Fall back to filesystem removal if git worktree command failed
        await this.removeDirRecursive(info.path);
      }
    } else {
      await this.removeDirRecursive(info.path);
    }
  }

  /**
   * Cleans up all active worktrees and branches.
   */
  async cleanupAll(): Promise<void> {
    const agentIds = Array.from(this.activeWorktrees.keys());
    for (const agentId of agentIds) {
      try {
        await this.removeWorktree(agentId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[WorktreeManager] Error cleaning up worktree ${agentId}: ${msg}\n`);
      }
    }
  }

  getWorktree(agentId: string): WorktreeInfo | undefined {
    return this.activeWorktrees.get(agentId);
  }

  getActiveWorktrees(): readonly WorktreeInfo[] {
    return Array.from(this.activeWorktrees.values());
  }

  /**
   * Verifies the user's working tree status.
   */
  async isUserTreeClean(): Promise<boolean> {
    if (!this.processRunner) return true;
    try {
      const res = await this.processRunner.run('git', ['status', '--porcelain'], {
        cwd: this.workspaceRoot,
      });
      return res.stdout.trim().length === 0;
    } catch {
      return true;
    }
  }

  /**
   * Helper to recursively copy directories while excluding VCS and internal caches.
   */
  private async copyDirectoryRecursive(src: string, dst: string): Promise<void> {
    let entries: readonly string[];
    try {
      entries = await this.fs.readDir(src);
    } catch {
      return;
    }

    const ignoredNames = new Set([
      '.git',
      '.forge',
      'node_modules',
      'dist',
      '.turbo',
      '.next',
      '.DS_Store',
    ]);

    for (const name of entries) {
      if (ignoredNames.has(name)) continue;

      const srcPath = path.join(src, name);
      const dstPath = path.join(dst, name);

      try {
        const s = await this.fs.stat(srcPath);
        if (s.isDirectory) {
          await this.fs.mkdir(dstPath);
          await this.copyDirectoryRecursive(srcPath, dstPath);
        } else {
          if (this.fs.copyFile) {
            await this.fs.copyFile(srcPath, dstPath);
          } else {
            const content = await this.fs.readFile(srcPath);
            await this.fs.writeFile(dstPath, content);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  /**
   * Helper to recursively delete directories.
   */
  private async removeDirRecursive(dirPath: string): Promise<void> {
    try {
      const exists = await this.fs.exists(dirPath);
      if (!exists) return;

      if (this.fs.rmdir) {
        await this.fs.rmdir(dirPath, { recursive: true });
        return;
      }

      const entries = await this.fs.readDir(dirPath);
      for (const name of entries) {
        const full = path.join(dirPath, name);
        const s = await this.fs.stat(full);
        if (s.isDirectory) {
          await this.removeDirRecursive(full);
        } else if (this.fs.unlink) {
          await this.fs.unlink(full);
        }
      }
    } catch {
      // Best effort cleanup
    }
  }
}
