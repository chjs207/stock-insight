import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export const dataTables = ["annual_reports", "companies", "corp_directory", "quarterly_reports", "watchlist",
  "asset_managers", "ownership_details", "ownership_months", "market_quotes", "price_history"] as const;

export function databaseAdapter(sql: DatabaseSync): D1Database {
  const statement = (text: string, values: SQLInputValue[] = []) => ({
    bind: (...args: SQLInputValue[]) => statement(text, args),
    async first<T>(column?: string) {
      const row = sql.prepare(text).get(...values);
      return (row ? column ? row[column] : row : null) as T | null;
    },
    async all<T>() { return { results: sql.prepare(text).all(...values) as T[], success: true, meta: {} }; },
    async run() { sql.prepare(text).run(...values); return { results: [], success: true, meta: {} }; },
  });
  return { prepare: statement } as unknown as D1Database;
}

export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sql = new DatabaseSync(path);
  try {
    sql.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS local_migrations (id INTEGER PRIMARY KEY)");
    const files = ["0000_market_cache", "0001_quarterly_cache", "0002_watchlist", "0003_ownership", "0004_market_quotes", "0005_price_history", "0006_default_manager"];
    for (const [id, file] of files.entries()) {
      if (sql.prepare("SELECT 1 FROM local_migrations WHERE id=?").get(id)) continue;
      sql.exec("BEGIN");
      try {
        // IF NOT EXISTS also supports importing an existing version's SQLite file.
        const migration = readFileSync(new URL("../drizzle/" + file + ".sql", import.meta.url), "utf8").replaceAll("CREATE TABLE `", "CREATE TABLE IF NOT EXISTS `");
        sql.exec(migration);
        sql.prepare("INSERT INTO local_migrations (id) VALUES (?)").run(id);
        sql.exec("COMMIT");
      } catch (error) { sql.exec("ROLLBACK"); throw error; }
    }
    if (path !== ":memory:") {
      for (const suffix of ["", "-wal", "-shm"]) {
        try { chmodSync(path + suffix, 0o600); } catch { /* SQLite creates sidecars as needed. */ }
      }
    }
    return { sql, db: databaseAdapter(sql), close: () => sql.close() };
  } catch (error) { sql.close(); throw error; }
}
