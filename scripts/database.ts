import initSqlJs from "sql.js";
import type { Database, SqlValue } from "sql.js";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const tables = ["annual_reports", "companies", "corp_directory", "quarterly_reports", "asset_managers",
  "ownership_details", "ownership_months", "market_quotes", "collection_targets"] as const;
type Backup = { version: 1; tables: Record<string, Record<string, SqlValue>[]> };

export async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + ".tmp", JSON.stringify(value, null, 2) + "\n");
  await rename(path + ".tmp", path);
}

export async function optionalJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export function query<T>(sql: Database, statement: string, values: SqlValue[] = []): T[] {
  const prepared = sql.prepare(statement);
  try {
    prepared.bind(values);
    const result: T[] = [];
    while (prepared.step()) result.push(prepared.getAsObject() as T);
    return result;
  } finally { prepared.free(); }
}

export function adapter(sql: Database): D1Database {
  const statement = (text: string, values: SqlValue[] = []) => ({
    bind: (...args: SqlValue[]) => statement(text, args),
    async first<T>(column?: string) {
      const row = query<Record<string, SqlValue>>(sql, text, values)[0];
      return (row ? column ? row[column] : row : null) as T | null;
    },
    async all<T>() { return { results: query<T>(sql, text, values), success: true, meta: {} }; },
    async run() { sql.run(text, values); return { results: [], success: true, meta: {} }; },
  });
  return { prepare: statement } as unknown as D1Database;
}

export async function openDatabase(path?: string) {
  const SQL = await initSqlJs();
  const sql = new SQL.Database();
  for (const migration of ["0000_market_cache", "0001_quarterly_cache", "0003_ownership", "0004_market_quotes"]) {
    sql.run(await readFile(new URL("../drizzle/" + migration + ".sql", import.meta.url), "utf8"));
  }
  sql.run("CREATE TABLE collection_targets (corp_code TEXT PRIMARY KEY, quarter_years INTEGER NOT NULL)");
  const backup = path ? await optionalJson<Backup>(path) : undefined;
  if (backup) {
    if (backup.version !== 1 || !backup.tables) throw new Error("지원하지 않는 DB 백업 형식입니다.");
    sql.run("BEGIN");
    try {
      for (const table of tables) {
        const columns = query<{ name: string }>(sql, `PRAGMA table_info(${table})`).map(row => row.name);
        for (const row of backup.tables[table] ?? []) {
          sql.run(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
            columns.map(name => row[name] ?? null));
        }
      }
      sql.run("COMMIT");
    } catch (error) { sql.run("ROLLBACK"); sql.close(); throw error; }
  }
  return {
    sql, db: adapter(sql),
    async save(destination: string) {
      const data: Backup = { version: 1, tables: {} };
      for (const table of tables) data.tables[table] = query(sql, `SELECT * FROM ${table} ORDER BY 1, 2`);
      await atomicJson(destination, data);
    },
  };
}
