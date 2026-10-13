import { IClock } from '@forge/core';

export interface MemoryEntry {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly category: 'project_context' | 'user_preference' | 'scratchpad';
  readonly updatedAt: number;
}

export class MemoryStore {
  private readonly memory = new Map<string, MemoryEntry>();

  constructor(private readonly clock: IClock) {}

  set(
    key: string,
    value: string,
    category: MemoryEntry['category'] = 'project_context',
  ): MemoryEntry {
    const entry: MemoryEntry = {
      id: `mem-${key}`,
      key,
      value,
      category,
      updatedAt: this.clock.nowMs(),
    };
    this.memory.set(key, entry);
    return entry;
  }

  get(key: string): MemoryEntry | undefined {
    return this.memory.get(key);
  }

  listByCategory(category: MemoryEntry['category']): readonly MemoryEntry[] {
    return Array.from(this.memory.values()).filter((e) => e.category === category);
  }

  delete(key: string): boolean {
    return this.memory.delete(key);
  }
}
