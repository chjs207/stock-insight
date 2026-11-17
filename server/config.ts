import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export type Configuration = { dartKey: string; appKey: string; appSecret: string; host: string; port: number; databasePath: string };

export function readConfiguration(root = projectRoot, lan = false): Configuration {
  let env: NodeJS.Dict<string>;
  try { env = parseEnv(readFileSync(resolve(root, ".env"), "utf8")); }
  catch { throw new Error("프로젝트 폴더의 .env.example을 .env로 복사하고 DART 키를 입력해 주세요."); }
  const names = ["DART_API_KEY"] as const;
  const missing = names.filter(name => !env[name]?.trim() || env[name].trim().startsWith("your_"));
  if (missing.length) throw new Error(".env에 " + missing.join(", ") + "를 입력해 주세요.");
  const port = Number(env.PORT?.trim() || 4180);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(".env의 PORT는 1–65535 사이 정수여야 합니다.");
  const host = lan ? "0.0.0.0" : env.HOST?.trim() || "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0"].includes(host)) throw new Error("HOST는 127.0.0.1 또는 0.0.0.0으로 설정해 주세요.");
  const optionalKey = (name: string) => { const value = env[name]?.trim() ?? ""; return value.startsWith("your_") ? "" : value; };
  return { dartKey: env.DART_API_KEY!.trim(), appKey: optionalKey("KIWOOM_APP_KEY"), appSecret: optionalKey("KIWOOM_APP_SECRET"),
    host, port, databasePath: resolve(root, env.DATABASE_PATH?.trim() || ".local/stock-insight.sqlite") };
}
