import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dataTables } from "./database.ts";

export function importData(target: DatabaseSync, sourcePath: string) {
  let source: DatabaseSync | undefined;
  let tables: Record<string, Record<string, SQLInputValue>[] | undefined> | undefined;
  if (sourcePath.endsWith(".json")) {
    const backup = JSON.parse(readFileSync(sourcePath, "utf8"));
    if (backup.version !== 1 || !backup.tables) throw new Error("지원하지 않는 JSON 백업 형식입니다.");
    tables = backup.tables;
  } else {
    source = new DatabaseSync(sourcePath, { readOnly: true });
    source.exec("BEGIN");
  }
  const counts: Record<string, number> = {};
  target.exec("BEGIN");
  try {
    for (const table of dataTables) {
      const columns = target.prepare(`PRAGMA table_info(${table})`).all() as { name: string; pk: number }[];
      const names = columns.map(column => column.name);
      const keys = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
      const rows = tables ? tables[table] ?? [] : source!.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
        ? source!.prepare(`SELECT * FROM ${table}`).all() : [];
      const update = names.includes("fetched_at")
        ? ` ON CONFLICT(${keys.join(",")}) DO UPDATE SET ${names.filter(name => !keys.includes(name)).map(name => `${name}=excluded.${name}`).join(",")} WHERE excluded.fetched_at > ${table}.fetched_at`
        : " ON CONFLICT DO NOTHING";
      const insert = target.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})${update}`);
      let imported = 0;
      for (const row of rows) {
        if (names.some(name => !(name in row))) throw new Error("백업 자료에 필요한 열이 없습니다.");
        imported += Number(insert.run(...names.map(name => row[name] as SQLInputValue)).changes);
      }
      counts[table] = imported;
    }
    target.exec("COMMIT");
    return counts;
  } catch (error) { target.exec("ROLLBACK"); throw error; }
  finally { if (source) { source.exec("ROLLBACK"); source.close(); } }
}
