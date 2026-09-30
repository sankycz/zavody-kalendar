import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * Minimal D1Database stand-in over node:sqlite for tests. Covers the subset
 * the pipeline uses: prepare().bind().first()/all()/run().
 */
class Stmt {
  private params: SQLInputValue[] = [];
  private readonly db: DatabaseSync;
  private readonly sql: string;
  constructor(db: DatabaseSync, sql: string) {
    this.db = db;
    this.sql = sql;
  }
  bind(...values: unknown[]): Stmt {
    this.params = values.map((v) => (v === undefined ? null : (v as SQLInputValue)));
    return this;
  }
  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }
  async run(): Promise<{ meta: { changes: number } }> {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(r.changes) } };
  }
}

export function createTestDb(): { d1: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const dir = join(import.meta.dirname, "..", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(join(dir, f), "utf8"));
  }
  const d1 = { prepare: (sql: string) => new Stmt(raw, sql) } as unknown as D1Database;
  return { d1, raw };
}
