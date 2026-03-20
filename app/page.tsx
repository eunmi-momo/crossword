import type { Metadata } from "next";
import HomePageClient from "./HomePageClient";
import {
  getShareLandingPath,
  getShareOgImageUrlForMetadata,
  getSiteOrigin,
} from "@/lib/siteUrl";

const OG_TITLE = "오늘의 뉴스 크로스워드";

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
  const description =
    rank && time
      ? `나 ${rank}위 달성! 풀이시간 ${time} ⏱️ 너도 도전해봐~`
      : time
        ? `나 퍼즐 완주! 풀이시간 ${time} ⏱️ 너도 도전해봐~`
        : "오늘의 뉴스로 만드는 크로스워드 퍼즐";

  return {
    title: OG_TITLE,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      url: canonicalUrl,
      title: OG_TITLE,
      description,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: OG_TITLE,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: OG_TITLE,
      description,
      images: [imageUrl],
    },
  };
}

export default function Page() {
  return <HomePageClient />;
}
