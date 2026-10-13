import fs from 'node:fs/promises';
import path from 'node:path';
import { IFileSystem } from '@forge/core';

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

  preserveLineEndings(originalContent: string, newContent: string): string {
    const isCrlf = originalContent.includes('\r\n');
    const normalizedNew = newContent.replace(/\r\n/g, '\n');
    return isCrlf ? normalizedNew.replace(/\n/g, '\r\n') : normalizedNew;
  }
}
