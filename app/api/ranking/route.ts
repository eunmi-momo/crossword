import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "요청 처리 중 오류가 발생했습니다.";
  }
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL 환경변수가 필요합니다.");
  if (!anon) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 필요합니다.");
  return createClient(url, anon);
}

export async function POST(request: NextRequest) {
  try {
    dotenvConfig({ path: path.join(process.cwd(), ".env.local") });
    const supabase = getSupabase();

    const body = (await request.json()) as {
      name?: unknown;
      time?: unknown;
      date?: unknown;
    };

    const name = String(body?.name ?? "").trim().slice(0, 20);
    const time = Number(body?.time ?? NaN);
    const date = String(body?.date ?? "").trim();

    if (!name) return NextResponse.json({ error: "name이 필요합니다." }, { status: 400 });
    if (!Number.isFinite(time) || time < 0)
      return NextResponse.json({ error: "time이 올바르지 않습니다." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return NextResponse.json({ error: "date 형식이 올바르지 않습니다." }, { status: 400 });

    const { error: insertErr } = await supabase.from("rankings").insert({ name, time, date });
    if (insertErr) throw new Error(getErrorMessage(insertErr));

    const { count, error: countErr } = await supabase
      .from("rankings")
      .select("id", { count: "exact", head: true })
      .eq("date", date)
      .lte("time", time);
    if (countErr) throw new Error(getErrorMessage(countErr));

    return NextResponse.json({ ok: true, rank: count ?? null });
  } catch (err) {
    const message = getErrorMessage(err);
    console.error("[/api/ranking] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

