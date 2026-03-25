import { buildShareLandingUrl } from "@/lib/siteUrl";

/** 카카오·링크 미리보기·복사 블록 공통 제목 */
export const SHARE_PAGE_TITLE = "오늘의 뉴스 크로스워드";

/**
 * 공유 본문 (한 줄)
 * 예: 나 3위 달성! ⏱️ 풀이시간 01:30 너도 도전해봐~
 */
export function buildShareMessageBody(opts: {
  rank: number | null;
  timeMmSs: string;
}): string {
  if (opts.rank != null && Number.isFinite(opts.rank)) {
    return `나 ${opts.rank}위 달성! ⏱️ 풀이시간 ${opts.timeMmSs} 너도 도전해봐~`;
  }
  return `나 퍼즐 완주! ⏱️ 풀이시간 ${opts.timeMmSs} 너도 도전해봐~`;
}

/**
 * 복사 붙여넣기용: 제목 + 본문 + URL
 */
export function buildShareClipboardBlock(opts: {
  rank: number | null;
  timeMmSs: string;
}): string {
  const url = buildShareLandingUrl({
    rank: opts.rank,
    timeMmSs: opts.timeMmSs,
  });
  return `${SHARE_PAGE_TITLE}\n\n${buildShareMessageBody(opts)}\n\n${url}`;
}

/** OG description (쿼리 문자열 기준) */
export function buildOgDescriptionFromQuery(
  rank: string | undefined,
  time: string | undefined,
  fallback: string
): string {
  if (rank && time) {
    return `나 ${rank}위 달성! ⏱️ 풀이시간 ${time} 너도 도전해봐~`;
  }
  if (time) {
    return `나 퍼즐 완주! ⏱️ 풀이시간 ${time} 너도 도전해봐~`;
  }
  return fallback;
}
