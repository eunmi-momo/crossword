"use client";

import { useEffect } from "react";
import { prefetchTodayPuzzle } from "@/lib/puzzlePrefetch";

/** 모든 페이지에서 오늘 퍼즐 요청을 가능한 한 일찍 시작 (직접 /game 진입 시에도 공유 Promise) */
export function ClientPuzzleWarmup() {
  useEffect(() => {
    void prefetchTodayPuzzle();
  }, []);
  return null;
}
