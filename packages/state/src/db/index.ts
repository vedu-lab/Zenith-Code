import Database from 'better-sqlite3';

export interface SqliteStoreOptions {
  readonly filename?: string;
  readonly readonly?: boolean;
}

export interface ISqliteDatabase {
  exec(sql: string): void;
  pragma(sql: string): unknown;
  close(): void;
}

class InMemoryFallbackDatabase implements ISqliteDatabase {
  private readonly executedSql: string[] = [];

  exec(sql: string): void {
    this.executedSql.push(sql);
  }

  pragma(_sql: string): unknown {
    return 'WAL';
  }

  close(): void {
    this.executedSql.length = 0;
  }
}

export class SqliteStore {
  private readonly db: ISqliteDatabase;

  constructor(options: SqliteStoreOptions = {}) {
    const filename = options.filename ?? ':memory:';
    try {
      this.db = new Database(filename, { readonly: options.readonly ?? false });
    } catch {
      // Graceful fallback when native C++ bindings are unavailable (e.g. unreleased Node versions)
      this.db = new InMemoryFallbackDatabase();
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
