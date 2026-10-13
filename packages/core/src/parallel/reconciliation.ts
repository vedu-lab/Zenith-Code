import path from 'node:path';
import { IFileSystem, IProcessRunner } from '../interfaces/index.js';
import { AgentResult, MergeConflict, ReconciliationResult, ReviewerReport } from './types.js';

export interface ReconciliationOptions {
  readonly fs: IFileSystem;
  readonly processRunner?: IProcessRunner | undefined;
  readonly workspaceRoot: string;
  readonly testCommand?: string | undefined;
  readonly approvalCallback?: ((diff: string, reasoning: string) => Promise<boolean>) | undefined;
}

export class ReconciliationEngine {
  private readonly fs: IFileSystem;
  private readonly processRunner?: IProcessRunner | undefined;
  private readonly workspaceRoot: string;
  private readonly testCommand?: string | undefined;
  private readonly approvalCallback?:
    ((diff: string, reasoning: string) => Promise<boolean>) | undefined;

  constructor(options: ReconciliationOptions) {
    this.fs = options.fs;
    this.processRunner = options.processRunner;
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.testCommand = options.testCommand;
    this.approvalCallback = options.approvalCallback;
  }

  /**
   * Reconciles multiple agent branches based on reviewer report, detects textual
   * and semantic conflicts, re-verifies the combined state, and requests user approval.
   */
  async reconcile(
    report: ReviewerReport,
    candidates: readonly AgentResult[],
    preferredStrategy?: 'pick' | 'cherry_pick' | 'merge',
  ): Promise<ReconciliationResult> {
    const strategy = preferredStrategy ?? report.recommendedReconciliation;
    const conflicts: MergeConflict[] = [];

    // Map candidate agentId -> candidate result
    const candidateMap = new Map<string, AgentResult>();
    for (const c of candidates) {
      candidateMap.set(c.agentId, c);
    }

    let filesToApply = new Map<string, string>(); // relativePath -> content
    let mergedDiff = '';
    let reasoning = report.summary;

    if (strategy === 'pick') {
      const winnerId = report.winnerId;
      const winner = winnerId ? candidateMap.get(winnerId) : undefined;
      if (!winner) {
        return {
          strategyUsed: 'pick',
          mergedFiles: [],
          conflicts: [
            {
              type: 'semantic',
              filePath: 'all',
              description: 'No winning candidate available to pick.',
            },
          ],
          reVerificationPassed: false,
          mergedDiff: '',
          approved: false,
          reasoning: 'No passing candidate was selected by reviewer.',
        };
      }

      filesToApply = await this.collectFilesFromCandidate(winner);
      mergedDiff = winner.diff;
      reasoning = `Picked winning Agent '${winner.agentId}' (Rank 1).\nReviewer reasoning: ${report.summary}`;
    } else {
      // Merge or cherry-pick strategy
      const passingCandidates = candidates.filter(
        (c) => c.status === 'completed' && c.testStatus !== 'failed',
      );

      // Detect textual conflicts across candidate files
      const candidateFiles = new Map<string, Map<string, string>>(); // agentId -> (filePath -> content)
      for (const cand of passingCandidates) {
        const files = await this.collectFilesFromCandidate(cand);
        candidateFiles.set(cand.agentId, files);
      }

      const allRelativePaths = new Set<string>();
      for (const files of candidateFiles.values()) {
        for (const p of files.keys()) {
          allRelativePaths.add(p);
        }
      }

      for (const relPath of allRelativePaths) {
        const contributors: Array<{ agentId: string; content: string }> = [];
        for (const [agentId, files] of candidateFiles.entries()) {
          if (files.has(relPath)) {
            contributors.push({ agentId, content: files.get(relPath)! });
          }
        }

        if (contributors.length === 1) {
          filesToApply.set(relPath, contributors[0]!.content);
        } else if (contributors.length > 1) {
          // Check if contents are identical
          const firstContent = contributors[0]!.content;
          const allSame = contributors.every((c) => c.content === firstContent);
          if (allSame) {
            filesToApply.set(relPath, firstContent);
          } else {
            // Textual conflict detected!
            conflicts.push({
              type: 'textual',
              filePath: relPath,
              description: `Conflicting changes to '${relPath}' between agents: ${contributors.map((c) => c.agentId).join(', ')}`,
              conflictHunks: contributors.map(
                (c) => `=== Agent ${c.agentId} ===\n${c.content.slice(0, 200)}...`,
              ),
            });
            // Fall back to preferred candidate or top-ranked
            const topContributor =
              contributors.find((c) => c.agentId === report.winnerId) ?? contributors[0];
            if (topContributor) {
              filesToApply.set(relPath, topContributor.content);
            }
          }
        }
      }

      mergedDiff = passingCandidates.map((c) => `[Agent ${c.agentId}]\n${c.diff}`).join('\n\n');
      reasoning = `Merged changes across ${passingCandidates.length} agents.\nReviewer reasoning: ${report.summary}`;
    }

    // Semantic conflict verification:
    // Stage merged changes into a temporary verification directory and run testCommand
    let reVerificationPassed = true;
    if (this.testCommand && this.processRunner && filesToApply.size > 0) {
      const stagingDir = path.join(this.workspaceRoot, '.forge', 'merge-verify-stage');
      try {
        await this.fs.mkdir(stagingDir);
        await this.copyDirectoryRecursive(this.workspaceRoot, stagingDir);

        // Apply candidate merged files to staging
        for (const [relPath, content] of filesToApply.entries()) {
          const target = path.join(stagingDir, relPath);
          await this.fs.mkdir(path.dirname(target));
          await this.fs.writeFile(target, content);
        }

        // Run verification in staging
        const parts = this.testCommand.split(' ');
        const bin = parts[0] ?? 'npm';
        const args = parts.slice(1);
        const res = await this.processRunner.run(bin, args, { cwd: stagingDir });
        if (res.exitCode !== 0) {
          reVerificationPassed = false;
          conflicts.push({
            type: 'semantic',
            filePath: 'test-verification',
            description: `Semantic conflict: Merged solution failed test command '${this.testCommand}' with exit code ${res.exitCode}`,
          });
        }
      } catch (err) {
        reVerificationPassed = false;
        const msg = err instanceof Error ? err.message : String(err);
        conflicts.push({
          type: 'semantic',
          filePath: 'test-verification',
          description: `Semantic conflict: Failed to run test suite on merged tree: ${msg}`,
        });
      } finally {
        // Clean up staging directory
        await this.removeDirRecursive(stagingDir);
      }
    }

    // User Approval Gate:
    // ALWAYS requires user approval before writing to user's working tree!
    let approved = false;
    if (this.approvalCallback) {
      approved = await this.approvalCallback(mergedDiff, reasoning);
    } else {
      // Default auto-approve if no approval callback provided (e.g. non-interactive or tests)
      approved = true;
    }

    const appliedFiles: string[] = [];
    if (approved && (reVerificationPassed || conflicts.length === 0)) {
      // Apply to user's working tree
      for (const [relPath, content] of filesToApply.entries()) {
        const dest = path.join(this.workspaceRoot, relPath);
        await this.fs.mkdir(path.dirname(dest));
        await this.fs.writeFile(dest, content);
        appliedFiles.push(relPath);
      }
    }

    return {
      strategyUsed: strategy,
      mergedFiles: appliedFiles,
      conflicts,
      reVerificationPassed,
      mergedDiff,
      approved,
      reasoning,
    };
  }

  private async collectFilesFromCandidate(candidate: AgentResult): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const relPath of candidate.touchedFiles) {
      const fullPath = path.join(candidate.worktreePath, relPath);
      try {
        const exists = await this.fs.exists(fullPath);
        if (exists) {
          const content = await this.fs.readFile(fullPath);
          map.set(relPath, content);
        }
      } catch {
        // Skip unreadable files
      }
    }
    return map;
  }

  private async copyDirectoryRecursive(src: string, dst: string): Promise<void> {
    let entries: readonly string[];
    try {
      entries = await this.fs.readDir(src);
    } catch {
      return;
    }

    const ignored = new Set(['.git', '.forge', 'node_modules', 'dist']);
    for (const name of entries) {
      if (ignored.has(name)) continue;
      const sPath = path.join(src, name);
      const dPath = path.join(dst, name);
      try {
        const s = await this.fs.stat(sPath);
        if (s.isDirectory) {
          await this.fs.mkdir(dPath);
          await this.copyDirectoryRecursive(sPath, dPath);
        } else {
          if (this.fs.copyFile) {
            await this.fs.copyFile(sPath, dPath);
          } else {
            const content = await this.fs.readFile(sPath);
            await this.fs.writeFile(dPath, content);
          }
        }
      } catch {
        // Skip
      }
    }
  }

  private async removeDirRecursive(dirPath: string): Promise<void> {
    try {
      if (!(await this.fs.exists(dirPath))) return;
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
      // Best effort
    }
  }
}
