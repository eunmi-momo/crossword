"use client";

import { useEffect } from "react";
import {
  maybePrefetchTomorrowPuzzle,
  prefetchTodayPuzzle,
} from "@/lib/puzzlePrefetch";

/** 청크 로드 직후 바로 요청 시작(useEffect보다 한 틱 빠름) */
if (typeof window !== "undefined") {
  void prefetchTodayPuzzle();
  maybePrefetchTomorrowPuzzle();
}

/**
 * 모든 페이지에서 오늘 퍼즐 요청을 가능한 한 일찍 시작.
 * 직접 /game 진입 시에도 공유 Promise·날짜별 캐시 사용.
 * KST 23시 이후에는 다음날 퍼즐도 백그라운드 프리패치(자정 직후 첫 방문 대비).
 */
export function ClientPuzzleWarmup() {
  useEffect(() => {
    void prefetchTodayPuzzle();
    maybePrefetchTomorrowPuzzle();
    const id = window.setInterval(maybePrefetchTomorrowPuzzle, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  return null;
}
