import fs from 'node:fs/promises';
import path from 'node:path';
import { IFileSystem, FileStatResult } from '@forge/core';

export class NodeFileSystem implements IFileSystem {
  async readFile(filePath: string): Promise<string> {
    const resolved = path.resolve(filePath);
    return fs.readFile(resolved, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const resolved = path.resolve(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      const resolved = path.resolve(filePath);
      await fs.access(resolved);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(dirPath: string): Promise<void> {
    const resolved = path.resolve(dirPath);
    await fs.mkdir(resolved, { recursive: true });
  }

  async readDir(dirPath: string): Promise<readonly string[]> {
    const resolved = path.resolve(dirPath);
    return fs.readdir(resolved);
  }

  async stat(filePath: string): Promise<FileStatResult> {
    const resolved = path.resolve(filePath);
    const s = await fs.stat(resolved);
    return {
      size: s.size,
      isDirectory: s.isDirectory(),
      mtimeMs: s.mtimeMs,
    };
  }

  preserveLineEndings(originalContent: string, newContent: string): string {
    const isCrlf = originalContent.includes('\r\n');
    const normalizedNew = newContent.replace(/\r\n/g, '\n');
    return isCrlf ? normalizedNew.replace(/\n/g, '\r\n') : normalizedNew;
  }

  async unlink(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    await fs.unlink(resolved);
  }

  async rmdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const resolved = path.resolve(dirPath);
    await fs.rm(resolved, { recursive: options?.recursive ?? true, force: true });
  }

  async copyFile(sourcePath: string, destinationPath: string): Promise<void> {
    const srcResolved = path.resolve(sourcePath);
    const dstResolved = path.resolve(destinationPath);
    await fs.mkdir(path.dirname(dstResolved), { recursive: true });
    await fs.copyFile(srcResolved, dstResolved);
  }
}
