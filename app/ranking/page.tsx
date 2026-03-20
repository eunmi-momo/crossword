"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type RankingRow = {
  id: number;
  name: string;
  time: number;
  date: string;
  created_at: string;
};

function todayKSTYmd(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function formatKoreanTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}분 ${String(s).padStart(2, "0")}초`;
}

function medal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `${rank}등`;
}

export default function RankingPage() {
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(() => todayKSTYmd(), []);

  async function load() {
    try {
      setError(null);
      const { data, error: dbError } = await supabase
        .from("rankings")
        .select("id,name,time,date,created_at")
        .eq("date", today)
        .order("time", { ascending: true })
        .limit(10);
      if (dbError) throw dbError;
      setRows((data ?? []) as RankingRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "랭킹 불러오기 실패");
    }
  }

  useEffect(() => {
    load();
    const id = window.setInterval(load, 30000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              나의 기록
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
              오늘의 랭킹
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">{today}</p>
          </div>
          {/* 상단 메뉴는 오늘의 랭킹만 */}
        </header>

        <div className="mb-6">
          <Link
            href="/game"
            className="inline-flex w-full items-center justify-center rounded-full bg-[var(--primary)] px-6 py-4 text-sm font-bold text-white shadow-md transition hover:opacity-90"
          >
            게임 시작
          </Link>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-[var(--card)] p-4 text-sm text-red-600 dark:border-red-800 dark:text-red-400">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm">
          {rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--muted)]">
              오늘의 첫 번째 도전자가 되어주세요!
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[48px_1fr_auto] items-center gap-x-3 px-2 py-2 text-xs font-semibold uppercase text-[var(--muted)]">
                <span>순위</span>
                <span>이름</span>
                <span>시간</span>
              </div>
              <ul className="divide-y divide-[var(--card-border)]">
                {rows.map((r, idx) => (
                  <li key={r.id} className="grid grid-cols-[48px_1fr_auto] items-center gap-x-3 px-2 py-4">
                    <div className="text-sm font-bold text-[var(--foreground)]">
                      {medal(idx + 1)}
                    </div>
                    <div className="min-w-0 text-sm font-semibold text-[var(--foreground)] truncate">
                      {r.name}
                    </div>
                    <div className="text-sm font-medium text-[var(--muted)]">
                      {formatKoreanTime(r.time)}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

