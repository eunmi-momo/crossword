import type { GeneratedCrossword } from "@/lib/generatePuzzle";
import { withBasePath } from "@/lib/basePath";

function todayKSTYmd(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

let cacheDate: string | null = null;
let cacheData: GeneratedCrossword | null = null;
let inflight: Promise<GeneratedCrossword> | null = null;

/** 메인 등에서 미리 호출 → 게임 진입 시 즉시 표시 */
export function getPrefetchedPuzzle(day: string): GeneratedCrossword | null {
  if (cacheDate === day && cacheData) return cacheData;
  return null;
}

export function bustPuzzlePrefetch(): void {
  cacheDate = null;
  cacheData = null;
  inflight = null;
}

/**
 * 오늘 퍼즐 1회 로드(진행 중이면 동일 Promise 공유).
 * 성공 시 메모리 캐시에 저장.
 */
export function prefetchTodayPuzzle(day?: string): Promise<GeneratedCrossword> {
  const d = day ?? todayKSTYmd();
  if (cacheDate === d && cacheData) return Promise.resolve(cacheData);
  if (inflight) return inflight;

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  inflight = fetch(
    withBasePath(
      `/api/puzzle?day=${encodeURIComponent(d)}&_=${encodeURIComponent(stamp)}`
    ),
    {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    }
  )
    .then(async (res) => {
      const json = (await res.json()) as GeneratedCrossword | { error: string };
      if (!res.ok)
        throw new Error((json as { error: string }).error ?? "불러오기 실패");
      return json as GeneratedCrossword;
    })
    .then((data) => {
      cacheDate = d;
      cacheData = data;
      return data;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
