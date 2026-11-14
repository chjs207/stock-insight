import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readConfiguration, projectRoot } from "./config.ts";
import { openDatabase } from "./database.ts";
import { serverTransport } from "./transport.ts";
import { createApi } from "./api.ts";
import { httpApplication } from "./http.ts";

async function main() {
  const config = readConfiguration(projectRoot, process.argv.includes("--lan"));
  if (process.argv.includes("--dev")) {
    const build = spawnSync(process.execPath, [resolve(projectRoot, "node_modules/vite/bin/vite.js"), "build"], { cwd: projectRoot, stdio: "inherit" });
    if (build.status !== 0) throw new Error("화면 빌드에 실패했습니다.");
  }
  const dist = resolve(projectRoot, "dist");
  if (!existsSync(resolve(dist, "index.html"))) throw new Error("화면이 아직 빌드되지 않았습니다. npm run build 후 npm start를 실행하세요.");
  const database = openDatabase(config.databasePath);
  const api = createApi(database.db, config.dartKey, serverTransport(config));
  const { server, addresses } = httpApplication(api, { port: config.port, lan: config.host === "0.0.0.0", dist });
  try {
    await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(config.port, config.host, accept); });
  } catch { database.close(); throw new Error("서버를 시작하지 못했습니다. PORT가 다른 프로그램에서 사용 중인지 확인해 주세요."); }
  console.log(`스탁인사이트 http://127.0.0.1:${config.port}/`);
  for (const address of addresses) console.log(`내부망 접속 http://${address}:${config.port}/`);
  console.log("DART·키움 키는 .env에서 읽었습니다. 데이터는 로컬 SQLite에 저장합니다.");
  const stop = () => { server.close(() => database.close()); server.closeIdleConnections(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "서버를 시작하지 못했습니다."); process.exitCode = 1; });
