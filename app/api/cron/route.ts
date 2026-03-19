import { NextResponse } from "next/server";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { fetchNews } from "@/lib/fetchNews";
import { generatePuzzle } from "@/lib/generatePuzzle";

export const maxDuration = 60;
export const runtime = "nodejs";

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
      return "Supabase에서 public.puzzles 테이블을 찾지 못했습니다. puzzles 테이블 SQL 실행 및 Exposed schemas(public) 설정을 확인하세요. (code: PGRST205)";
    }

    const merged = [msg, details, hint, code ? `(code: ${code})` : ""]
      .filter(Boolean)
      .join(" ");
    if (merged) return merged;
    try {
      return JSON.stringify(err);
    } catch {
      return "크론 실행 중 오류가 발생했습니다.";
    }
  }
  return "크론 실행 중 오류가 발생했습니다.";
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

export async function GET() {
  try {
    dotenvConfig({ path: path.join(process.cwd(), ".env.local") });
    const supabase = getSupabase();
    const date = todayKSTYmd();

    const { data: existing, error: selectErr } = await supabase
      .from("puzzles")
      .select("id")
      .eq("date", date)
      .maybeSingle();
    if (selectErr) throw new Error(getErrorMessage(selectErr));
    if (existing?.id) {
      return NextResponse.json({ status: "skipped", date });
    }

    const news = await fetchNews();
    const crossword = await generatePuzzle(news);

    const { error: upsertErr } = await supabase
      .from("puzzles")
      .upsert({ date, data: crossword }, { onConflict: "date" });
    if (upsertErr) throw new Error(getErrorMessage(upsertErr));

    return NextResponse.json({ status: "created", date });
  } catch (err) {
    const message = getErrorMessage(err);
    console.error("[/api/cron] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

