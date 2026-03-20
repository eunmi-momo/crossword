"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GeneratedCrossword, PlacedPuzzleItem } from "@/lib/generatePuzzle";
import {
  bustPuzzlePrefetch,
  getPrefetchedPuzzle,
  prefetchTodayPuzzle,
} from "@/lib/puzzlePrefetch";

type CellKey = `${number},${number}`;

const CHOSEONG = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
] as const;

function getChoseong(ch: string): string | null {
  if (!ch) return null;
  const code = ch.codePointAt(0);
  if (code == null) return null;
  // Hangul syllables: AC00–D7A3
  if (code < 0xac00 || code > 0xd7a3) return null;
  const idx = Math.floor((code - 0xac00) / 588);
  return CHOSEONG[idx] ?? null;
}

function todayKST(): string {
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  return fmt.format(new Date());
}

function todayKSTYmd(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // yyyy-mm-dd
}

function formatTimer(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function CrosswordGamePage() {
  const router = useRouter();
  const [query, setQuery] = useState<{
    name?: string;
    promptName?: string;
  }>({});

  const nameFromQuery = query.name;
  const promptNameFromQuery = query.promptName;
  const [loading, setLoading] = useState(() => {
    const day = todayKSTYmd();
    return getPrefetchedPuzzle(day) == null;
  });
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GeneratedCrossword | null>(() => {
    const day = todayKSTYmd();
    return getPrefetchedPuzzle(day);
  });
  const bustFirstPuzzleLoadRef = useRef(false);

  const [phase, setPhase] = useState<"start" | "playing" | "complete">("start");
  const [timeSec, setTimeSec] = useState(0);
  const [saved, setSaved] = useState(false);
  const [timerFrozen, setTimerFrozen] = useState(false);
  const [myRank, setMyRank] = useState<number | null>(null);

  const [activeId, setActiveId] = useState<number | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const [inputs, setInputs] = useState<Record<CellKey, string>>({});

  const inputRefs = useRef<Record<CellKey, HTMLInputElement | null>>({});
  const clueRefs = useRef<Record<number, HTMLLIElement | null>>({});
  const lastEditedCellRef = useRef<{ r: number; c: number } | null>(null);
  const lastClickedCellRef = useRef<string | null>(null);
  const skipNextFocusRef = useRef(false);
  const rankingSaveStartedRef = useRef(false);

  useEffect(() => {
    activeIdRef.current = activeId;
    if (activeId != null) {
      const el = clueRefs.current[activeId];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeId]);

  const isInteractive = phase === "playing";

  // URL 쿼리 파싱: useSearchParams 대신 suspense 이슈를 피하기 위해 직접 읽습니다.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const name = sp.get("name") ?? undefined;
    const promptName = sp.get("promptName") ?? undefined;
    setQuery({ name, promptName });
    if (sp.get("newpuzzle") === "1") bustFirstPuzzleLoadRef.current = true;
  }, []);

  async function loadPuzzle(options?: { background?: boolean; bust?: boolean }) {
    const background = options?.background ?? false;
    const bust = options?.bust ?? false;
    try {
      if (!background) setLoading(true);
      setError(null);
      if (bust) bustPuzzlePrefetch();
      const day = todayKSTYmd();
      const puzzle = await prefetchTodayPuzzle(day);
      setData(puzzle);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
      bustPuzzlePrefetch();
    } finally {
      if (!background) setLoading(false);
    }
  }

  // 페이지 진입 시: 미리 받아 둔 캐시(메인·레이아웃) 있으면 네트워크 대기 없이 표시
  useEffect(() => {
    if (phase !== "start") return;
    setSaved(false);
    setPhase("playing");
    const bust = bustFirstPuzzleLoadRef.current;
    bustFirstPuzzleLoadRef.current = false;
    const day = todayKSTYmd();
    if (!bust && getPrefetchedPuzzle(day)) {
      setData(getPrefetchedPuzzle(day)!);
      setLoading(false);
      return;
    }
    void loadPuzzle({ background: false, bust });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 타이머: playing 동안만 1초 증가 (정답 완성 시 멈춤)
  useEffect(() => {
    if (phase !== "playing" || timerFrozen) return;
    const id = window.setInterval(() => setTimeSec((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase, timerFrozen]);

  const grid = data?.grid ?? null;
  const words = data?.words ?? null;

  const size = useMemo(() => {
    if (!grid) return { width: 0, height: 0 };
    return { height: grid.length, width: grid[0]?.length ?? 0 };
  }, [grid]);

  // placements에 id/number를 부여: 가로 1,2,3... / 세로 1,2,3... 독립 순차 번호
  const placements = useMemo(() => {
    if (!words || !grid) return [] as Array<PlacedPuzzleItem & { id: number; number: number }>;

    const withId = words.map((w, i) => ({ ...w, id: i + 1, number: 0 }));

    const acrossWords = withId
      .filter((w) => w.direction === "across")
      .sort((a, b) => (a.row - b.row) || (a.col - b.col));
    acrossWords.forEach((w, i) => { w.number = i + 1; });

    const downWords = withId
      .filter((w) => w.direction === "down")
      .sort((a, b) => (a.row - b.row) || (a.col - b.col));
    downWords.forEach((w, i) => { w.number = i + 1; });

    return withId;
  }, [words, grid]);

  // 각 문항의 "첫 글자(시작 칸)"에만 초성 힌트 표시
  const startCellChoseong = useMemo(() => {
    const m = new Map<CellKey, string>();
    for (const p of placements) {
      const k = `${p.row},${p.col}` as CellKey;
      const ch = p.word?.[0] ?? "";
      const cs = getChoseong(ch);
      if (cs) m.set(k, cs);
    }
    return m;
  }, [placements]);

  const numbersGrid = useMemo(() => {
    if (!grid) return null as ({ across?: number; down?: number } | null)[][] | null;
    const nums: ({ across?: number; down?: number } | null)[][] = Array.from(
      { length: size.height },
      () => Array.from({ length: size.width }, () => null)
    );
    for (const p of placements) {
      if (!p.number) continue;
      const cell = nums[p.row]![p.col] ?? {};
      if (p.direction === "across") cell.across = p.number;
      else cell.down = p.number;
      nums[p.row]![p.col] = cell;
    }
    return nums;
  }, [grid, placements, size.height, size.width]);

  const acrossList = useMemo(
    () =>
      placements.filter((p) => p.direction === "across").sort((a, b) => a.number - b.number),
    [placements]
  );
  const downList = useMemo(
    () =>
      placements.filter((p) => p.direction === "down").sort((a, b) => a.number - b.number),
    [placements]
  );


  const solution = useMemo(() => {
    if (!grid) return new Map<CellKey, string>();
    const m = new Map<CellKey, string>();
    for (let r = 0; r < size.height; r++) {
      for (let c = 0; c < size.width; c++) {
        const ch = grid[r]![c];
        if (ch && ch !== "") m.set(`${r},${c}`, ch.normalize("NFC"));
      }
    }
    return m;
  }, [grid, size.height, size.width]);

  const activePlacement = useMemo(() => {
    if (!placements.length || activeId == null) return null;
    return placements.find((p) => p.id === activeId) ?? null;
  }, [placements, activeId]);

  const activeCells: Set<CellKey> = useMemo(() => {
    const s = new Set<CellKey>();
    if (!activePlacement) return s;
    for (let i = 0; i < activePlacement.word.length; i++) {
      const r =
        activePlacement.direction === "across" ? activePlacement.row : activePlacement.row + i;
      const c =
        activePlacement.direction === "across" ? activePlacement.col + i : activePlacement.col;
      s.add(`${r},${c}`);
    }
    return s;
  }, [activePlacement]);

  const allCorrect = useMemo(() => {
    if (!grid) return false;
    for (const [k, ch] of solution.entries()) {
      if ((inputs[k] ?? "").normalize("NFC") !== ch) return false;
    }
    return solution.size > 0;
  }, [grid, solution, inputs]);


  useEffect(() => {
    if (phase !== "playing") return;
    if (!allCorrect) return;
    if (rankingSaveStartedRef.current) return;
    rankingSaveStartedRef.current = true;
    setTimerFrozen(true);
    setPhase("complete");
    void autoSaveRanking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCorrect, phase]);

  async function autoSaveRanking() {
    const playerName = (nameFromQuery ?? "").trim();
    if (!playerName) {
      setMyRank(null);
      setSaved(true);
      return;
    }
    try {
      const payload = {
        name: playerName.slice(0, 20),
        time: timeSec,
        date: todayKSTYmd(),
      };
      const res = await fetch("/api/ranking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok?: true; error?: string; rank?: number };
      if (!res.ok) throw new Error(json?.error ?? "기록 저장에 실패했습니다.");
      setSaved(true);
      setMyRank(json.rank ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "기록 저장에 실패했습니다.");
      setSaved(true);
    }
  }

  function focusCell(r: number, c: number) {
    const key = `${r},${c}` as CellKey;
    const el = inputRefs.current[key];
    if (el) el.focus();
  }

  /** NFC 기준 한 글자. NFD "속"(ㅅ+ㅗ+ㄱ)을 "속" 하나로 취급 */
  function lastNfcChar(value: string): string {
    const nfc = (value ?? "").trim().normalize("NFC");
    if (!nfc) return "";
    return nfc.slice(-1);
  }

  function getPreferredPlacementForCell(r: number, c: number) {
    const candidates = placements.filter((p) => {
      for (let i = 0; i < p.word.length; i++) {
        const pr = p.direction === "across" ? p.row : p.row + i;
        const pc = p.direction === "across" ? p.col + i : p.col;
        if (pr === r && pc === c) return true;
      }
      return false;
    });
    const pick =
      candidates.find((p) => p.direction === "across") ?? candidates[0] ?? null;
    return { candidates, pick };
  }

  function setActivePlacementForCell(r: number, c: number) {
    if (skipNextFocusRef.current) {
      skipNextFocusRef.current = false;
      return;
    }
    const { candidates, pick } = getPreferredPlacementForCell(r, c);
    const currentId = activeIdRef.current;
    if (currentId != null && candidates.some((p) => p.id === currentId)) return;
    if (pick != null) {
      activeIdRef.current = pick.id;
      setActiveId(pick.id);
    }
  }

  function handleCellChange(r: number, c: number, value: string) {
    const key = `${r},${c}` as CellKey;
    const next = lastNfcChar(value);

    const currentVal = inputs[key] ?? "";
    const expected = solution.get(key);

    // 빈 값으로 정답 칸을 덮어쓰지 않기
    if (!next && expected && currentVal.normalize("NFC") === expected.normalize("NFC")) {
      return;
    }

    lastEditedCellRef.current = { r, c };
    setInputs((prev) => ({ ...prev, [key]: next }));
  }

  // inputs가 바뀔 때마다 정답 체크 → 맞으면 다음 칸으로 포커스 이동
  useEffect(() => {
    if (!isInteractive) return;
    const cell = lastEditedCellRef.current;
    if (!cell) return;

    const key = `${cell.r},${cell.c}` as CellKey;

    const v = (inputs[key] ?? "").normalize("NFC");
    const expected = (solution.get(key) ?? "").normalize("NFC");
    if (!v || !expected || v !== expected) return;

    // 현재 활성 문항이 이 칸을 포함하면 그 방향 우선 (세로 문제면 아래로 이동)
    const { candidates } = getPreferredPlacementForCell(cell.r, cell.c);
    const currentId = activeIdRef.current;
    const placement =
      candidates.find((p) => p.id === currentId) ?? candidates[0] ?? null;
    if (!placement) return;
    const idx =
      placement.direction === "across"
        ? cell.c - placement.col
        : cell.r - placement.row;
    if (idx < 0 || idx >= placement.word.length - 1) return;

    const nr =
      placement.direction === "across"
        ? placement.row
        : placement.row + idx + 1;
    const nc =
      placement.direction === "across"
        ? placement.col + idx + 1
        : placement.col;

    lastEditedCellRef.current = null;
    setTimeout(() => focusCell(nr, nc), 0);
  }, [inputs, isInteractive, placements, solution]);

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    r: number,
    c: number
  ) {
    const key = `${r},${c}` as CellKey;
    if (e.key === "Backspace" && !(inputs[key] ?? "")) {
      const placement =
        getPreferredPlacementForCell(r, c).pick ??
        placements.find((p) => p.id === (activeIdRef.current ?? activeId)) ??
        activePlacement;
      if (!placement) return;
      const idx =
        placement.direction === "across" ? c - placement.col : r - placement.row;
      const prevIdx = idx - 1;
      if (prevIdx >= 0) {
        const pr =
          placement.direction === "across" ? placement.row : placement.row + prevIdx;
        const pc =
          placement.direction === "across" ? placement.col + prevIdx : placement.col;
        focusCell(pr, pc);
      }
    }
  }

  function choosePlacement(p: (PlacedPuzzleItem & { id: number; number: number })) {
    if (!isInteractive) return;
    activeIdRef.current = p.id;
    setActiveId(p.id);
    focusCell(p.row, p.col);
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <div className="text-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo/sbsnews.svg" alt="SBS NEWS" className="h-6 sm:h-7" />
          </div>
          <div className="mt-4 text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-[var(--primary)] sm:text-base">
              오늘의 챌린지
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
              SBS 뉴스 크로스워드
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              단 5분, 게임처럼 즐기다 보면 어느새 상식 마스터!
            </p>
          </div>
        </header>

        {loading && (
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-8 text-center text-[var(--card-muted)]">
            오늘의 퍼즐 생성 중...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-red-200 bg-[var(--card)] p-6 text-red-600 dark:border-red-800 dark:text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && grid && numbersGrid && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-stretch lg:h-[calc(100vh-240px)] overflow-hidden">
            {/* Left: Grid */}
            <div className="lg:h-full lg:overflow-hidden lg:flex lg:flex-col">
              <div className="mb-2 flex h-8 items-center">
                {phase === "playing" ? (
                  <div className="inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-4 py-1.5 text-sm font-bold text-white shadow-sm">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="13" r="8" />
                      <path d="M12 13l3-2" />
                      <path d="M9 3h6" />
                    </svg>
                    {formatTimer(timeSec)}
                  </div>
                ) : <span className="text-sm">&nbsp;</span>}
              </div>
              <section className="relative rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm sm:p-6 lg:flex-1 lg:min-h-0 lg:flex lg:items-center lg:justify-center lg:overflow-hidden">
                {/* 격자: 카드 내부에 맞춤. 정사각형 유지. */}
                <div className="mx-auto w-full aspect-square max-w-[min(100%,calc(var(--cell-size)*10+3px*11))]">
                  <div
                    className="grid h-full w-full gap-[3px] bg-white p-[3px] rounded-lg"
                    style={{
                      gridTemplateColumns: `repeat(${size.width}, 1fr)`,
                      gridTemplateRows: `repeat(${size.height}, 1fr)`,
                    }}
                  >
                    {Array.from({ length: size.height }).map((_, r) =>
                      Array.from({ length: size.width }).map((__, c) => {
                        const ch = grid[r]![c];
                        const key = `${r},${c}` as CellKey;
                        const filled = inputs[key] ?? "";
                        const filledNfc = filled.normalize("NFC");
                        const expectedNfc = (ch ?? "").normalize("NFC");
                        const correct = expectedNfc !== "" && filledNfc === expectedNfc;
                        const wrong = expectedNfc !== "" && filledNfc !== "" && filledNfc !== expectedNfc;
                        const isActive = activeCells.has(key);
                        const num = numbersGrid[r]![c];
                        const isBlocked = !ch;

                        return (
                          <div
                            key={key}
                            className={[
                            "relative h-full w-full rounded-md border text-sm",
                              isBlocked
                                ? "border-zinc-400 bg-zinc-400"
                                : "border-zinc-200 bg-white",
                              isActive && !isBlocked ? "ring-2 ring-blue-500" : "",
                              correct && !isBlocked ? "bg-[var(--primary)]/15 text-[var(--card-foreground)]" : "",
                              wrong && !isBlocked ? "bg-red-100 border-red-400" : "",
                            ].join(" ")}
                            onClick={() => {
                              if (isBlocked) return;
                              if (!isInteractive) return;
                              const { candidates } = getPreferredPlacementForCell(r, c);
                              const cellKey = `${r},${c}`;
                              const isSameCell = lastClickedCellRef.current === cellKey;
                              lastClickedCellRef.current = cellKey;
                              let pick;
                              if (isSameCell && candidates.length > 1) {
                                const currentId = activeIdRef.current;
                                pick = candidates.find((p) => p.id !== currentId) ?? candidates[0];
                              } else {
                                pick = candidates.find((p) => p.direction === "across") ?? candidates[0];
                              }
                              if (pick) {
                                activeIdRef.current = pick.id;
                                setActiveId(pick.id);
                              }
                              skipNextFocusRef.current = true;
                              focusCell(r, c);
                            }}
                          >
                            {num != null && !isBlocked && (
                              <span className="absolute left-[2px] top-[1px] flex flex-col text-[9px] font-bold leading-[1.15] text-[var(--card-muted)] sm:text-[10px]">
                                {num.across != null && <span>{num.across}</span>}
                                {num.down != null && <span>{num.down}</span>}
                              </span>
                            )}
                            {!isBlocked && !filled && startCellChoseong.has(key) && (
                              <span className="pointer-events-none absolute inset-0 grid place-items-center text-lg font-extrabold text-zinc-300">
                                {startCellChoseong.get(key) ?? ""}
                              </span>
                            )}
                            {!isBlocked && (
                              <input
                                ref={(el) => {
                                  inputRefs.current[key] = el;
                                }}
                                value={filled}
                                onFocus={() => setActivePlacementForCell(r, c)}
                                onChange={(e) => handleCellChange(r, c, e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, r, c)}
                                inputMode="text"
                                className={[
                                  "h-full w-full border-0 p-0 rounded-md bg-transparent text-center text-lg font-semibold outline-none",
                                  "leading-none",
                                  wrong ? "text-red-600" : "text-[var(--card-foreground)]",
                                  !isInteractive ? "cursor-not-allowed opacity-60" : "",
                                  "caret-[var(--primary)]",
                                ].join(" ")}
                                disabled={!isInteractive}
                              />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </section>
            </div>

            {/* Right: Clues (2 columns: across / down) */}
            <div className="lg:h-full lg:overflow-hidden lg:flex lg:flex-col">
              <div className="mb-2 flex h-8 items-end justify-end">
                <p className="text-sm font-semibold text-[var(--muted)]">{todayKST()}</p>
              </div>
              <aside className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm sm:p-6 lg:flex-1 lg:min-h-0 lg:overflow-hidden">
              <div className="grid h-full min-h-0 gap-6 sm:grid-cols-2">
                {([
                  { key: "across", title: "가로 문항", list: acrossList },
                  { key: "down", title: "세로 문항", list: downList },
                ] as const).map((col) => (
                  <div key={col.key} className="flex min-h-0 flex-col">
                    <h3 className="mb-3 text-sm font-extrabold text-[var(--card-foreground)]">
                      {col.title}
                    </h3>
                    <ul className="flex-1 min-h-0 space-y-3 overflow-auto pr-1">
                      {col.list.map((p) => {
                        const active = p.id === activeId;
                        return (
                          <li
                            key={p.id}
                            ref={(el) => { clueRefs.current[p.id] = el; }}
                            className={[
                              "rounded-2xl border px-4 py-4 transition",
                              active
                                ? "border-[var(--primary)] bg-[var(--primary)]/10"
                                : "border-[var(--card-border)] bg-[var(--card)] hover:bg-[#5055fa]/10",
                            ].join(" ")}
                          >
                            <button
                              className="w-full text-left"
                              onClick={() => choosePlacement(p)}
                              type="button"
                            >
                              <div className="text-[11px] font-extrabold text-[var(--card-muted)]">
                                {p.number}
                              </div>
                              <div className="mt-1 text-sm font-bold text-[var(--card-foreground)]">
                                {p.definition}
                              </div>
                              <div className="mt-2 text-sm text-[var(--card-muted)]">
                                {p.hint}
                              </div>
                            </button>
                            <div className="mt-3">
                              <a
                                href={p.link}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center rounded-full border border-[var(--card-border)] px-3 py-2 text-xs font-semibold text-[var(--card-foreground)] hover:bg-[#5055fa]/10"
                              >
                                힌트 보기
                              </a>
                            </div>
                          </li>
                        );
                      })}
                      {col.list.length === 0 && (
                        <li className="text-sm text-[var(--card-muted)]">문항이 없습니다.</li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </aside>
            </div>
          </div>
        )}

        {/* Complete overlay */}
        {phase === "complete" && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6">
            <div className="w-full max-w-sm rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-8 shadow-xl text-center">
              <h2 className="text-3xl font-extrabold text-[var(--card-foreground)]">
                축하합니다!
              </h2>
              <p className="mt-2 text-lg font-bold text-[var(--card-foreground)]">
                모든 크로스워드를 맞췄습니다.
              </p>

              <p className="mt-5 text-sm text-[var(--card-muted)]">
                당신의 실력에 박수를 보냅니다!
              </p>

              {(nameFromQuery ?? "").trim() ? (
                !saved ? (
                  <p className="mt-4 text-sm text-[var(--card-muted)]">
                    순위를 불러오는 중…
                  </p>
                ) : myRank != null ? (
                  <div className="mt-4 rounded-xl bg-[var(--primary)]/10 px-6 py-4">
                    <p className="text-sm text-[var(--card-muted)]">당신의 순위</p>
                    <p className="mt-1 text-3xl font-extrabold text-[var(--primary)]">
                      {myRank}위
                    </p>
                    <p className="mt-1 text-sm text-[var(--card-muted)]">
                      소요시간: {formatTimer(timeSec)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-[var(--card-muted)]">
                    소요시간: {formatTimer(timeSec)}
                  </p>
                )
              ) : (
                <p className="mt-4 text-sm text-[var(--card-muted)]">
                  소요시간: {formatTimer(timeSec)}
                </p>
              )}

              <div className="mt-6 grid gap-3">
                <button
                  type="button"
                  className="w-full rounded-full bg-[var(--primary)] px-4 py-3 text-sm font-bold text-white shadow-md hover:opacity-90"
                  onClick={() => router.push("/")}
                >
                  오늘의 랭킹 보기
                </button>
                <button
                  type="button"
                  className="w-full rounded-full border border-[var(--card-border)] bg-transparent px-4 py-3 text-sm font-semibold text-[var(--card-foreground)] hover:bg-[#5055fa]/10"
                  onClick={() => {
                    setInputs({});
                    activeIdRef.current = null;
                    setActiveId(null);
                    lastClickedCellRef.current = null;
                    setError(null);
                    setTimeSec(0);
                    setTimerFrozen(false);
                    setSaved(false);
                    setMyRank(null);
                    rankingSaveStartedRef.current = false;
                    setPhase("playing");
                  }}
                >
                  다시 풀기
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

