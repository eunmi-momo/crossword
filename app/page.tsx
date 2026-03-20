"use client";

import { useEffect, useMemo, useState } from "react";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { withBasePath } from "@/lib/basePath";
import { prefetchTodayPuzzle } from "@/lib/puzzlePrefetch";

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

export default function HomePage() {
  const router = useRouter();
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(() => todayKSTYmd(), []);
  const [nameDraft, setNameDraft] = useState("");

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
    void load();
    void prefetchTodayPuzzle(today);
    const id = window.setInterval(load, 30000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function warmPuzzle() {
    void prefetchTodayPuzzle(today);
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        {/* 좌측 상단 SBS NEWS */}
        <header className="mb-6 sm:mb-10">
          <a
            href="https://news.sbs.co.kr"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
            aria-label="SBS 뉴스 (새 창)"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={withBasePath("/logo/sbsnews.svg?v=2")}
              alt=""
              width={98}
              height={16}
              className="sbs-news-logo"
            />
          </a>
        </header>

        {/* 크로스워드 소개 박스 */}
        <section className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] px-4 py-10 text-center shadow-sm sm:px-10 sm:py-14">
          <p className="text-sm font-semibold uppercase tracking-widest text-[var(--primary)] sm:text-base">
            오늘의 챌린지
          </p>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-[var(--card-foreground)] sm:text-3xl md:text-4xl">
            뉴스 크로스워드
          </h1>
          <p className="mt-4 text-sm text-[var(--card-muted)] sm:text-base">
            단 5분, 게임처럼 즐기다 보면 어느새 시사 상식 마스터!
          </p>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={withBasePath("/img/main-visual.png")}
            alt="크로스워드 일러스트"
            className="mx-auto mt-6 w-full max-w-[min(100%,24rem)] sm:max-w-[28rem]"
          />

          <div className="mx-auto mt-8 flex w-full max-w-xs flex-col items-center gap-3">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onFocus={warmPuzzle}
              placeholder="이름을 입력하세요"
              className="w-full rounded-xl border-2 border-[var(--primary)] bg-[var(--card)] px-4 py-3 text-center text-sm text-[var(--card-foreground)] outline-none placeholder:text-[var(--card-muted)] focus:ring-2 focus:ring-[var(--primary)]"
              maxLength={20}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const n = nameDraft.trim();
                  if (n) router.push(`/game?name=${encodeURIComponent(n)}`);
                }
              }}
            />
            <button
              type="button"
              className="inline-flex w-full items-center justify-center rounded-full bg-[var(--primary)] px-8 py-4 text-base font-bold text-white shadow-md transition hover:opacity-90"
              onMouseEnter={warmPuzzle}
              onFocus={warmPuzzle}
              onClick={() => {
                const n = nameDraft.trim();
                if (!n) return;
                router.push(`/game?name=${encodeURIComponent(n)}`);
              }}
            >
              오늘의 퀴즈 도전하기
            </button>
          </div>
        </section>

        {/* 오늘의 랭킹 박스 */}
        <aside className="mt-6 rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-sm sm:p-8">
          <h3 className="text-xl font-extrabold text-center text-[var(--card-foreground)] sm:text-2xl">
            오늘의 랭킹
          </h3>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-[var(--card)] p-4 text-sm text-red-600 dark:border-red-800 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="mt-6">
            {rows.length === 0 ? (
              <div className="py-6 text-center text-sm text-[var(--card-muted)]">
                아직 기록이 없습니다.
              </div>
            ) : (
              <ul className="space-y-3">
                {rows.map((r, idx) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 rounded-xl px-4 py-3"
                  >
                    <span className="flex h-10 min-w-[2.75rem] shrink-0 items-center justify-center text-2xl font-bold leading-none tabular-nums text-[var(--card-foreground)]">
                      {idx < 3 ? medal(idx + 1) : `${idx + 1}`}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-base font-semibold text-[var(--card-foreground)]">
                      {r.name}
                    </span>
                    <span className="text-base text-[var(--card-muted)]">|</span>
                    <span className="text-base font-medium text-[var(--card-muted)]">
                      {formatKoreanTime(r.time)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

    </div>
  );
}

