// 두 데이터 소스(SEC, DART)가 같이 쓰는 도우미

const DAY = 86400000;

export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// 분기 종료일 → "2025Q3" 형태 이름.
// 종료일에서 45일을 빼 분기의 한가운데 날짜로 계산해요.
// (예: 엔비디아의 1월 말 종료 분기는 달력상 4분기에 가까워서 "2025Q4"가 돼요)
export function quarterLabel(endDate) {
  const mid = new Date(Date.parse(endDate) - 45 * DAY);
  return `${mid.getUTCFullYear()}Q${Math.floor(mid.getUTCMonth() / 3) + 1}`;
}

// 종료일이 91일 안팎 간격으로 이어진 마지막 구간만 남기고, 최근 n개를 돌려줘요.
// (중간에 빠진 분기가 있으면 "전년 동기 대비" 계산이 틀어지기 때문이에요)
export function lastContiguous(rows, n = 8) {
  const sorted = [...rows].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  let start = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = daysBetween(sorted[i - 1].periodEnd, sorted[i].periodEnd);
    if (gap < 70 || gap > 115) start = i;
  }
  return sorted.slice(start).slice(-n);
}

export const REQUIRED = ["revenue", "op", "net", "assets", "liab", "cash", "ocf", "capex"];

export const hasAll = (row) => REQUIRED.every((k) => typeof row[k] === "number" && Number.isFinite(row[k]));
