// 한국 금융감독원 DART 오픈API(fnlttSinglAcntAll) 응답을 분기 데이터로 바꿔요. 단위: 억원
// 12월 결산 법인을 기준으로 해요 (1분기=3월, 반기=6월, 3분기=9월, 사업보고서=12월)
import { hasAll, lastContiguous, quarterLabel } from "./common.mjs";

const REPORTS = { Q1: "11013", H1: "11012", Q3: "11014", FY: "11011" };
const PERIOD_END = { Q1: "03-31", H1: "06-30", Q3: "09-30", FY: "12-31" };

const num = (s) => {
  if (s === undefined || s === null || s === "") return undefined;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

const clean = (s) => String(s ?? "").replace(/\s+/g, "");

// 계정 하나 찾기: account_id 우선, 없으면 계정 이름으로 찾아요
function find(list, { sj, ids = [], names = [] }) {
  const pool = list.filter((r) => sj.includes(r.sj_div));
  for (const id of ids) {
    const hit = pool.find((r) => r.account_id === id);
    if (hit) return hit;
  }
  for (const name of names) {
    const hit = pool.find((r) => clean(r.account_nm).startsWith(name));
    if (hit) return hit;
  }
  return undefined;
}

const SPEC = {
  revenue: { sj: ["IS", "CIS"], ids: ["ifrs-full_Revenue"], names: ["매출액", "수익(매출액)", "영업수익"] },
  op: { sj: ["IS", "CIS"], ids: ["dart_OperatingIncomeLoss"], names: ["영업이익", "영업손익"] },
  net: { sj: ["IS", "CIS"], ids: ["ifrs-full_ProfitLoss"], names: ["당기순이익", "분기순이익", "반기순이익", "연결당기순이익", "연결분기순이익", "연결반기순이익"] },
  assets: { sj: ["BS"], ids: ["ifrs-full_Assets"], names: ["자산총계"] },
  liab: { sj: ["BS"], ids: ["ifrs-full_Liabilities"], names: ["부채총계"] },
  cash: { sj: ["BS"], ids: ["ifrs-full_CashAndCashEquivalents"], names: ["현금및현금성자산"] },
  ocf: { sj: ["CF"], ids: ["ifrs-full_CashFlowsFromUsedInOperatingActivities", "ifrs-full_NetCashFlowsFromUsedInOperatingActivities"], names: ["영업활동현금흐름", "영업활동으로인한현금흐름", "영업활동순현금흐름"] },
  capex: { sj: ["CF"], ids: ["ifrs-full_PurchaseOfPropertyPlantAndEquipment"], names: ["유형자산의취득", "유형자산취득"] },
};

const DEBT_NAMES = /^(단기차입금|장기차입금|유동성장기부채|유동성장기차입금|사채|유동성사채|차입금)$/;

// 한 보고서(리스트)에서 값을 뽑아요
export function readReport(list) {
  const get = (key, field = "thstrm_amount") => num(find(list, SPEC[key])?.[field]);
  const seen = new Set();
  let debt = 0;
  for (const r of list) {
    const nm = clean(r.account_nm);
    if (r.sj_div === "BS" && DEBT_NAMES.test(nm) && !seen.has(nm)) {
      seen.add(nm);
      debt += num(r.thstrm_amount) ?? 0;
    }
  }
  return {
    revenue: get("revenue"),
    op: get("op"),
    net: get("net"),
    assets: get("assets"),
    liab: get("liab"),
    cash: get("cash"),
    ocf: get("ocf"),
    capex: get("capex"),
    debt,
  };
}

const sub = (a, b) => (a === undefined || b === undefined ? undefined : a - b);

// reports: { 2025: { Q1: [...], H1: [...], Q3: [...], FY: [...] }, ... }
export function transformDart(reportsByYear) {
  const rows = [];
  const eok = (v) => (v === undefined ? undefined : Math.round(v / 1e8));

  for (const [year, rep] of Object.entries(reportsByYear)) {
    const r = {};
    for (const k of Object.keys(REPORTS)) r[k] = rep[k]?.length ? readReport(rep[k]) : undefined;

    // 손익: 1분기·반기·3분기 보고서의 당기 금액은 3개월치, 4분기는 연간에서 앞의 3개 분기를 빼요
    const flowIS = (key) => {
      const q1 = r.Q1?.[key], q2 = r.H1?.[key], q3 = r.Q3?.[key], fy = r.FY?.[key];
      const q4 = [q1, q2, q3, fy].every((v) => v !== undefined) ? fy - q1 - q2 - q3 : undefined;
      return { Q1: q1, H1: q2, Q3: q3, FY: q4 };
    };
    // 현금흐름: 누적 값이라서 앞 기간을 빼요
    const flowCF = (key) => {
      const a = r.Q1?.[key], b = r.H1?.[key], c = r.Q3?.[key], d = r.FY?.[key];
      return { Q1: a, H1: sub(b, a), Q3: sub(c, b), FY: sub(d, c) };
    };
    const is = { revenue: flowIS("revenue"), op: flowIS("op"), net: flowIS("net") };
    const cf = { ocf: flowCF("ocf"), capex: flowCF("capex") };

    for (const p of Object.keys(REPORTS)) {
      if (!r[p]) continue;
      const row = {
        periodEnd: `${year}-${PERIOD_END[p]}`,
        q: quarterLabel(`${year}-${PERIOD_END[p]}`),
        revenue: eok(is.revenue[p]),
        op: eok(is.op[p]),
        net: eok(is.net[p]),
        assets: eok(r[p].assets),
        liab: eok(r[p].liab),
        cash: eok(r[p].cash),
        debt: eok(r[p].debt),
        ocf: eok(cf.ocf[p]),
        capex: cf.capex[p] === undefined ? undefined : eok(Math.abs(cf.capex[p])),
      };
      if (hasAll(row)) rows.push(row);
    }
  }
  return lastContiguous(rows, 8);
}

// 네트워크 부분 -----------------------------------------------------------

async function fetchOne(key, corpCode, year, code, fsDiv) {
  const url = new URL("https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json");
  url.search = new URLSearchParams({ crtfc_key: key, corp_code: corpCode, bsns_year: String(year), reprt_code: code, fs_div: fsDiv });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DART 응답 오류 ${res.status}`);
  const json = await res.json();
  if (json.status === "000") return json.list ?? [];
  if (json.status === "013") return []; // 아직 공시 전이거나 데이터 없음
  throw new Error(`DART ${corpCode} ${year} ${code}: ${json.status} ${json.message}`);
}

export async function fetchDartReports(key, corpCode, years) {
  const out = {};
  for (const year of years) {
    out[year] = {};
    for (const [name, code] of Object.entries(REPORTS)) {
      let list = await fetchOne(key, corpCode, year, code, "CFS"); // 연결재무제표
      if (!list.length) list = await fetchOne(key, corpCode, year, code, "OFS"); // 없으면 별도재무제표
      out[year][name] = list;
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  return out;
}
