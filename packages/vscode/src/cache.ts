export interface CacheEntry {
  readonly text: string;
  readonly createdAtMs: number;
}

export class CompletionCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly maxCapacity: number = 500,
    private readonly ttlMs: number = 60_000,
  ) {}

  private makeKey(filePath: string, prefix: string, suffix: string, model: string): string {
    // Take prefix tail and suffix head to identify immediate cursor neighborhood
    const pTail = prefix.slice(-120);
    const sHead = suffix.slice(0, 60);
    return `${filePath}:${model}:${pTail}:::${sHead}`;
  }

  get(filePath: string, prefix: string, suffix: string, model: string): string | null {
    const key = this.makeKey(filePath, prefix, suffix, model);
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (Date.now() - entry.createdAtMs > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }

    // Refresh LRU order
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.text;
  }

  set(filePath: string, prefix: string, suffix: string, model: string, text: string): void {
    const key = this.makeKey(filePath, prefix, suffix, model);
    if (this.entries.size >= this.maxCapacity) {
      // Evict oldest entry
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) {
        this.entries.delete(firstKey);
      }
    }
    this.entries.set(key, { text, createdAtMs: Date.now() });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
