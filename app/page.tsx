import type { Metadata } from "next";
import HomePageClient from "./HomePageClient";
import {
  buildOgDescriptionFromQuery,
  SHARE_PAGE_TITLE,
} from "@/lib/shareBrag";
import {
  getShareLandingPath,
  getShareOgImageUrlForMetadata,
  getSiteOrigin,
} from "@/lib/siteUrl";

const DEFAULT_DESCRIPTION =
  "게임처럼 즐기다 보면 어느새 상식 마스터! 지금 도전하세요~!";

/** 쿼리(rank, time)마다 다른 OG 메타가 나가야 함 — 정적 프리렌더 시 쿼리가 무시되는 문제 방지 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const rank = typeof sp.rank === "string" ? sp.rank.trim() || undefined : undefined;
  const time = typeof sp.time === "string" ? sp.time.trim() || undefined : undefined;

  const origin = getSiteOrigin();
  const path = getShareLandingPath();
  const qs = new URLSearchParams();
  if (rank) qs.set("rank", rank);
  if (time) qs.set("time", time);
  const queryString = qs.toString();
  const canonicalUrl = queryString
    ? `${origin}${path}?${queryString}`
    : `${origin}${path}`;

  const imageUrl = getShareOgImageUrlForMetadata(rank, time);
  const description = buildOgDescriptionFromQuery(rank, time, DEFAULT_DESCRIPTION);

  return {
    title: SHARE_PAGE_TITLE,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      url: canonicalUrl,
      title: SHARE_PAGE_TITLE,
      description,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: SHARE_PAGE_TITLE,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: SHARE_PAGE_TITLE,
      description,
      images: [imageUrl],
    },
  };
}

export default function Page() {
  return <HomePageClient />;
}
