"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { GeneratedCrossword, PlacedPuzzleItem } from "@/lib/generatePuzzle";
import {
  bustPuzzlePrefetch,
  getCachedOrPersistedPuzzle,
  prefetchTodayPuzzle,
} from "@/lib/puzzlePrefetch";
import { withBasePath } from "@/lib/basePath";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import { shareViaKakaoFeed } from "@/lib/kakaoShare";
import { buildShareClipboardBlock } from "@/lib/shareBrag";

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
  const pathname = usePathname();
  const [query, setQuery] = useState<{
    name?: string;
    promptName?: string;
  }>({});

  const nameFromQuery = query.name;
  const promptNameFromQuery = query.promptName;
  /** SSR·첫 페인트와 맞추고, 실제 캐시는 useLayoutEffect에서 즉시 반영(메모리·localStorage) */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GeneratedCrossword | null>(null);
  const bustFirstPuzzleLoadRef = useRef(false);

  const [phase, setPhase] = useState<"start" | "playing" | "complete">("start");
  const [timeSec, setTimeSec] = useState(0);
  const [saved, setSaved] = useState(false);
  const [timerFrozen, setTimerFrozen] = useState(false);
  const [myRank, setMyRank] = useState<number | null>(null);

  const [activeId, setActiveId] = useState<number | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const [inputs, setInputs] = useState<Record<CellKey, string>>({});
  /** rAF 안에서 최신 inputs 참조(교차 칸 정답 보존) */
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const inputRefs = useRef<Record<CellKey, HTMLInputElement | null>>({});
  /** 한글 IME 조합 중인 칸 (모바일 웹·PC 공통 안정화) */
  const composingCellKeyRef = useRef<CellKey | null>(null);
  const clueRefs = useRef<Record<number, HTMLLIElement | null>>({});
  const lastEditedCellRef = useRef<{ r: number; c: number } | null>(null);
  const lastClickedCellRef = useRef<string | null>(null);
  const skipNextFocusRef = useRef(false);
  const rankingSaveStartedRef = useRef(false);
  const [mobileAllCluesOpen, setMobileAllCluesOpen] = useState(false);

  /** 개발·디자인용: 완료 팝업만 바로 보기 (`?previewComplete=1` …) */
  const [completePreview, setCompletePreview] = useState<{
    rank: number;
    timeSec: number;
  } | null>(null);
  const [completePreviewDismissed, setCompletePreviewDismissed] = useState(false);

  /** URL 파싱 전에는 이름 유무를 모름 → 모달 깜빡임 방지 */
  const [urlHydrated, setUrlHydrated] = useState(false);
  const [nameGateDraft, setNameGateDraft] = useState("");
  const nameGateInputRef = useRef<HTMLInputElement | null>(null);
  /** 친구에게 자랑하기: URL 복사 후 버튼 위 툴팁 */
  const [bragTooltip, setBragTooltip] = useState<string | null>(null);
  /** 클립보드 API 실패 시 직접 복사용으로 표시할 URL */
  const [bragManualCopyUrl, setBragManualCopyUrl] = useState<string | null>(null);
  /** 축하 팝업 닫기(격자는 유지, phase는 complete) */
  const [completeModalDismissed, setCompleteModalDismissed] = useState(false);

  useEffect(() => {
    if (phase !== "complete") setCompleteModalDismissed(false);
  }, [phase]);

  useEffect(() => {
    activeIdRef.current = activeId;
    if (activeId == null) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const el = clueRefs.current[activeId];
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeId]);

  useEffect(() => {
    if (phase !== "playing") setMobileAllCluesOpen(false);
  }, [phase]);

  const trimmedUrlName = (nameFromQuery ?? "").trim();
  const showNameGate =
    urlHydrated &&
    !trimmedUrlName &&
    completePreview == null;

  const isInteractive = phase === "playing" && !showNameGate;

  // URL 쿼리 파싱: useSearchParams 대신 suspense 이슈를 피하기 위해 직접 읽습니다.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const rawName = sp.get("name");
    const name =
      rawName != null && rawName.trim() !== "" ? rawName.trim() : undefined;
    const rawPrompt = sp.get("promptName");
    const promptName =
      rawPrompt != null && rawPrompt.trim() !== ""
        ? rawPrompt.trim()
        : undefined;
    setQuery({ name, promptName });
    if (sp.get("newpuzzle") === "1") bustFirstPuzzleLoadRef.current = true;

    if (sp.get("previewComplete") === "1") {
      const rankRaw = sp.get("previewRank");
      const timeRaw = sp.get("previewTime");
      setCompletePreview({
        rank:
          rankRaw != null &&
          rankRaw !== "" &&
          Number.isFinite(Number(rankRaw))
            ? Number(rankRaw)
            : 3,
        timeSec:
          timeRaw != null &&
          timeRaw !== "" &&
          Number.isFinite(Number(timeRaw))
            ? Number(timeRaw)
            : 128,
      });
    } else {
      setCompletePreview(null);
    }
    setUrlHydrated(true);
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

  // 페이지 진입 시: 메모리 프리페치·localStorage(재방문) 있으면 첫 페인트 전에 반영
  useLayoutEffect(() => {
    if (phase !== "start") return;
    setSaved(false);
    setPhase("playing");
    const bust = bustFirstPuzzleLoadRef.current;
    bustFirstPuzzleLoadRef.current = false;
    const day = todayKSTYmd();
    if (!bust) {
      const cached = getCachedOrPersistedPuzzle(day);
      if (cached) {
        setData(cached);
        setLoading(false);
        return;
      }
    }
    void loadPuzzle({ background: false, bust });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 타이머: playing 동안만 1초 증가 (정답 완성 시 멈춤). 이름 입력 모달이 떠 있으면 대기.
  useEffect(() => {
    if (phase !== "playing" || timerFrozen || showNameGate) return;
    const id = window.setInterval(() => setTimeSec((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase, timerFrozen, showNameGate]);

  useEffect(() => {
    if (!urlHydrated || trimmedUrlName) return;
    if (promptNameFromQuery) setNameGateDraft(promptNameFromQuery);
  }, [urlHydrated, trimmedUrlName, promptNameFromQuery]);

  useEffect(() => {
    if (!showNameGate) return;
    const id = requestAnimationFrame(() => nameGateInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [showNameGate]);

  useEffect(() => {
    if (!bragTooltip) return;
    const ms = bragManualCopyUrl ? 12000 : 2200;
    const t = window.setTimeout(() => {
      setBragTooltip(null);
      setBragManualCopyUrl(null);
    }, ms);
    return () => window.clearTimeout(t);
  }, [bragTooltip, bragManualCopyUrl]);

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

  // 완료 팝업만 바로 보기: `?previewComplete=1` (+ 선택 `&name=`, `&previewRank=`, `&previewTime=초`)
  useEffect(() => {
    if (completePreview == null || completePreviewDismissed) return;
    if (loading || !data || !grid || !numbersGrid) return;
    setPhase("complete");
    setTimeSec(completePreview.timeSec);
    setTimerFrozen(true);
    setSaved(true);
    const hasName = (nameFromQuery ?? "").trim().length > 0;
    setMyRank(hasName ? completePreview.rank : null);
    rankingSaveStartedRef.current = true;
  }, [
    completePreview,
    completePreviewDismissed,
    loading,
    data,
    grid,
    numbersGrid,
    nameFromQuery,
  ]);

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
      const res = await fetch(withBasePath("/api/ranking"), {
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

  /**
   * 다음 칸 포커스 직후 DOM/state 정리 (교차 정답 보존·유령 입력 제거).
   * 조합 중에는 유령 제거·복제 제거를 하지 않고 compositionend 후 한 번 더 실행.
   */
  function syncCellAfterAutoAdvance(nextKey: CellKey, dupOf: string) {
    const el2 = inputRefs.current[nextKey];
    if (!el2) return;

    const expected = (solution.get(nextKey) ?? "").normalize("NFC");
    const stateVal = (inputsRef.current[nextKey] ?? "").normalize("NFC");
    const dom = el2.value.normalize("NFC");
    const composingHere = composingCellKeyRef.current === nextKey;

    if (expected && stateVal === expected) {
      if (dom !== stateVal) {
        el2.value = inputsRef.current[nextKey] ?? "";
      }
      return;
    }

    // 교차: DOM은 정답인데 state만 어긋남 — DOM은 건드리지 않고 state만 맞춤
    if (expected && dom === expected && stateVal !== expected) {
      setInputs((prev) => ({ ...prev, [nextKey]: expected }));
      return;
    }

    if (composingHere) {
      // 부분 조합(ㄱ·ㅏ…)이 dom에 있을 수 있어 유령 제거·복제 제거는 하지 않음
      el2.addEventListener(
        "compositionend",
        () => {
          queueMicrotask(() => syncCellAfterAutoAdvance(nextKey, dupOf));
        },
        { once: true }
      );
      return;
    }

    // 이전 칸 글자가 교차칸에만 잘못 복제된 경우. 빈 칸으로 만들면 세로 등으로 이미 맞춘 정답까지 지워짐 → 정답이 있으면 expected로 복구
    if (
      dupOf &&
      stateVal === dupOf &&
      expected &&
      stateVal !== expected
    ) {
      setInputs((prev) => ({ ...prev, [nextKey]: expected }));
      el2.value = expected;
      return;
    }

    if (!stateVal && dom) {
      if (dupOf && dom === dupOf && expected && dom !== expected) {
        setInputs((prev) => ({ ...prev, [nextKey]: expected }));
        el2.value = expected;
        return;
      }
      el2.value = "";
      setInputs((prev) => {
        const p = (prev[nextKey] ?? "").normalize("NFC");
        if (p === dom) {
          return { ...prev, [nextKey]: "" };
        }
        return prev;
      });
    }
  }

  /**
   * 정답 입력 후 다음 칸으로 이동.
   * rAF 두 번 + microtask로 모바일 키보드/레이아웃 반영 후 동기화.
   */
  function focusCellAfterAutoAdvance(
    nr: number,
    nc: number,
    justTypedChar: string
  ) {
    const nextKey = `${nr},${nc}` as CellKey;
    lastEditedCellRef.current = null;
    const dupOf = justTypedChar.normalize("NFC");

    requestAnimationFrame(() => {
      const el = inputRefs.current[nextKey];
      if (el) {
        el.focus({ preventScroll: false });
      }
      requestAnimationFrame(() => {
        queueMicrotask(() => {
          syncCellAfterAutoAdvance(nextKey, dupOf);
        });
      });
    });
  }

  /** 정답 칸이 채워졌을 때 다음 칸으로 자동 이동 (조합 중이면 compositionend 후) */
  function advanceFocusAfterCorrectCell(cell: { r: number; c: number }) {
    const key = `${cell.r},${cell.c}` as CellKey;
    const v = (inputsRef.current[key] ?? "").normalize("NFC");
    const expected = (solution.get(key) ?? "").normalize("NFC");
    if (!v || !expected || v !== expected) return;

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
    focusCellAfterAutoAdvance(nr, nc, v);
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

    lastEditedCellRef.current = { r, c };
    setInputs((prev) => ({ ...prev, [key]: next }));
  }

  // inputs가 바뀔 때마다 정답 체크 → 맞으면 다음 칸으로 포커스 이동
  useEffect(() => {
    if (!isInteractive) return;
    const cell = lastEditedCellRef.current;
    if (!cell) return;
    advanceFocusAfterCorrectCell(cell);
  }, [inputs, isInteractive, placements, solution]);

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    r: number,
    c: number
  ) {
    const nk = e.nativeEvent as KeyboardEvent;
    if (nk.isComposing || e.keyCode === 229) return;
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

  /** 모바일 하단 문항 시트 닫기 + 선택 해제 */
  function closeMobileClueSheet() {
    activeIdRef.current = null;
    setActiveId(null);
    lastClickedCellRef.current = null;
  }

  function commitGameNameGate() {
    const n = nameGateDraft.trim();
    if (!n) return;
    const sp = new URLSearchParams(window.location.search);
    sp.set("name", n);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    setQuery((prev) => ({ ...prev, name: n }));
    const day = todayKSTYmd();
    void prefetchTodayPuzzle(day);
  }

  async function handleBragShareCopyUrl() {
    const timeMmSs = formatTimer(timeSec);
    const clipboardText = buildShareClipboardBlock({
      rank: myRank,
      timeMmSs,
    });
    setBragManualCopyUrl(null);

    const result = await copyTextToClipboard(clipboardText);
    if (result === "failed") {
      setBragManualCopyUrl(clipboardText);
      setBragTooltip("아래를 길게 눌러 직접 복사해 주세요.");
    } else {
      setBragTooltip("메시지와 링크가 복사되었습니다");
    }
  }

  async function handleKakaoShare() {
    try {
      setBragManualCopyUrl(null);
      await shareViaKakaoFeed({
        rank: myRank,
        timeMmSs: formatTimer(timeSec),
      });
      setBragTooltip("카카오톡 공유창이 열렸습니다");
    } catch (e) {
      setBragTooltip(
        e instanceof Error ? e.message : "카카오톡 공유에 실패했습니다"
      );
    }
  }

  return (
    <div className="home-shell relative min-h-screen overflow-x-hidden text-[var(--foreground)]">
      <div
        className="home-bg-gradient pointer-events-none fixed inset-0 z-0"
        aria-hidden
      />
      <div
        className="home-blobs pointer-events-none fixed inset-0 z-0 overflow-hidden"
        aria-hidden
      >
        <div className="home-blob home-blob--1" />
        <div className="home-blob home-blob--2" />
        <div className="home-blob home-blob--3" />
      </div>
      <div className="relative z-10 mx-auto w-full max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
        <header className="mb-4 sm:mb-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 shrink-0 text-left">
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
            </div>
            <Link
              href="/"
              className="shrink-0 rounded-full border border-white/35 bg-white/10 p-2.5 text-white shadow-sm backdrop-blur-sm transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label="홈으로"
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-5 w-5 sm:h-6 sm:w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </Link>
          </div>
          <div className="mt-4 text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-[var(--primary)] sm:text-base">
              오늘의 챌린지
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
              뉴스 크로스워드
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              단 5분, 게임처럼 즐기다 보면 어느새 상식 마스터!
            </p>
          </div>
        </header>

        {/* 이름 없이 /game 직접 진입 시: 랭킹용 이름 입력 (메인 글래스 모달과 동일) */}
        {showNameGate && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6">
            <div className="glass-modal-backdrop" aria-hidden />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="game-name-gate-title"
              className="glass-modal-panel p-6 sm:p-8"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h2
                id="game-name-gate-title"
                className="text-center text-xl font-extrabold text-neutral-900 sm:text-2xl"
              >
                게임할 준비가 되셨나요?
              </h2>
              <div className="mt-6 flex flex-col gap-3">
                <input
                  ref={nameGateInputRef}
                  value={nameGateDraft}
                  onChange={(e) => setNameGateDraft(e.target.value)}
                  onFocus={() => void prefetchTodayPuzzle(todayKSTYmd())}
                  placeholder="이름을 입력하세요"
                  maxLength={20}
                  className="home-name-input w-full rounded-full border border-neutral-300 bg-white/95 px-5 py-3.5 text-center text-sm text-neutral-900 shadow-inner outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:shadow-[0_0_24px_rgba(52,211,153,0.35)] sm:py-4 sm:text-base"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitGameNameGate();
                  }}
                />
                <button
                  type="button"
                  className="home-cta-btn inline-flex w-full items-center justify-center rounded-full px-8 py-4 text-base font-bold text-slate-900 shadow-lg transition sm:py-[1.1rem] sm:text-lg"
                  onClick={() => commitGameNameGate()}
                >
                  오늘의 퀴즈 도전하기
                </button>
              </div>
            </div>
          </div>
        )}

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
          <div
            className={[
              "grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-stretch lg:h-[calc(100vh-240px)] lg:overflow-hidden lg:pb-0",
              phase === "playing" && activePlacement != null
                ? "max-lg:pb-[min(44vh,18rem)]"
                : "max-lg:pb-28",
            ].join(" ")}
          >
            {/* Left: Grid */}
            <div className="lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden">
              <div className="mb-2 flex h-8 min-h-8 items-center gap-3">
                {phase === "playing" ? (
                  <div className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--primary)] px-4 py-1.5 text-sm font-bold text-white shadow-sm">
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
                ) : null}
                <p className="text-sm font-semibold text-[var(--muted)]">
                  {todayKST()}
                </p>
              </div>
              <section className="relative rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-2 shadow-sm sm:p-6 lg:flex lg:min-h-0 lg:flex-1 lg:items-center lg:justify-center lg:overflow-hidden">
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
                            "relative h-full w-full touch-manipulation rounded-md border text-sm",
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
                                onCompositionStart={() => {
                                  composingCellKeyRef.current = key;
                                }}
                                onCompositionEnd={() => {
                                  if (composingCellKeyRef.current === key) {
                                    composingCellKeyRef.current = null;
                                  }
                                }}
                                onChange={(e) => handleCellChange(r, c, e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, r, c)}
                                inputMode="text"
                                className={[
                                  "h-full w-full min-h-0 min-w-0 touch-manipulation rounded-md border-0 bg-transparent p-0 text-center text-base font-semibold outline-none sm:text-lg",
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

            {/* Right: Clues — 데스크톱만 표시, 모바일은 하단 시트 + 전체 문항 모달 */}
            <div className="hidden lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden">
              <div className="mb-2 h-8 min-h-8 shrink-0" aria-hidden />
              <aside className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm sm:p-6 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
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

            {/* 모바일: 선택한 문항 하단 시트 */}
            {phase === "playing" &&
              isInteractive &&
              activePlacement != null && (
                <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 lg:hidden">
                  <div
                    className="pointer-events-auto mx-auto max-w-6xl px-2"
                    style={{
                      paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))",
                    }}
                  >
                    <div className="flex max-h-[min(46vh,20rem)] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-[var(--card-border)] bg-[var(--card)] shadow-[0_-12px_40px_rgba(0,0,0,0.18)]">
                      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--card-border)] px-3 py-2.5 sm:px-4">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            className="hidden h-1 w-9 shrink-0 rounded-full bg-[var(--card-muted)]/35 sm:block"
                            aria-hidden
                          />
                          <span className="truncate text-xs font-extrabold text-[var(--primary)] sm:text-sm">
                            {activePlacement.direction === "across"
                              ? "가로"
                              : "세로"}{" "}
                            {activePlacement.number}번
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            className="rounded-full border border-[var(--card-border)] bg-[var(--card)] px-3 py-1.5 text-xs font-bold text-[var(--card-foreground)] active:bg-[#5055fa]/15"
                            onClick={() => setMobileAllCluesOpen(true)}
                          >
                            전체 문항
                          </button>
                          <button
                            type="button"
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--card-border)] bg-[var(--card)] text-[var(--card-foreground)] active:bg-[#5055fa]/15"
                            aria-label="문항 팝업 닫기"
                            onClick={closeMobileClueSheet}
                          >
                            <svg
                              aria-hidden
                              viewBox="0 0 24 24"
                              className="h-5 w-5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            >
                              <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
                        <p className="text-sm font-bold leading-snug text-[var(--card-foreground)] sm:text-base">
                          {activePlacement.definition}
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-[var(--card-muted)]">
                          {activePlacement.hint}
                        </p>
                        <a
                          href={activePlacement.link}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center rounded-full border border-[var(--card-border)] px-3 py-2 text-xs font-semibold text-[var(--card-foreground)] active:bg-[#5055fa]/10"
                        >
                          힌트 보기
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            {/* 모바일: 문항 미선택 시 전체 목록 열기 */}
            {phase === "playing" &&
              isInteractive &&
              activePlacement == null && (
                <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 lg:hidden pointer-events-none">
                  <button
                    type="button"
                    className="pointer-events-auto mb-[max(0.75rem,env(safe-area-inset-bottom))] rounded-full border border-[var(--card-border)] bg-[var(--card)] px-5 py-2.5 text-sm font-bold text-[var(--card-foreground)] shadow-lg active:scale-[0.98]"
                    onClick={() => setMobileAllCluesOpen(true)}
                  >
                    문항 목록
                  </button>
                </div>
              )}

            {/* 모바일: 전체 가로·세로 문항 모달 */}
            {mobileAllCluesOpen && phase === "playing" && (
              <div
                className="glass-modal-scrim fixed inset-0 z-[60] flex flex-col lg:hidden"
                role="dialog"
                aria-modal="true"
                aria-labelledby="mobile-clues-title"
              >
                <button
                  type="button"
                  className="min-h-0 flex-1 cursor-default"
                  aria-label="닫기"
                  onClick={() => setMobileAllCluesOpen(false)}
                />
                <div className="glass-modal-panel glass-modal-panel--sheet max-h-[88vh] flex shrink-0 flex-col overflow-hidden rounded-t-xl border-b-0 shadow-[0_-12px_48px_rgba(15,23,42,0.2)]">
                  <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
                    <h2
                      id="mobile-clues-title"
                      className="text-base font-extrabold text-neutral-900"
                    >
                      전체 문항
                    </h2>
                    <button
                      type="button"
                      className="rounded-full px-3 py-1.5 text-sm font-bold text-emerald-600"
                      onClick={() => setMobileAllCluesOpen(false)}
                    >
                      닫기
                    </button>
                  </div>
                  <div
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
                    style={{
                      paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
                    }}
                  >
                    <div className="grid gap-8 sm:grid-cols-2 sm:gap-6">
                      {(
                        [
                          { key: "across", title: "가로 문항", list: acrossList },
                          { key: "down", title: "세로 문항", list: downList },
                        ] as const
                      ).map((col) => (
                        <div key={col.key} className="flex flex-col">
                          <h3 className="mb-3 text-sm font-extrabold text-neutral-800">
                            {col.title}
                          </h3>
                          <ul className="space-y-3">
                            {col.list.map((p) => {
                              const active = p.id === activeId;
                              return (
                                <li
                                  key={p.id}
                                  className={[
                                    "rounded-2xl border px-3 py-3 transition sm:px-4 sm:py-4",
                                    active
                                      ? "border-emerald-400/50 bg-emerald-500/15"
                                      : "border-neutral-200 bg-neutral-50/90",
                                  ].join(" ")}
                                >
                                  <button
                                    className="w-full text-left"
                                    type="button"
                                    onClick={() => {
                                      choosePlacement(p);
                                      setMobileAllCluesOpen(false);
                                    }}
                                  >
                                    <div className="text-[11px] font-extrabold text-neutral-500">
                                      {p.number}
                                    </div>
                                    <div className="mt-1 text-sm font-bold text-neutral-900">
                                      {p.definition}
                                    </div>
                                    <div className="mt-2 text-sm text-neutral-600">
                                      {p.hint}
                                    </div>
                                  </button>
                                  <div className="mt-2">
                                    <a
                                      href={p.link}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center rounded-full border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-800"
                                    >
                                      힌트 보기
                                    </a>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Complete overlay — 글래스 모달 (메인과 동일 톤) */}
        {phase === "complete" && !completeModalDismissed && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6">
            <div className="glass-modal-backdrop" aria-hidden />
            <div className="glass-modal-panel relative max-h-[90vh] overflow-y-auto p-8 pt-10">
              <button
                type="button"
                className="absolute right-2 top-2 rounded-full p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                aria-label="닫기"
                onClick={() => setCompleteModalDismissed(true)}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
              <h2 className="text-3xl font-extrabold text-neutral-900">
                축하합니다!
              </h2>
              <p className="mt-2 text-lg font-bold text-neutral-800">
                모든 크로스워드를 맞췄습니다.
              </p>

              <p className="mt-5 text-sm text-neutral-600">
                당신의 실력에 박수를 보냅니다!
              </p>

              {(nameFromQuery ?? "").trim() ? (
                !saved ? (
                  <p className="mt-4 text-sm text-neutral-600">
                    순위를 불러오는 중…
                  </p>
                ) : myRank != null ? (
                  <div className="mt-4 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-6 py-4">
                    <p className="text-sm text-neutral-700">
                      {(nameFromQuery ?? "").trim()}님의 순위
                    </p>
                    <p className="mt-1 text-3xl font-extrabold text-emerald-700">
                      {myRank}위
                    </p>
                    <p className="mt-1 text-sm text-neutral-600">
                      소요시간: {formatTimer(timeSec)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-neutral-600">
                    소요시간: {formatTimer(timeSec)}
                  </p>
                )
              ) : (
                <p className="mt-4 text-sm text-neutral-600">
                  소요시간: {formatTimer(timeSec)}
                </p>
              )}

              <div className="mt-6 flex flex-col gap-3">
                <button
                  type="button"
                  className="home-cta-btn inline-flex w-full items-center justify-center rounded-full px-8 py-4 text-base font-bold text-slate-900 shadow-lg transition sm:py-[1.1rem] sm:text-lg"
                  onClick={() => router.push("/")}
                >
                  오늘의 랭킹 보기
                </button>
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center rounded-full border border-neutral-300 bg-neutral-200 px-8 py-4 text-base font-bold text-neutral-800 shadow-sm transition hover:bg-neutral-300 sm:py-[1.1rem] sm:text-lg"
                  onClick={() => {
                    setCompletePreviewDismissed(true);
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

                <p className="mt-1 text-center text-base font-bold text-neutral-800">
                  친구에게 자랑하기
                </p>

                <div className="relative flex flex-col items-center gap-3">
                  {bragTooltip ? (
                    <div
                      className={[
                        "glass-popup-surface pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-xl px-3 py-2 text-xs font-semibold text-black",
                        bragManualCopyUrl
                          ? "w-max max-w-[min(100vw-2rem,18rem)] whitespace-normal text-left leading-snug"
                          : "w-max whitespace-nowrap text-center",
                      ].join(" ")}
                      role="status"
                    >
                      {bragTooltip}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-center gap-6">
                    <button
                      type="button"
                      title="카카오톡으로 공유"
                      disabled={!saved}
                      onClick={() => void handleKakaoShare()}
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#FEE500] text-[#191919] shadow-md transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className="sr-only">카카오톡 공유</span>
                      <svg
                        aria-hidden
                        viewBox="0 0 24 24"
                        className="h-8 w-8"
                        fill="currentColor"
                      >
                        <path d="M12 3C6.5 3 2 6.58 2 11.07c0 2.47 1.32 4.67 3.37 6.03-.15.52-.97 3.35-.99 3.58 0 .05-.01.1.02.14.03.04.09.05.14.04.22-.03 2.58-1.77 3.01-2.08.83.23 1.71.35 2.61.35 5.5 0 10-3.58 10-8.07C22 6.58 17.5 3 12 3z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      title="제목·메시지·URL 복사"
                      disabled={!saved}
                      onClick={() => void handleBragShareCopyUrl()}
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-md transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className="sr-only">URL·메시지 복사</span>
                      <svg
                        aria-hidden
                        viewBox="0 0 24 24"
                        className="h-7 w-7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                  </div>
                </div>
                {bragManualCopyUrl ? (
                  <p
                    className="select-all break-all rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-left font-mono text-[11px] leading-relaxed text-neutral-900 sm:text-xs"
                    title="길게 눌러 전체 선택 후 복사"
                  >
                    {bragManualCopyUrl}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

