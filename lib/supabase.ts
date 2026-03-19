import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL 환경변수가 필요합니다.");
}
if (!anonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 필요합니다.");
}

export const supabase = createClient(url, anonKey);

