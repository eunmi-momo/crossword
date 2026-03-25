/** 한국 표준시(KST) 기준 캘린더 날짜·시각 (Intl, DST 없음 가정) */

export function todayKSTYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** `yyyy-mm-dd` 문자열에 그레고리력 일수 더하기 (KST 날짜 키용) */
export function addCalendarDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function tomorrowKSTYmd(now: Date = new Date()): string {
  return addCalendarDaysYmd(todayKSTYmd(now), 1);
}

/** KST 기준 현재 시(0–23) */
export function getKSTHour(now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now).find((p) => p.type === "hour")?.value;
  const n = hour != null ? Number(hour) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function isYmdString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
