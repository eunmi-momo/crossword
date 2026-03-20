-- Supabase → SQL Editor 에서 한 번 실행하세요.
-- API가 anon 키로 puzzles 를 upsert 할 수 있어야 날짜별 퍼즐이 DB에 반영됩니다.

-- 테이블이 없을 때만 필요하면 아래 주석 해제 후 실행
/*
CREATE TABLE IF NOT EXISTS public.puzzles (
  date text PRIMARY KEY,
  data jsonb NOT NULL
);
*/

-- anon / authenticated 가 테이블에 접근할 수 있게 권한 부여
GRANT SELECT, INSERT, UPDATE ON public.puzzles TO anon;
GRANT SELECT, INSERT, UPDATE ON public.puzzles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.puzzles TO service_role;

ALTER TABLE public.puzzles ENABLE ROW LEVEL SECURITY;

-- 기존 정책이 있으면 이름 충돌 방지로 제거 후 재생성
DROP POLICY IF EXISTS "puzzles_select_public" ON public.puzzles;
DROP POLICY IF EXISTS "puzzles_insert_public" ON public.puzzles;
DROP POLICY IF EXISTS "puzzles_update_public" ON public.puzzles;

-- 누구나 오늘 퍼즐 읽기
CREATE POLICY "puzzles_select_public"
  ON public.puzzles FOR SELECT
  TO anon, authenticated
  USING (true);

-- 서버(API)가 새 퍼즐 넣기
CREATE POLICY "puzzles_insert_public"
  ON public.puzzles FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- upsert 시 ON CONFLICT DO UPDATE 에 필요
CREATE POLICY "puzzles_update_public"
  ON public.puzzles FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
