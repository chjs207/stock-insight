import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";
import { openDatabase } from "./database.ts";
import { importData } from "./import-data.ts";
import { projectRoot } from "./config.ts";

const { values } = parseArgs({ options: { from: { type: "string" }, database: { type: "string" } } });
if (!values.from) throw new Error("npm run db:import -- --from 기존_SQLite_또는_cache.json_경로 로 실행하세요.");
const env = existsSync(resolve(projectRoot, ".env")) ? parseEnv(readFileSync(resolve(projectRoot, ".env"), "utf8")) : {};
const path = resolve(projectRoot, values.database || env.DATABASE_PATH?.trim() || ".local/stock-insight.sqlite");
const source = resolve(values.from);
if (source === path) throw new Error("가져올 DB와 저장할 DB는 서로 달라야 합니다.");
const database = openDatabase(path);
try { console.log("가져온 자료:", importData(database.sql, source)); }
finally { database.close(); }
