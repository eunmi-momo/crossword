/**
 * 공유·OG용 절대 URL (카카오/크롤러는 반드시 풀 URL 필요)
 * .env: NEXT_PUBLIC_SITE_URL=http://34.56.71.179:3000 (끝 슬래시 없이)
 */
const DEFAULT_SITE_ORIGIN = "http://34.56.71.179:3000";

export function getSiteOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_ORIGIN;
  return raw.replace(/\/$/, "");
}

/** 랜딩 (basePath 루트) */
export function getShareLandingPath(): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "/crossword";
  return base.startsWith("/") ? base : `/${base}`;
}

/**
 * 카카오톡 기본 공유용 랜딩 (쿼리 없음)
 * 예: http://34.56.71.179:3000/crossword
 */
export function buildKakaoSharePageUrl(): string {
  const origin = getSiteOrigin();
  const path = getShareLandingPath();
  return `${origin}${path}`;
}

/** 공유용 랜딩 URL (?rank & ?time 으로 OG 이미지·메타 연동) */
export function buildShareLandingUrl(opts: {
  rank: number | null;
  timeMmSs: string;
}): string {
  const origin = getSiteOrigin();
  const path = getShareLandingPath();
  const params = new URLSearchParams();
  if (opts.rank != null && Number.isFinite(opts.rank)) {
    params.set("rank", String(opts.rank));
  }
  params.set("time", opts.timeMmSs);
  const q = params.toString();
  return `${origin}${path}${q ? `?${q}` : ""}`;
}

/** OG 이미지 전용 절대 URL (opengraph-image 라우트) */
export function buildOpenGraphImageUrl(opts: {
  rank: number | null;
  timeMmSs: string;
}): string {
  const origin = getSiteOrigin();
  const path = getShareLandingPath();
  const params = new URLSearchParams();
  if (opts.rank != null && Number.isFinite(opts.rank)) {
    params.set("rank", String(opts.rank));
  }
  params.set("time", opts.timeMmSs);
  const q = params.toString();
  return `${origin}${path}/opengraph-image${q ? `?${q}` : ""}`;
}

/** generateMetadata 등 서버에서 사용 */
export function getShareOgImageUrlForMetadata(
  rank?: string | null,
  time?: string | null
): string {
  const origin = getSiteOrigin();
  const path = getShareLandingPath();
  const params = new URLSearchParams();
  if (rank) params.set("rank", rank);
  if (time) params.set("time", time);
  const q = params.toString();
  return `${origin}${path}/opengraph-image${q ? `?${q}` : ""}`;
}
