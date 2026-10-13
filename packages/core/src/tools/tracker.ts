import path from 'node:path';

export class FileReadTracker {
  private readonly readPaths = new Set<string>();

  markRead(filePath: string): void {
    const normalized = path.normalize(path.resolve(filePath));
    this.readPaths.add(normalized);
  }

  hasBeenRead(filePath: string): boolean {
    const normalized = path.normalize(path.resolve(filePath));
    return this.readPaths.has(normalized);
  }

  clear(): void {
    this.readPaths.clear();
  }
}
