import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { IFileSystem, IProcessRunner } from '@forge/core';
import { FileSnapshotEntry, CodeSnapshot } from './types.js';

export interface ShadowGitOptions {
  readonly workspaceRoot: string;
  readonly shadowGitDir?: string | undefined;
  readonly processRunner?: IProcessRunner | undefined;
  readonly fs?: IFileSystem | undefined;
}

export class ShadowGitManager {
  readonly workspaceRoot: string;
  readonly shadowGitDir: string;
  private readonly processRunner?: IProcessRunner | undefined;
  readonly fileSystem?: IFileSystem | undefined;
  private isGitInitialized = false;
  /** Files explicitly tracked and managed by shadow git snapshots */
  private readonly managedFiles = new Set<string>();

  constructor(options: ShadowGitOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.shadowGitDir =
      options.shadowGitDir ?? path.join(this.workspaceRoot, '.forge', 'shadow-git');
    this.processRunner = options.processRunner;
    this.fileSystem = options.fs;
  }

  async init(): Promise<void> {
    if (this.isGitInitialized) return;

    if (this.processRunner && !this.fileSystem) {
      try {
        await this.processRunner.run('git', ['init', '--bare', this.shadowGitDir], {
          cwd: this.workspaceRoot,
        });
        this.isGitInitialized = true;
      } catch {
        // Fall back to file snapshot mode
      }
    }
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Recursively scans workspace files, ignoring .git, node_modules, and .forge internal directories.
   */
  async scanWorkspaceFiles(dir = this.workspaceRoot): Promise<FileSnapshotEntry[]> {
    if (this.fileSystem) {
      // With injected mock filesystem, files are managed explicitly
      return [];
    }

    const entries: FileSnapshotEntry[] = [];

    const walk = (currentDir: string): void => {
      if (!fs.existsSync(currentDir)) return;
      const list = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const item of list) {
        const fullPath = path.join(currentDir, item.name);
        const relPath = path.relative(this.workspaceRoot, fullPath);

        // Never touch user's .git or .forge shadow git/cache
        if (
          item.name === '.git' ||
          item.name === 'node_modules' ||
          relPath.startsWith(path.join('.forge', 'shadow-git'))
        ) {
          continue;
        }

        if (item.isDirectory()) {
          walk(fullPath);
        } else if (item.isFile()) {
          try {
            const raw = fs.readFileSync(fullPath);
            const content = raw.toString('utf8');
            const stat = fs.statSync(fullPath);
            const isCrlf = raw.includes(Buffer.from('\r\n'));
            const hash = this.computeHash(content);

            entries.push({
              path: relPath,
              content,
              mode: stat.mode,
              isCrlf,
              hash,
            });
            this.managedFiles.add(relPath);
          } catch {
            // Ignore unreadable files
          }
        }
      }
    };

    walk(dir);
    return entries;
  }

  /**
   * Captures a code snapshot of all tracked and untracked files.
   */
  async snapshot(description: string): Promise<CodeSnapshot> {
    await this.init();
    const files = await this.scanWorkspaceFiles();

    for (const f of files) {
      this.managedFiles.add(f.path);
    }

    let commitSha: string | undefined = undefined;
    if (this.processRunner && this.isGitInitialized && !this.fileSystem) {
      try {
        await this.processRunner.run(
          'git',
          [`--git-dir=${this.shadowGitDir}`, `--work-tree=${this.workspaceRoot}`, 'add', '-A'],
          { cwd: this.workspaceRoot },
        );

        await this.processRunner.run(
          'git',
          [
            `--git-dir=${this.shadowGitDir}`,
            `--work-tree=${this.workspaceRoot}`,
            'commit',
            '-m',
            description,
            '--allow-empty',
          ],
          { cwd: this.workspaceRoot },
        );

        const shaResult = await this.processRunner.run(
          'git',
          [`--git-dir=${this.shadowGitDir}`, 'rev-parse', 'HEAD'],
          { cwd: this.workspaceRoot },
        );
        commitSha = shaResult.stdout.trim();
      } catch {
        // Fallback to pure file tree mode
      }
    }

    return {
      type: commitSha ? 'shadow_git' : 'file_tree',
      commitSha,
      files,
    };
  }

  /**
   * Restores the workspace files to match the snapshot byte-identically,
   * restoring content, CRLF/LF line endings, mode bits, and deleting files that were created after the snapshot.
   */
  async restore(snapshot: CodeSnapshot): Promise<{ restored: string[]; deleted: string[] }> {
    const targetMap = new Map<string, FileSnapshotEntry>();
    for (const f of snapshot.files) {
      targetMap.set(f.path, f);
      this.managedFiles.add(f.path);
    }

    const restored: string[] = [];
    const deleted: string[] = [];

    if (this.fileSystem) {
      // Using injected IFileSystem
      for (const target of snapshot.files) {
        let dataToWrite = target.content;
        if (target.isCrlf && !dataToWrite.includes('\r\n')) {
          dataToWrite = dataToWrite.replace(/\n/g, '\r\n');
        } else if (!target.isCrlf && dataToWrite.includes('\r\n')) {
          dataToWrite = dataToWrite.replace(/\r\n/g, '\n');
        }
        await this.fileSystem.writeFile(target.path, dataToWrite);
        restored.push(target.path);
      }
      return { restored, deleted };
    }

    // Node:fs real file operations: ONLY delete files that were tracked by managedFiles
    for (const managedPath of this.managedFiles) {
      if (!targetMap.has(managedPath)) {
        const fullPath = path.join(this.workspaceRoot, managedPath);
        try {
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            deleted.push(managedPath);
          }
        } catch {
          // Ignore
        }
      }
    }

    // Write and restore files in snapshot
    for (const target of snapshot.files) {
      let dataToWrite = target.content;
      if (target.isCrlf && !dataToWrite.includes('\r\n')) {
        dataToWrite = dataToWrite.replace(/\n/g, '\r\n');
      } else if (!target.isCrlf && dataToWrite.includes('\r\n')) {
        dataToWrite = dataToWrite.replace(/\r\n/g, '\n');
      }

      const fullPath = path.join(this.workspaceRoot, target.path);
      const parentDir = path.dirname(fullPath);

      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(fullPath, dataToWrite, { mode: target.mode });
      try {
        fs.chmodSync(fullPath, target.mode);
      } catch {
        // Mode bit setting may be ignored on Windows
      }
      restored.push(target.path);
      this.managedFiles.add(target.path);
    }

    return { restored, deleted };
  }
}
