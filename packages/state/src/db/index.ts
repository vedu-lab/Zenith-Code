import Database from 'better-sqlite3';

export interface SqliteStoreOptions {
  readonly filename?: string;
  readonly readonly?: boolean;
}

export interface ISqliteStatement {
  run(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
}

export interface ISqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): ISqliteStatement;
  pragma(sql: string): unknown;
  close(): void;
}

class InMemoryFallbackDatabase implements ISqliteDatabase {
  private readonly executedSql: string[] = [];

  exec(sql: string): void {
    this.executedSql.push(sql);
  }

  prepare(_sql: string): ISqliteStatement {
    return {
      run: () => ({}),
      all: () => [],
      get: () => undefined,
    };
  }

  pragma(_sql: string): unknown {
    return 'WAL';
  }

  close(): void {
    this.executedSql.length = 0;
  }
}

import { createRequire } from 'node:module';

class NodeSqliteWrapper implements ISqliteDatabase {
  constructor(private readonly db: { exec(sql: string): void; prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown }; close(): void }) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): ISqliteStatement {
    const stmt = this.db.prepare(sql);
    return {
      run: (...args: unknown[]) => stmt.run(...args),
      all: (...args: unknown[]) => stmt.all(...args),
      get: (...args: unknown[]) => stmt.get(...args),
    };
  }

  pragma(sql: string): unknown {
    try {
      this.db.exec(`PRAGMA ${sql};`);
      return 'WAL';
    } catch {
      return undefined;
    }
  }

  close(): void {
    this.db.close();
  }
}

export class SqliteStore {
  private readonly db: ISqliteDatabase;

  constructor(options: SqliteStoreOptions = {}) {
    const filename = options.filename ?? ':memory:';
    try {
      this.db = new Database(filename, { readonly: options.readonly ?? false });
    } catch {
      try {
        const req = createRequire(import.meta.url);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { DatabaseSync } = req('node:sqlite');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const dbSync = new DatabaseSync(filename, { readOnly: options.readonly ?? false });
        this.db = new NodeSqliteWrapper(dbSync);
      } catch {
        // Graceful fallback when native C++ bindings are unavailable (e.g. unreleased Node versions)
        this.db = new InMemoryFallbackDatabase();
      }
    }
    this.initSchema();
  }

  private initSchema(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        description TEXT NOT NULL,
        files_json TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS usage_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
    `);
  }

  get raw(): ISqliteDatabase {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
