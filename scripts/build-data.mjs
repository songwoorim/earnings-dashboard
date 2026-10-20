// 실제 재무 데이터를 받아 data/companies.json 으로 저장해요.
//
//   DART_API_KEY=...  SEC_USER_AGENT="앱이름 you@example.com"  node scripts/build-data.mjs
//
// 한 종목이 실패해도 나머지는 계속 진행하고, 실패한 종목은 이전 파일의 값을 그대로 둬요.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fetchSecFacts, transformSec } from "./lib/sec.mjs";
import { fetchDartReports, transformDart } from "./lib/dart.mjs";

const OUT = new URL("../data/companies.json", import.meta.url);
const watchlist = JSON.parse(await readFile(new URL("./watchlist.json", import.meta.url), "utf8"));

const dartKey = process.env.DART_API_KEY;
const secUA = process.env.SEC_USER_AGENT;

let previous = {};
try {
  const old = JSON.parse(await readFile(OUT, "utf8"));
  previous = Object.fromEntries(old.companies.map((c) => [c.id, c]));
} catch {
  /* 첫 실행이면 이전 파일이 없어요 */
}

const thisYear = new Date().getFullYear();
const results = [];
const failures = [];

for (const item of watchlist) {
  try {
    let quarters;
    let extra;
    if (item.market === "US") {
      if (!secUA) throw new Error("SEC_USER_AGENT 가 비어 있어요 (예: \"earnings-dashboard you@example.com\")");
      quarters = transformSec(await fetchSecFacts(item.cik, secUA));
      extra = { currency: "USD", unitLabel: "백만 달러", source: "SEC EDGAR" };
    } else {
      if (!dartKey) throw new Error("DART_API_KEY 가 비어 있어요");
      const reports = await fetchDartReports(dartKey, item.corpCode, [thisYear - 2, thisYear - 1, thisYear]);
      quarters = transformDart(reports);
      extra = { currency: "KRW", unitLabel: "억원", source: "DART" };
    }
    if (quarters.length < 5) throw new Error(`분기 데이터가 ${quarters.length}개뿐이에요 (최소 5개 필요)`);

    results.push({
      id: item.id,
      name: item.name,
      nameEn: item.nameEn,
      market: item.market,
      sector: item.sector,
      about: item.about,
      ...extra,
      quarters,
    });
    console.log(`OK   ${item.id} ${item.name}: ${quarters.length}개 분기 (${quarters[0].q} ~ ${quarters.at(-1).q})`);
  } catch (err) {
    failures.push(item.id);
    console.error(`FAIL ${item.id} ${item.name}: ${err.message}`);
    if (previous[item.id]) results.push(previous[item.id]); // 이전 값 유지
  }
}

if (results.length === 0) {
  console.error("저장할 데이터가 하나도 없어서 파일을 바꾸지 않았어요.");
  process.exit(1);
}

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), companies: results }, null, 1) + "\n");
console.log(`저장 완료: ${results.length}개 종목${failures.length ? `, 실패 ${failures.join(", ")}` : ""}`);
if (failures.length === watchlist.length) process.exit(1);
