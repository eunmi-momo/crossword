import { NextResponse } from "next/server";
import { fetchNews } from "@/lib/fetchNews";
import { generatePuzzle } from "@/lib/generatePuzzle";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { PlacedPuzzleItem } from "@/lib/generatePuzzle";
import { isYmdString, todayKSTYmd, tomorrowKSTYmd } from "@/lib/kstDate";

export const maxDuration = 60;
export const runtime = "nodejs";
/** 라우트/응답이 정적으로 캐시되지 않도록 */
export const dynamic = "force-dynamic";

function getPuzzleStats(data: unknown): { filled: number; inter: number; n: number; m: number } | null {
  const d = data as { grid?: unknown; words?: unknown };
  const grid = d.grid as string[][] | undefined;
  const words = d.words as PlacedPuzzleItem[] | undefined;
  if (!Array.isArray(grid) || !Array.isArray(grid[0]) || !Array.isArray(words)) return null;

  const n = grid.length;
  const m = (grid[0] as unknown[]).length;
  if (n === 0 || m === 0) return null;

  let filled = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < m; c++) {
      const cell = grid[r]![c];
      if (typeof cell === "string" && cell !== "") filled++;
    }
  }

  const dirs = Array.from({ length: n }, () => Array.from({ length: m }, () => 0));
  for (const w of words) {
    const dir = w.direction;
    if (dir !== "across" && dir !== "down") continue;
    const bit = dir === "across" ? 1 : 2;
    for (let i = 0; i < w.word.length; i++) {
      const rr = dir === "across" ? w.row : w.row + i;
      const cc = dir === "across" ? w.col + i : w.col;
      if (rr >= 0 && cc >= 0 && rr < n && cc < m) {
        dirs[rr]![cc] |= bit;
      }
    }
  }

  let inter = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < m; c++) {
      if (dirs[r]![c] === 3) inter++;
    }
  }

  return { filled, inter, n, m };
}

function isStoredPuzzleUsable(data: unknown): boolean {
  const stats = getPuzzleStats(data);
  if (!stats || stats.n !== 10 || stats.m !== 10) return false;
  return stats.filled >= 20 && stats.inter >= 4;
}

/** CDN(s-maxage)은 유지, 브라우저는 매번 재검증해 DB 갱신 후 최신 퍼즐이 보이게 */
const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control":
    "public, s-maxage=1800, stale-while-revalidate=86400, max-age=0, must-revalidate",
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const anyErr = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const msg = typeof anyErr.message === "string" ? anyErr.message : "";
    const details = typeof anyErr.details === "string" ? anyErr.details : "";
    const hint = typeof anyErr.hint === "string" ? anyErr.hint : "";
    const code = typeof anyErr.code === "string" ? anyErr.code : "";
    if (code === "PGRST205") {
      return "Supabase에서 public.puzzles 테이블을 찾지 못했습니다. (1) puzzles 테이블 SQL 실행 (2) Settings → API → Exposed schemas에 public 포함 (3) 같은 프로젝트 URL인지 확인 후 1~2분 뒤 재시도하세요. (code: PGRST205)";
    }

    const merged = [msg, details, hint, code ? `(code: ${code})` : ""]
      .filter(Boolean)
      .join(" ");
    if (merged) return merged;
    try {
      return JSON.stringify(err);
    } catch {
      return "퍼즐 생성 중 오류가 발생했습니다.";
    }
  }
  return "퍼즐 생성 중 오류가 발생했습니다.";
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL 환경변수가 필요합니다.");
  if (!anon) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 필요합니다.");
  return createClient(url, anon);
}

export async function GET(request: Request) {
  try {
    // .env.local 강제 로드 (환경에 따라 Next가 못 읽는 경우 대비)
    dotenvConfig({ path: path.join(process.cwd(), ".env.local") });
    const supabase = getSupabase();

    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const today = todayKSTYmd();
    const tomorrow = tomorrowKSTYmd();
    const rawDay = url.searchParams.get("day");
    const date =
      rawDay && isYmdString(rawDay) && (rawDay === today || rawDay === tomorrow)
        ? rawDay
        : today;

    if (!force) {
      const { data: existing, error: selectErr } = await supabase
        .from("puzzles")
        .select("data")
        .eq("date", date)
        .maybeSingle();
      if (selectErr) throw new Error(getErrorMessage(selectErr));
      if (existing?.data && isStoredPuzzleUsable(existing.data)) {
        return NextResponse.json(existing.data, {
          headers: {
            "X-Puzzle-Source": "sbs-crossword-cache",
            ...CACHE_HEADERS,
          },
        });
      }
    }

    const news = await fetchNews();
    const crossword = await generatePuzzle(news);

    const { error: upsertErr } = await supabase
      .from("puzzles")
      .upsert({ date, data: crossword }, { onConflict: "date" });

    if (upsertErr) {
      console.error("[/api/puzzle] upsert failed:", upsertErr);
      // ★ 저장 실패 시 DB에 남은 '예전 퍼즐'을 돌려주면 force=1 해도 화면이 절대 안 바뀜
      return NextResponse.json(crossword, {
        headers: {
          "X-Puzzle-Source": "sbs-crossword-generated-upsert-failed",
          "Cache-Control": "private, no-store",
          "X-Puzzle-Upsert-Failed": "1",
        },
      });
    }

    const { data: stored, error: readErr } = await supabase
      .from("puzzles")
      .select("data")
      .eq("date", date)
      .maybeSingle();
    if (readErr) throw new Error(getErrorMessage(readErr));

    if (stored?.data && isStoredPuzzleUsable(stored.data)) {
      return NextResponse.json(stored.data, {
        headers: {
          "X-Puzzle-Source": "sbs-crossword",
          ...CACHE_HEADERS,
        },
      });
    }

    return NextResponse.json(crossword, {
      headers: {
        "X-Puzzle-Source": "sbs-crossword-unsaved-fallback",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const message = getErrorMessage(err);
    console.error("[/api/puzzle] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
