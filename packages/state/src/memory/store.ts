import fs from 'node:fs';
import path from 'node:path';
import { IClock, IEventBus } from '@forge/core';
import {
  MemoryEntry,
  MemorySearchOptions,
  MemorySource,
  MemoryScope,
  ProposedMemory,
} from './types.js';
import { MemoryScanner } from './scanner.js';
import { ISqliteDatabase, SqliteStore } from '../db/index.js';

export interface ProjectMemoryStoreOptions {
  readonly workspaceRoot?: string | undefined;
  readonly memoryDir?: string | undefined;
  readonly sqliteStore?: SqliteStore | undefined;
  readonly autoApprove?: boolean | undefined;
}

export class ProjectMemoryStore {
  private readonly memoryDir: string;
  private readonly scanner: MemoryScanner;
  private readonly pendingProposals = new Map<string, ProposedMemory>();
  private readonly inMemoryIndex = new Map<string, MemoryEntry>();
  private readonly db?: ISqliteDatabase | undefined;
  private readonly autoApprove: boolean;

  constructor(
    private readonly clock: IClock,
    optionsOrEventBus: ProjectMemoryStoreOptions | IEventBus = {},
    optionsParam?: ProjectMemoryStoreOptions,
  ) {
    const options: ProjectMemoryStoreOptions =
      typeof (optionsOrEventBus as IEventBus).publish === 'function'
        ? (optionsParam ?? {})
        : (optionsOrEventBus as ProjectMemoryStoreOptions);

    const root = options.workspaceRoot ?? process.cwd();
    this.memoryDir = options.memoryDir ?? path.join(root, '.forge', 'memory');
    this.scanner = new MemoryScanner();
    this.db = options.sqliteStore?.raw;
    this.autoApprove = options.autoApprove ?? false;

    if (!fs.existsSync(this.memoryDir)) {
      try {
        fs.mkdirSync(this.memoryDir, { recursive: true });
      } catch {
        // Ignore
      }
    }

    this.initDb();
    this.loadFromDisk();
  }

  private initDb(): void {
    if (!this.db) return;
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS project_memories (
          id TEXT PRIMARY KEY,
          statement TEXT NOT NULL,
          source TEXT NOT NULL,
          evidence TEXT NOT NULL,
          confidence REAL NOT NULL,
          scope TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          expires_at INTEGER
        );
      `);
    } catch {
      // Ignore
    }
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.memoryDir)) return;
    try {
      const files = fs.readdirSync(this.memoryDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const fullPath = path.join(this.memoryDir, file);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const entry = this.parseMarkdownMemory(content);
          if (entry) {
            this.inMemoryIndex.set(entry.id, entry);
          }
        } catch {
          // Ignore unparseable
        }
      }
    } catch {
      // Ignore
    }
  }

  private parseMarkdownMemory(content: string): MemoryEntry | null {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) return null;

    const yaml = frontmatterMatch[1]!;
    const body = frontmatterMatch[2]!.trim();

    const getField = (key: string): string => {
      const m = yaml.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
      return m ? m[1]!.trim().replace(/^['"](.*)['"]$/, '$1') : '';
    };

    const id = getField('id');
    const source = (getField('source') || 'inferred') as MemorySource;
    const confidence = parseFloat(getField('confidence')) || 0.9;
    const scope = (getField('scope') || 'project') as MemoryScope;
    const status = (getField('status') || 'active') as 'active' | 'stale' | 'deleted';
    const createdAt = parseInt(getField('created_at'), 10) || Date.now();
    const updatedAt = parseInt(getField('updated_at'), 10) || Date.now();
    const expiresAtRaw = getField('expires_at');
    const expiresAt = expiresAtRaw ? parseInt(expiresAtRaw, 10) : undefined;

    // Body contains Statement and Evidence
    const statementMatch = body.match(/## Statement\n([\s\S]*?)(?=\n## Evidence|$)/);
    const evidenceMatch = body.match(/## Evidence\n([\s\S]*)$/);

    const statement = statementMatch ? statementMatch[1]!.trim() : body;
    const evidence = evidenceMatch ? evidenceMatch[1]!.trim() : '';

    if (!id) return null;

    return {
      id,
      statement,
      source,
      evidence,
      confidence,
      scope,
      status,
      createdAt,
      updatedAt,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
  }

  private serializeMarkdown(entry: MemoryEntry): string {
    return `---
id: "${entry.id}"
source: "${entry.source}"
confidence: ${entry.confidence}
scope: "${entry.scope}"
status: "${entry.status}"
created_at: ${entry.createdAt}
updated_at: ${entry.updatedAt}
${entry.expiresAt ? `expires_at: ${entry.expiresAt}\n` : ''}---

## Statement
${entry.statement}

## Evidence
${entry.evidence}
`;
  }

  /**
   * Proposes a new memory. By default, agent proposes memories and writes need approval.
   */
  async propose(params: {
    statement: string;
    source: MemorySource;
    evidence: string;
    confidence?: number | undefined;
    scope?: MemoryScope | undefined;
    expiresAt?: number | undefined;
  }): Promise<ProposedMemory> {
    const id = `prop-${this.clock.nowMs()}-${Math.random().toString(36).slice(2, 7)}`;
    const proposal: ProposedMemory = {
      id,
      statement: params.statement,
      source: params.source,
      evidence: params.evidence,
      confidence: params.confidence ?? 0.9,
      scope: params.scope ?? 'project',
      expiresAt: params.expiresAt,
      proposedAt: this.clock.nowMs(),
    };

    if (this.autoApprove) {
      await this.saveMemory({
        statement: proposal.statement,
        source: proposal.source,
        evidence: proposal.evidence,
        confidence: proposal.confidence,
        scope: proposal.scope,
        expiresAt: proposal.expiresAt,
      });
      return proposal;
    }

    this.pendingProposals.set(id, proposal);
    return proposal;
  }

  getPendingProposals(): readonly ProposedMemory[] {
    return Array.from(this.pendingProposals.values());
  }

  /**
   * Approves and writes a proposed memory. Runs Secret & PII scanner before writing.
   */
  async approve(proposalId: string): Promise<MemoryEntry> {
    const proposal = this.pendingProposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposed memory not found: ${proposalId}`);
    }

    const entry = await this.saveMemory({
      statement: proposal.statement,
      source: proposal.source,
      evidence: proposal.evidence,
      confidence: proposal.confidence,
      scope: proposal.scope,
      expiresAt: proposal.expiresAt,
    });

    this.pendingProposals.delete(proposalId);
    return entry;
  }

  /**
   * Directly creates and writes a memory, enforcing Secret & PII scanning.
   */
  async saveMemory(params: {
    statement: string;
    source: MemorySource;
    evidence: string;
    confidence?: number | undefined;
    scope?: MemoryScope | undefined;
    expiresAt?: number | undefined;
  }): Promise<MemoryEntry> {
    // 1. Secret & PII scanner check on every write
    const fullText = `${params.statement}\n${params.evidence}`;
    const scan = this.scanner.scan(fullText);
    if (scan.hasSensitiveData) {
      const details = scan.findings.map((f) => `${f.type}: ${f.name}`).join(', ');
      throw new Error(`Memory write rejected: sensitive data / PII detected (${details})`);
    }

    const now = this.clock.nowMs();
    const id = `mem-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const fileName = `${id}.md`;
    const filePath = path.join(this.memoryDir, fileName);

    const entry: MemoryEntry = {
      id,
      statement: params.statement,
      source: params.source,
      evidence: params.evidence,
      confidence: params.confidence ?? 0.9,
      scope: params.scope ?? 'project',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...(params.expiresAt !== undefined ? { expiresAt: params.expiresAt } : {}),
    };

    // 2. Write readable Markdown file to .forge/memory/*.md
    fs.writeFileSync(filePath, this.serializeMarkdown(entry), 'utf8');

    // 3. Update in-memory index
    this.inMemoryIndex.set(id, entry);

    // 4. Update SQLite index
    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO project_memories
          (id, statement, source, evidence, confidence, scope, status, created_at, updated_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `);
        stmt.run(
          entry.id,
          entry.statement,
          entry.source,
          entry.evidence,
          entry.confidence,
          entry.scope,
          entry.status,
          entry.createdAt,
          entry.updatedAt,
          entry.expiresAt ?? null,
        );
      } catch {
        // Fallback
      }
    }

    return entry;
  }

  async markStale(id: string, reason?: string): Promise<MemoryEntry> {
    const existing = this.inMemoryIndex.get(id);
    if (!existing) {
      throw new Error(`Memory not found: ${id}`);
    }

    const updated: MemoryEntry = {
      ...existing,
      status: 'stale',
      updatedAt: this.clock.nowMs(),
      evidence: reason ? `${existing.evidence} (Stale: ${reason})` : existing.evidence,
    };

    const filePath = path.join(this.memoryDir, `${id}.md`);
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, this.serializeMarkdown(updated), 'utf8');
    }

    this.inMemoryIndex.set(id, updated);

    if (this.db) {
      try {
        this.db
          .prepare('UPDATE project_memories SET status = ?, updated_at = ? WHERE id = ?')
          .run('stale', updated.updatedAt, id);
      } catch {
        // Fallback
      }
    }

    return updated;
  }

  search(options: MemorySearchOptions = {}): readonly MemoryEntry[] {
    const now = this.clock.nowMs();
    let entries = Array.from(this.inMemoryIndex.values());

    // Filter expired
    entries = entries.filter((e) => !e.expiresAt || e.expiresAt > now);

    if (options.status) {
      entries = entries.filter((e) => e.status === options.status);
    } else {
      // Default to active
      entries = entries.filter((e) => e.status === 'active');
    }

    if (options.scope) {
      entries = entries.filter((e) => e.scope === options.scope);
    }

    if (options.minConfidence !== undefined) {
      entries = entries.filter((e) => e.confidence >= options.minConfidence!);
    }

    if (options.query) {
      const q = options.query.toLowerCase();
      entries = entries.filter(
        (e) => e.statement.toLowerCase().includes(q) || e.evidence.toLowerCase().includes(q),
      );
    }

    if (options.limit !== undefined) {
      entries = entries.slice(0, options.limit);
    }

    return entries;
  }

  async edit(
    id: string,
    updates: Partial<Pick<MemoryEntry, 'statement' | 'confidence' | 'scope' | 'evidence'>>,
  ): Promise<MemoryEntry> {
    const existing = this.inMemoryIndex.get(id);
    if (!existing) {
      throw new Error(`Memory not found: ${id}`);
    }

    const updatedText = `${updates.statement ?? existing.statement}\n${updates.evidence ?? existing.evidence}`;
    const scan = this.scanner.scan(updatedText);
    if (scan.hasSensitiveData) {
      throw new Error('Edit rejected: sensitive data detected');
    }

    const updated: MemoryEntry = {
      ...existing,
      ...updates,
      updatedAt: this.clock.nowMs(),
    };

    const filePath = path.join(this.memoryDir, `${id}.md`);
    fs.writeFileSync(filePath, this.serializeMarkdown(updated), 'utf8');
    this.inMemoryIndex.set(id, updated);

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const existing = this.inMemoryIndex.get(id);
    if (!existing) return false;

    // Real delete from disk
    const filePath = path.join(this.memoryDir, `${id}.md`);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore
    }

    // Real delete from SQLite
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM project_memories WHERE id = ?').run(id);
      } catch {
        // Fallback
      }
    }

    this.inMemoryIndex.delete(id);
    return true;
  }

  export(format: 'markdown' | 'json' = 'json'): string {
    const active = this.search();
    if (format === 'json') {
      return JSON.stringify(active, null, 2);
    }

    return active
      .map(
        (e) =>
          `### [${e.scope.toUpperCase()}] ${e.statement}\n- **Source**: ${e.source} (confidence: ${e.confidence})\n- **Evidence**: ${e.evidence}\n`,
      )
      .join('\n');
  }
}
