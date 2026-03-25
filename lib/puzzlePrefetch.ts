import type { GeneratedCrossword } from "@/lib/generatePuzzle";
import { withBasePath } from "@/lib/basePath";
import {
  getKSTHour,
  todayKSTYmd,
  tomorrowKSTYmd,
} from "@/lib/kstDate";

const cache = new Map<string, GeneratedCrossword>();
const inflight = new Map<string, Promise<GeneratedCrossword>>();

/** 메인 등에서 미리 호출 → 게임 진입 시 즉시 표시 */
export function getPrefetchedPuzzle(day: string): GeneratedCrossword | null {
  return cache.get(day) ?? null;
}

export function bustPuzzlePrefetch(): void {
  cache.clear();
  inflight.clear();
}

export type PrefetchPuzzleOptions = {
  /** `true`면 해당 날짜 캐시 무시 후 `/api/puzzle?force=1`로 재생성·저장 */
  force?: boolean;
};

/**
 * 지정일(기본: 오늘 KST) 퍼즐 로드. 진행 중이면 동일 Promise 공유.
 * 성공 시 메모리 캐시에 날짜 키로 저장.
 */
export function prefetchTodayPuzzle(
  day?: string,
  options?: PrefetchPuzzleOptions
): Promise<GeneratedCrossword> {
  const d = day ?? todayKSTYmd();
  if (options?.force) {
    bustPuzzlePrefetch();
  } else if (cache.get(d)) {
    return Promise.resolve(cache.get(d)!);
  }

  const existing = inflight.get(d);
  if (existing) return existing;

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const forceParam = options?.force ? "&force=1" : "";
  const promise = fetch(
    withBasePath(
      `/api/puzzle?day=${encodeURIComponent(d)}${forceParam}&_=${encodeURIComponent(stamp)}`
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
      cache.set(d, data);
      return data;
    })
    .finally(() => {
      inflight.delete(d);
    });

  inflight.set(d, promise);
  return promise;
}

/**
 * KST 23시 이후: 다음날 퍼즐을 백그라운드로 받아 두면 자정 직후 첫 방문 시 캐시 히트.
 */
export function maybePrefetchTomorrowPuzzle(): void {
  if (typeof window === "undefined") return;
  if (getKSTHour() < 23) return;
  void prefetchTodayPuzzle(tomorrowKSTYmd());
}
