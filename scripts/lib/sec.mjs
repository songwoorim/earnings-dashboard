// 미국 SEC EDGAR "companyfacts" 응답을 분기 데이터로 바꿔요. 단위: 백만 달러($M)
import { daysBetween, hasAll, lastContiguous, quarterLabel } from "./common.mjs";

const FLOW_TAGS = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
  op: ["OperatingIncomeLoss"],
  net: ["NetIncomeLoss", "ProfitLoss"],
  ocf: ["NetCashProvidedByUsedInOperatingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
};

const usd = (facts, tag) => facts?.facts?.["us-gaap"]?.[tag]?.units?.USD ?? [];

// 후보 태그 중 가장 최근 데이터를 가진 태그를 골라요 (회사마다 쓰는 태그가 달라요)
function pickTag(facts, candidates) {
  let best = null;
  for (const tag of candidates) {
    const items = usd(facts, tag);
    if (!items.length) continue;
    const latest = items.reduce((m, x) => (x.end > m ? x.end : m), "");
    if (!best || latest > best.latest) best = { tag, items, latest };
  }
  return best?.items ?? [];
}

// 같은 기간이 여러 공시에 중복으로 있으면 가장 늦게 낸 값을 써요
function dedupe(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    const p = m.get(k);
    if (!p || it.filed > p.filed) m.set(k, it);
  }
  return [...m.values()];
}

// 누적(YTD) 값으로 분기 값을 만들어요: Q1=1분기, Q2=반기-1분기, Q3=9개월-반기, Q4=연간-9개월
// 반환: Map(분기 종료일 → 값)
export function flowQuarters(items) {
  const arr = dedupe(items.filter((x) => x.start), (x) => `${x.start}|${x.end}`).map((x) => ({
    ...x,
    d: daysBetween(x.start, x.end),
  }));
  const out = new Map();
  for (const fy of arr.filter((x) => x.d >= 350 && x.d <= 380)) {
    const same = arr.filter((x) => Math.abs(daysBetween(fy.start, x.start)) <= 5);
    const ytd1 = same.find((x) => x.d >= 80 && x.d <= 100);
    const ytd2 = same.find((x) => x.d >= 170 && x.d <= 195);
    const ytd3 = same.find((x) => x.d >= 260 && x.d <= 285);
    if (ytd1) out.set(ytd1.end, ytd1.val);
    if (ytd1 && ytd2) out.set(ytd2.end, ytd2.val - ytd1.val);
    if (ytd2 && ytd3) out.set(ytd3.end, ytd3.val - ytd2.val);
    if (ytd3) out.set(fy.end, fy.val - ytd3.val);
  }
  return out;
}

// 특정 날짜 시점의 잔액 (재무상태표 항목)
function instantAt(items, end) {
  const pts = dedupe(items.filter((x) => !x.start), (x) => x.end);
  const exact = pts.find((x) => x.end === end);
  if (exact) return exact.val;
  const near = pts.find((x) => Math.abs(daysBetween(x.end, end)) <= 3);
  return near ? near.val : undefined;
}

export function transformSec(facts) {
  const flows = {};
  for (const [key, tags] of Object.entries(FLOW_TAGS)) flows[key] = flowQuarters(pickTag(facts, tags));

  const assetsItems = usd(facts, "Assets");
  const liabItems = usd(facts, "Liabilities");
  const equityItems = usd(facts, "StockholdersEquity");
  const lAndEItems = usd(facts, "LiabilitiesAndStockholdersEquity");
  const cashItems = pickTag(facts, ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]);
  const ltNon = usd(facts, "LongTermDebtNoncurrent");
  const ltCur = usd(facts, "LongTermDebtCurrent");
  const debtCur = usd(facts, "DebtCurrent");
  const cp = usd(facts, "CommercialPaper");
  const stb = usd(facts, "ShortTermBorrowings");
  const ltAll = usd(facts, "LongTermDebt");

  const M = (v) => (v === undefined ? undefined : Math.round(v / 1e6));
  const rows = [];

  for (const end of flows.revenue.keys()) {
    const assets = instantAt(assetsItems, end);
    let liab = instantAt(liabItems, end);
    if (liab === undefined) {
      const le = instantAt(lAndEItems, end);
      const eq = instantAt(equityItems, end);
      if (le !== undefined && eq !== undefined) liab = le - eq;
    }

    // 차입금은 회사마다 항목이 달라서 대략적인 합계예요 (정확한 값이 필요하면 공시 확인)
    const lt = instantAt(ltNon, end);
    const cur = instantAt(ltCur, end) ?? instantAt(debtCur, end);
    const commercial = instantAt(cp, end);
    const short = instantAt(stb, end);
    let debt;
    if ([lt, cur, commercial, short].some((v) => v !== undefined)) {
      debt = (lt ?? 0) + (cur ?? 0) + (commercial ?? 0) + (short ?? 0);
    } else {
      debt = instantAt(ltAll, end) ?? 0;
    }

    const row = {
      periodEnd: end,
      q: quarterLabel(end),
      revenue: M(flows.revenue.get(end)),
      op: M(flows.op.get(end)),
      net: M(flows.net.get(end)),
      assets: M(assets),
      liab: M(liab),
      cash: M(instantAt(cashItems, end)),
      debt: M(debt),
      ocf: M(flows.ocf.get(end)),
      capex: M(flows.capex.get(end) === undefined ? undefined : Math.abs(flows.capex.get(end))),
    };
    if (hasAll(row)) rows.push(row);
  }
  return lastContiguous(rows, 8);
}

export async function fetchSecFacts(cik, userAgent) {
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`SEC ${cik} 응답 오류 ${res.status}`);
  return res.json();
}
