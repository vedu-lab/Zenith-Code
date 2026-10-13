import path from 'node:path';

export class FileReadTracker {
  private readonly readPaths = new Set<string>();

  private normalize(filePath: string): string {
    const crossPlatform = filePath.replace(/\\/g, path.sep);
    return path.normalize(path.resolve(crossPlatform));
  }

  markRead(filePath: string): void {
    this.readPaths.add(this.normalize(filePath));
  }

  hasBeenRead(filePath: string): boolean {
    return this.readPaths.has(this.normalize(filePath));
  }

  clear(): void {
    this.readPaths.clear();
  }
}
