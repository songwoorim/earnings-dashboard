// 변환 로직 테스트: 실제 서버 응답과 같은 모양의 가짜 데이터로 분기 계산이 맞는지 확인해요.
// (네트워크는 쓰지 않아요)  실행: npm run data:test
import assert from "node:assert/strict";
import { quarterLabel, lastContiguous } from "./lib/common.mjs";
import { transformSec, flowQuarters } from "./lib/sec.mjs";
import { readReport, transformDart } from "./lib/dart.mjs";

// ---------- 공통 ----------
assert.equal(quarterLabel("2024-12-31"), "2024Q4");
assert.equal(quarterLabel("2025-09-27"), "2025Q3"); // 애플식 52주 회계
assert.equal(quarterLabel("2026-01-25"), "2025Q4"); // 엔비디아: 1월 말은 달력상 4분기
assert.equal(quarterLabel("2025-06-30"), "2025Q2");

const gap = lastContiguous(
  ["2024-03-31", "2024-06-30", "2025-03-31", "2025-06-30", "2025-09-30"].map((periodEnd) => ({ periodEnd })),
  8
);
assert.deepEqual(gap.map((r) => r.periodEnd), ["2025-03-31", "2025-06-30", "2025-09-30"], "빠진 분기 앞쪽은 버려요");

// ---------- SEC ----------
// 회계연도 2개(10월 시작). 분기별 값: 매출 100,110,120,130 / 200,210,220,230 (백만 달러)
function secFixture() {
  const mk = (tag, rows) => ({ units: { USD: rows } });
  const flow = (fyStart, ends, quarterVals, mult = 1) => {
    // 누적값으로 만들어요
    const out = [];
    let acc = 0;
    quarterVals.forEach((v, i) => {
      acc += v;
      out.push({ start: fyStart, end: ends[i], val: acc * 1e6 * mult, filed: ends[i] });
    });
    return out;
  };
  const fy1 = ["2023-12-31", "2024-03-31", "2024-06-30", "2024-09-30"];
  const fy2 = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30"];
  const both = (a, b, mult = 1) => [...flow("2023-10-01", fy1, a, mult), ...flow("2024-10-01", fy2, b, mult)];
  const inst = (vals) => [...fy1, ...fy2].map((end, i) => ({ end, val: vals[i] * 1e6, filed: end }));

  return {
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: mk("r", both([100, 110, 120, 130], [200, 210, 220, 230])),
        OperatingIncomeLoss: mk("o", both([10, 11, 12, 13], [20, 21, 22, 23])),
        NetIncomeLoss: mk("n", both([8, 9, 10, 11], [16, 17, 18, 19])),
        NetCashProvidedByUsedInOperatingActivities: mk("c", both([30, 31, 32, 33], [40, 41, 42, 43])),
        PaymentsToAcquirePropertyPlantAndEquipment: mk("x", both([5, 5, 6, 6], [7, 7, 8, 8])),
        Assets: mk("a", inst([1000, 1010, 1020, 1030, 1040, 1050, 1060, 1070])),
        Liabilities: mk("l", inst([400, 405, 410, 415, 420, 425, 430, 435])),
        CashAndCashEquivalentsAtCarryingValue: mk("ca", inst([100, 110, 120, 130, 140, 150, 160, 170])),
        LongTermDebtNoncurrent: mk("d1", inst([50, 50, 50, 50, 60, 60, 60, 60])),
        LongTermDebtCurrent: mk("d2", inst([5, 5, 5, 5, 6, 6, 6, 6])),
        CommercialPaper: mk("d3", inst([1, 1, 1, 1, 2, 2, 2, 2])),
      },
    },
  };
}

const sec = transformSec(secFixture());
assert.equal(sec.length, 8, "8개 분기");
assert.deepEqual(sec.map((r) => r.revenue), [100, 110, 120, 130, 200, 210, 220, 230], "Q4는 연간-9개월");
assert.deepEqual(sec.map((r) => r.op), [10, 11, 12, 13, 20, 21, 22, 23]);
assert.deepEqual(sec.map((r) => r.ocf), [30, 31, 32, 33, 40, 41, 42, 43], "현금흐름은 누적에서 차이를 계산");
assert.deepEqual(sec.map((r) => r.capex), [5, 5, 6, 6, 7, 7, 8, 8]);
assert.equal(sec[0].periodEnd, "2023-12-31");
assert.equal(sec[0].q, "2023Q4");
assert.equal(sec[7].q, "2025Q3");
assert.equal(sec[0].assets, 1000);
assert.equal(sec[0].debt, 56, "장기+유동+CP 합계");
assert.equal(sec[7].debt, 68);

// 진행 중인 회계연도(연간 값 없음)의 분기도 포함돼야 해요
{
  const f = (start, end, v) => ({ start, end, val: v * 1e6, filed: end });
  const items = [
    f("2024-10-01", "2024-12-31", 100), f("2024-10-01", "2025-03-31", 210),
    f("2024-10-01", "2025-06-30", 330), f("2024-10-01", "2025-09-30", 460),
    f("2025-10-01", "2025-12-31", 150), f("2025-10-01", "2026-03-31", 320),
  ];
  const q = flowQuarters(items);
  assert.equal(q.get("2025-09-30"), 130e6, "끝난 연도의 Q4");
  assert.equal(q.get("2025-12-31"), 150e6, "진행 중 연도 Q1");
  assert.equal(q.get("2026-03-31"), 170e6, "진행 중 연도 Q2 = 반기-1분기");
}

// ---------- DART ----------
const row = (sj, id, nm, thstrm, add) => ({ sj_div: sj, account_id: id, account_nm: nm, thstrm_amount: thstrm, thstrm_add_amount: add });
const E = 1e8; // 1억원
const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function dartReport({ rev, op, net, assets, liab, cash, ocf, capex, st, lt }) {
  return [
    row("IS", "ifrs-full_Revenue", "매출액", comma(rev * E)),
    row("IS", "dart_OperatingIncomeLoss", "영업이익", comma(op * E)),
    row("IS", "ifrs-full_ProfitLoss", "당기순이익", comma(net * E)),
    row("BS", "ifrs-full_Assets", "자산총계", comma(assets * E)),
    row("BS", "ifrs-full_Liabilities", "부채총계", comma(liab * E)),
    row("BS", "ifrs-full_CashAndCashEquivalents", "현금및현금성자산", comma(cash * E)),
    row("BS", "-", "단기차입금", comma(st * E)),
    row("BS", "-", "장기차입금", comma(lt * E)),
    row("CF", "ifrs-full_CashFlowsFromUsedInOperatingActivities", "영업활동현금흐름", comma(ocf * E)),
    row("CF", "ifrs-full_PurchaseOfPropertyPlantAndEquipment", "유형자산의 취득", `-${comma(capex * E)}`),
  ];
}

// 분기 매출 100,110,120,130 / 200,210,220,230, 현금흐름은 누적으로 제공
const mkYear = (revs, ocfs, capexs, base) => {
  const cum = (arr) => arr.map((_, i) => arr.slice(0, i + 1).reduce((a, b) => a + b, 0));
  const R = revs, O = cum(ocfs), C = cum(capexs);
  const keys = ["Q1", "H1", "Q3"];
  const rep = {};
  keys.forEach((k, i) => {
    rep[k] = dartReport({ rev: R[i], op: R[i] / 10, net: R[i] / 12.5, assets: base + i, liab: 400 + i, cash: 100 + i, ocf: O[i], capex: C[i], st: 10, lt: 20 });
  });
  rep.FY = dartReport({ rev: R.reduce((a, b) => a + b, 0), op: R.reduce((a, b) => a + b, 0) / 10, net: R.reduce((a, b) => a + b, 0) / 12.5, assets: base + 3, liab: 403, cash: 103, ocf: O[3], capex: C[3], st: 10, lt: 20 });
  return rep;
};

const dart = transformDart({
  2024: mkYear([100, 110, 120, 130], [30, 31, 32, 33], [5, 5, 6, 6], 1000),
  2025: mkYear([200, 210, 220, 230], [40, 41, 42, 43], [7, 7, 8, 8], 1100),
});
assert.equal(dart.length, 8);
assert.deepEqual(dart.map((r) => r.revenue), [100, 110, 120, 130, 200, 210, 220, 230], "Q4=연간-(1+2+3분기)");
assert.deepEqual(dart.map((r) => r.ocf), [30, 31, 32, 33, 40, 41, 42, 43], "현금흐름 누적 → 분기");
assert.deepEqual(dart.map((r) => r.capex), [5, 5, 6, 6, 7, 7, 8, 8], "취득액은 절댓값");
assert.equal(dart[0].q, "2024Q1");
assert.equal(dart[7].periodEnd, "2025-12-31");
assert.equal(dart[0].debt, 30, "단기+장기 차입금");
assert.equal(dart[0].assets, 1000);

// 계정 이름만 있고 account_id 가 없어도 읽어요
const byName = readReport([
  row("IS", "", "영업수익", "5,000"),
  row("BS", "", "자산총계", "9,000"),
]);
assert.equal(byName.revenue, 5000);
assert.equal(byName.assets, 9000);

console.log("모든 테스트 통과");
