/**
 * SQLite Adapter — sql.js (WebAssembly) backend with better-sqlite3 compatible API.
 *
 * Drop-in replacement for `better-sqlite3` that runs everywhere (Node, Electron)
 * without native module compilation.
 *
 * Supported API surface:
 *   new Database(dbPath)       — open/create from file
 *   db.pragma(str)             — execute PRAGMA
 *   db.exec(str)               — execute multiple statements
 *   db.prepare(str) → Statement
 *   stmt.run(...params)
 *   stmt.get(...params)
 *   stmt.all(...params)
 *   db.transaction(fn) → fn    — returns a wrapper that runs fn inside BEGIN/COMMIT
 *   db.close()
 */

import * as path from 'path';

import fs from 'fs-extra';
import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase } from 'sql.js';

// Load the WASM file from sql.js package
const SQL_JS_WASM_PATH = require.resolve('sql.js/dist/sql-wasm.wasm');

let sqlJsReady: Promise<void> | null = null;
let SqlJsConstructor: any = null;

async function ensureSqlJs(): Promise<void> {
  if (sqlJsReady) return sqlJsReady;
  sqlJsReady = (async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => {
        // For Node.js, resolve from the installed package
        if (file.endsWith('.wasm')) {
          try {
            return require.resolve(`sql.js/dist/${file}`);
          } catch {
            return file;
          }
        }
        return file;
      },
    });
    SqlJsConstructor = SQL.Database as any;
  })();
  return sqlJsReady;
}

// ─── Statement ────────────────────────────────────────────────────────

export class Statement {
  private sql: string;
  private sqlJsDb: SqlJsDatabase;
  private ownerDb: Database;

  constructor(sqlJsDb: SqlJsDatabase, sql: string, ownerDb: Database) {
    this.sqlJsDb = sqlJsDb;
    this.sql = sql;
    this.ownerDb = ownerDb;
  }

  /**
   * Run a statement that doesn't return rows (INSERT, UPDATE, DELETE, etc.)
   */
  run(...params: unknown[]): RunResult {
    try {
      const safeParams = params.map(p => p === undefined ? null : p);
      this.sqlJsDb.run(this.sql, safeParams as any[]);
      this.ownerDb.scheduleSave();
      // sql.js doesn't give us lastInsertRowid directly in run(),
      // but we can query it
      const row = this.sqlJsDb.exec('SELECT last_insert_rowid() as id, changes() as changes');
      let lastInsertRowid = 0;
      let changes = 0;
      if (row.length > 0 && row[0].values.length > 0) {
        lastInsertRowid = row[0].values[0][0] as number;
        changes = row[0].values[0][1] as number;
      }
      return { lastInsertRowid, changes };
    } catch (err) {
      throw wrapError(err, this.sql);
    }
  }

  /**
   * Get a single row as an object, or undefined if no rows.
   */
  get<T = Record<string, unknown>>(...params: unknown[]): T | undefined {
    try {
      const safeParams = params.map(p => p === undefined ? null : p);
      const stmt = this.sqlJsDb.prepare(this.sql);
      if (safeParams.length > 0) {
        stmt.bind(safeParams as any[]);
      }
      let result: T | undefined;
      if (stmt.step()) {
        result = stmt.getAsObject() as T;
      }
      stmt.free();
      return result;
    } catch (err) {
      throw wrapError(err, this.sql);
    }
  }

  /**
   * Get all rows as objects.
   */
  all<T = Record<string, unknown>>(...params: unknown[]): T[] {
    try {
      const safeParams = params.map(p => p === undefined ? null : p);
      const stmt = this.sqlJsDb.prepare(this.sql);
      if (safeParams.length > 0) {
        stmt.bind(safeParams as any[]);
      }
      const results: T[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }
      stmt.free();
      return results;
    } catch (err) {
      throw wrapError(err, this.sql);
    }
  }
}

// ─── RunResult ────────────────────────────────────────────────────────

export interface RunResult {
  lastInsertRowid: number | bigint;
  changes: number;
}

// ─── Database ─────────────────────────────────────────────────────────

export class Database {
  private db!: SqlJsDatabase;
  private dbPath: string;
  private initialized = false;
  private stmtCache = new Map<string, Statement>();

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Initialize the database (loads WASM, opens/creates the file).
   * Must be called before any other method.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await ensureSqlJs();

    const dir = path.dirname(this.dbPath);
    await fs.ensureDir(dir);

    let buffer: Buffer | undefined;
    if (await fs.pathExists(this.dbPath)) {
      buffer = await fs.readFile(this.dbPath);
    }

    this.db = new SqlJsConstructor!(buffer);
    this.initialized = true;
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  /**
   * Save the database to disk.
   * sql.js operates in-memory; call this to persist.
   */
  save(): void {
    if (!this.initialized) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
    this.dirty = false;
  }

  /**
   * Mark as dirty and schedule a debounced save (100ms).
   * Multiple rapid writes batch into one disk flush.
   */
  scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) {
        this.save();
      }
    }, 100);
  }

  pragma(pragmaStr: string): Record<string, unknown>[] {
    this.assertReady();
    // sql.js doesn't have a dedicated pragma method; just run it
    try {
      const results = this.db.exec(`PRAGMA ${pragmaStr}`);
      if (results.length === 0) return [];
      // Convert sql.js result format to array of objects
      const cols = results[0].columns;
      return results[0].values.map(row => {
        const obj: Record<string, unknown> = {};
        cols.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      });
    } catch (err) {
      throw wrapError(err, `PRAGMA ${pragmaStr}`);
    }
  }

  exec(sql: string): void {
    this.assertReady();
    try {
      this.db.exec(sql);
      this.scheduleSave();
    } catch (err) {
      throw wrapError(err, sql.substring(0, 100));
    }
  }

  prepare(sql: string): Statement {
    this.assertReady();
    // Don't cache prepared statements in sql.js — they're single-use
    // Our Statement wrapper creates a new sql.js prepared stmt each call
    return new Statement(this.db, sql, this);
  }

  /**
   * Transaction support.
   * Wraps the function to run inside BEGIN/COMMIT with ROLLBACK on error.
   */
  transaction<T extends (...args: any[]) => any>(fn: T): T {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return function (this: any, ...args: any[]) {
      self.assertReady();
      self.db.run('BEGIN');
      try {
        const result = fn.apply(this, args);
        self.db.run('COMMIT');
        self.save();
        return result;
      } catch (err) {
        self.db.run('ROLLBACK');
        throw err;
      }
    } as T;
  }

  close(): void {
    if (!this.initialized) return;
    this.save();
    this.db.close();
    this.initialized = false;
  }

  private assertReady(): void {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function wrapError(err: unknown, sql: string): Error {
  if (err instanceof Error) {
    err.message = `${err.message} (SQL: ${sql.substring(0, 200)})`;
    return err;
  }
  return new Error(String(err) + ` (SQL: ${sql.substring(0, 200)})`);
}
