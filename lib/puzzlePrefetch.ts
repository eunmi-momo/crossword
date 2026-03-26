import type { GeneratedCrossword } from "@/lib/generatePuzzle";
import { withBasePath } from "@/lib/basePath";
import {
  getKSTHour,
  todayKSTYmd,
  tomorrowKSTYmd,
} from "@/lib/kstDate";

const cache = new Map<string, GeneratedCrossword>();
const inflight = new Map<string, Promise<GeneratedCrossword>>();

/** localStorage 키 (날짜별). 앱 업데이트 시 스키마 바뀌면 버전 올릴 것 */
const LS_PREFIX = "sbs-crossword-puzzle-v1:";

function puzzleLsKey(day: string): string {
  return `${LS_PREFIX}${day}`;
}

function isUsableCrosswordJson(data: unknown): data is GeneratedCrossword {
  if (!data || typeof data !== "object") return false;
  const d = data as GeneratedCrossword;
  if (!Array.isArray(d.grid) || d.grid.length !== 10) return false;
  const row0 = d.grid[0];
  if (!Array.isArray(row0) || row0.length !== 10) return false;
  if (!Array.isArray(d.words) || d.words.length < 5) return false;
  return true;
}

function readPersistedPuzzle(day: string): GeneratedCrossword | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(puzzleLsKey(day));
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!isUsableCrosswordJson(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function writePersistedPuzzle(day: string, data: GeneratedCrossword): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(puzzleLsKey(day), JSON.stringify(data));
  } catch {
    /* 할당량 초과 등 — 무시 */
  }
}

function clearAllPersistedPuzzles(): void {
  if (typeof window === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** 메모리 캐시만 (레거시·동일 탭 내 프리페치) */
export function getPrefetchedPuzzle(day: string): GeneratedCrossword | null {
  return cache.get(day) ?? null;
}

/**
 * 메모리 → localStorage 순으로 오늘 퍼즐 조회. 디스크 히트 시 메모리에도 넣음.
 * 새로고침·재방문 시에도 즉시 그리드 표시에 사용.
 */
export function getCachedOrPersistedPuzzle(day: string): GeneratedCrossword | null {
  const mem = cache.get(day);
  if (mem) return mem;
  const disk = readPersistedPuzzle(day);
  if (disk) {
    cache.set(day, disk);
    return disk;
  }
  return null;
}

export function bustPuzzlePrefetch(): void {
  cache.clear();
  inflight.clear();
  clearAllPersistedPuzzles();
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
      writePersistedPuzzle(d, data);
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
