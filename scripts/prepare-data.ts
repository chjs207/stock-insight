import { cp, mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { optionalJson } from "./database.ts";
import type { Catalog } from "../src/data-types.ts";

const source = resolve(process.env.DATA_DIR || ".data", "site");
const catalog = await optionalJson<Catalog>(join(source, "catalog.json"));
if (!catalog?.companies.length || !Object.keys(catalog.collected).length) {
  throw new Error("게시할 수집 자료가 없습니다. 먼저 npm run collect를 실행하세요.");
}
const target = resolve("public/data");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log(`공개 데이터 ${Object.keys(catalog.collected).length}개 기업 준비 완료`);
