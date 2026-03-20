import { ImageResponse } from "next/og";

export const runtime = "nodejs";
/** rank/time 쿼리별로 이미지가 달라져야 함 */
export const dynamic = "force-dynamic";

export const alt = "오늘의 뉴스 크로스워드";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#5055fa";
const ACCENT = "#03c75a";
const CARD = "#ffffff";
const MUTED = "#e8ecef";

export default async function Image({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const rankRaw = typeof sp.rank === "string" ? sp.rank : undefined;
  const timeRaw =
    typeof sp.time === "string" ? sp.time : Array.isArray(sp.time) ? sp.time[0] : undefined;
  const timeDisplay = timeRaw && timeRaw.trim() !== "" ? timeRaw : "00:00";
  const rankNum =
    rankRaw != null && rankRaw !== "" && !Number.isNaN(Number(rankRaw))
      ? Number(rankRaw)
      : null;

  let fontData: ArrayBuffer | undefined;
  try {
    const fontRes = await fetch(
      "https://fonts.gstatic.com/s/notosanskr/v36/PbykFmXiEBPT4ITbgNA5Cgm20HTs4JMM.woff2"
    );
    if (fontRes.ok) fontData = await fontRes.arrayBuffer();
  } catch {
    /* fallback sans */
  }

  const rankLine =
    rankNum != null && rankNum > 0
      ? `🏆 ${rankNum}위 달성!`
      : "🎉 퍼즐 완주!";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          background: `linear-gradient(165deg, ${BG} 0%, #3d42c9 55%, #2f3499 100%)`,
          padding: "56px 64px",
          fontFamily: fontData
            ? "Noto Sans KR"
            : 'system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 44,
            fontWeight: 700,
            color: CARD,
            textAlign: "center",
            letterSpacing: "-0.02em",
            lineHeight: 1.25,
          }}
        >
          오늘의 뉴스 크로스워드
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
            flex: 1,
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 64,
              fontWeight: 700,
              color: ACCENT,
              textShadow: "0 4px 24px rgba(0,0,0,0.25)",
            }}
          >
            {rankLine}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 48,
              fontWeight: 700,
              color: MUTED,
            }}
          >
            {`⏱️ 풀이시간 ${timeDisplay}`}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 40,
            fontWeight: 700,
            color: CARD,
            opacity: 0.95,
          }}
        >
          너도 도전해봐~
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fontData
        ? [
            {
              name: "Noto Sans KR",
              data: fontData,
              style: "normal",
              weight: 400,
            },
          ]
        : undefined,
    }
  );
}
