import { NextResponse } from "next/server";
import { fetchNews } from "@/lib/fetchNews";
import { generatePuzzle } from "@/lib/generatePuzzle";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { GeneratedCrossword, PlacedPuzzleItem } from "@/lib/generatePuzzle";

export const maxDuration = 60;
export const runtime = "nodejs";

type VolatileCache = { date: string; data: unknown; expiresAt: number } | null;
let volatileCache: VolatileCache = null;

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

function todayKSTYmd(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // yyyy-mm-dd
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
    const date = todayKSTYmd();

    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";

    if (!force) {
      // Upsert 실패(=저장 불가) 케이스에서 반복 GPT 호출을 줄이기 위한 메모리 캐시
      if (volatileCache && volatileCache.date === date && Date.now() < volatileCache.expiresAt && (() => {
        const stats = getPuzzleStats(volatileCache.data);
        return stats && stats.n === 10 && stats.m === 10 && stats.inter >= 4;
      })()) {
        return NextResponse.json(volatileCache.data, {
          headers: {
            "X-Puzzle-Source": "sbs-crossword-regenerated-volatile-cache",
            "Cache-Control": "public, max-age=3600",
          },
        });
      }

      // 1) 오늘 퍼즐이 이미 저장돼 있으면 그대로 반환
      const { data: existing, error: selectErr } = await supabase
        .from("puzzles")
        .select("data")
        .eq("date", date)
        .maybeSingle();
      if (selectErr) throw new Error(getErrorMessage(selectErr));
      if (existing?.data) {
        const d = existing.data as unknown as { grid?: string[][] };
        const grid = d?.grid;
        const isCorrectSize =
          Array.isArray(grid) &&
        grid.length === 10 &&
        Array.isArray(grid[0]) &&
        grid[0]!.length === 10;

        if (isCorrectSize) {
          const stats = getPuzzleStats(existing.data);
          const reuse = stats
            ? stats.filled >= 20 && stats.inter >= 4
            : true;

          if (reuse) {
            return NextResponse.json(existing.data, {
              headers: {
                "X-Puzzle-Source": "sbs-crossword-cache",
                "Cache-Control": "public, max-age=3600",
              },
            });
          }
        }
      }
    }

    // 2) 없으면 생성 → 저장 → 반환
    const news = await fetchNews();
    const crossword = await generatePuzzle(news);

    const { error: upsertErr } = await supabase
      .from("puzzles")
      .upsert({ date, data: crossword }, { onConflict: "date" });
    if (upsertErr) {
      // RLS 정책 때문에 저장이 실패할 수 있습니다.
      // 이 경우에도 프론트가 멈추지 않도록 생성된 퍼즐을 그대로 반환합니다.
      console.error("[/api/puzzle] upsert failed, returning generated puzzle only:", upsertErr);
      volatileCache = {
        date,
        data: crossword,
        expiresAt: Date.now() + 1000 * 60 * 60, // 1 hour
      };
      return NextResponse.json(crossword, {
        headers: {
          "X-Puzzle-Source": "sbs-crossword-regenerated-volatile",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    return NextResponse.json(crossword, {
      headers: {
        "X-Puzzle-Source": "sbs-crossword",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const message = getErrorMessage(err);
    console.error("[/api/puzzle] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
