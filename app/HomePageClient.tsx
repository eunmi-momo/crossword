"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { withBasePath } from "@/lib/basePath";
import { prefetchTodayPuzzle } from "@/lib/puzzlePrefetch";
import { CrosswordBrandLogo } from "@/components/home/CrosswordBrandLogo";
import { MiniBoardIllustration } from "@/components/home/MiniBoardIllustration";

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

export default function HomePageClient() {
  const router = useRouter();
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(() => todayKSTYmd(), []);
  const [nameDraft, setNameDraft] = useState("");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [startModalName, setStartModalName] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg(null);
      toastTimerRef.current = null;
    }, 3200);
  }, []);

  const attemptStart = useCallback(() => {
    const n = nameDraft.trim();
    if (!n) {
      showToast("이름을 먼저 입력해 주세요!");
      return;
    }
    setStartModalName(n);
  }, [nameDraft, showToast]);

  const confirmStart = useCallback(() => {
    if (!startModalName) return;
    const n = startModalName;
    setStartModalName(null);
    router.push(`/game?name=${encodeURIComponent(n)}`);
  }, [startModalName, router]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!startModalName) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmStart();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startModalName, confirmStart]);

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
    <div className="home-shell relative min-h-screen overflow-x-hidden text-white">
      {/* 시작 확인 모달 */}
      {startModalName ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            className="glass-modal-backdrop"
            role="presentation"
            onClick={() => setStartModalName(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-start-modal-title"
            className="glass-modal-panel p-6 sm:p-8"
          >
            <p
              id="home-start-modal-title"
              className="text-base font-bold leading-relaxed text-neutral-900 sm:text-lg"
            >
              {startModalName}님, 퀴즈를 시작합니다! 🎉
            </p>
            <button
              type="button"
              className="home-cta-btn mt-6 inline-flex w-full items-center justify-center rounded-full px-8 py-4 text-base font-bold text-slate-900 shadow-lg transition sm:py-[1.1rem] sm:text-lg"
              onClick={confirmStart}
            >
              확인
            </button>
          </div>
        </div>
      ) : null}

      {/* 하단 토스트 (이름 미입력 안내) */}
      {toastMsg ? (
        <div
          className="home-toast pointer-events-none fixed bottom-6 left-1/2 z-[90] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 px-2"
          role="status"
          aria-live="polite"
        >
          <div className="home-toast-inner glass-popup-surface rounded-xl px-4 py-3 text-center text-sm font-semibold text-black sm:text-base">
            {toastMsg}
          </div>
        </div>
      ) : null}

      {/* 그라디언트 + 블롭 배경 */}
      <div className="home-bg-gradient pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="home-blobs pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="home-blob home-blob--1" />
        <div className="home-blob home-blob--2" />
        <div className="home-blob home-blob--3" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-lg px-4 pb-12 pt-2 sm:max-w-xl sm:px-6 sm:pb-16 sm:pt-4">
        {/* SBS NEWS 로고 (게임 페이지와 동일) */}
        <header className="mb-3 sm:mb-4">
          <a
            href="https://news.sbs.co.kr"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
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

        {/* 메인 글래스 카드 */}
        <section className="glass-card-main group relative rounded-[1.75rem] border border-white/20 bg-white/10 px-5 py-6 text-center shadow-[0_25px_80px_rgba(15,23,42,0.35)] backdrop-blur-xl sm:px-10 sm:py-8">
          <p className="home-challenge-title text-xl font-extrabold tracking-tight sm:text-2xl">
            오늘의 챌린지
          </p>

          <div className="relative mx-auto mt-5 w-max max-w-full sm:mt-6">
            <span className="home-sparkle home-sparkle--green absolute -left-2 top-0 text-lg sm:-left-5 sm:text-xl">
              ✦
            </span>
            <span className="home-sparkle home-sparkle--white absolute -right-1 top-1/3 text-base sm:-right-4 sm:text-lg">
              ✦
            </span>
            <span className="home-sparkle home-sparkle--violet absolute bottom-2 -left-3 text-base sm:-left-6 sm:text-lg">
              ✦
            </span>
            <CrosswordBrandLogo />
          </div>

          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-white/55 sm:mt-5 sm:text-[0.95rem]">
            단 5분, 게임처럼 즐기다 보면 어느새 시사 상식 마스터!
          </p>

          <MiniBoardIllustration />

          <div className="mx-auto mt-6 flex w-full max-w-sm flex-col items-center gap-3 sm:mt-7 sm:gap-4">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onFocus={warmPuzzle}
              placeholder="이름을 입력하세요"
              className="home-name-input w-full rounded-full border border-white/25 bg-white/10 px-5 py-3.5 text-center text-sm text-white shadow-inner outline-none transition placeholder:text-white/45 focus:border-emerald-400/90 focus:bg-white/15 focus:shadow-[0_0_24px_rgba(52,211,153,0.35)] sm:py-4 sm:text-base"
              maxLength={20}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  attemptStart();
                }
              }}
            />
            <button
              type="button"
              className="home-cta-btn inline-flex w-full items-center justify-center rounded-full px-8 py-4 text-base font-bold text-slate-900 shadow-lg transition sm:py-[1.1rem] sm:text-lg"
              onMouseEnter={warmPuzzle}
              onFocus={warmPuzzle}
              onClick={attemptStart}
            >
              오늘의 퀴즈 도전하기
            </button>
          </div>
        </section>

        {/* 랭킹 글래스 카드 */}
        <aside className="glass-card-rank mt-4 rounded-[1.75rem] border border-white/18 bg-white/[0.08] p-5 shadow-[0_20px_60px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:mt-5 sm:p-8">
          <h3 className="home-challenge-title text-center text-xl font-extrabold tracking-tight sm:text-2xl">
            오늘의 랭킹
          </h3>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-400/35 bg-red-500/10 p-4 text-sm text-red-100">
              {error}
            </div>
          )}

          <div className="mt-6">
            {rows.length === 0 ? (
              <div className="py-6 text-center text-sm text-white/50">
                오늘의 첫 번째 도전자가 되어주세요!
              </div>
            ) : (
              <ul className="divide-y divide-white/10">
                {rows.map((r, idx) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="flex h-10 min-w-[2.75rem] shrink-0 items-center justify-center text-2xl font-bold leading-none tabular-nums">
                      {idx < 3 ? medal(idx + 1) : `${idx + 1}`}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-base font-semibold text-white/95">
                      {r.name}
                    </span>
                    <span className="text-base text-white/35">|</span>
                    <span className="text-base font-medium tabular-nums text-white/65">
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
