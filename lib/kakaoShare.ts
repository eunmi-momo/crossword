import { buildKakaoSharePageUrl, getShareOgImageUrlForMetadata } from "@/lib/siteUrl";
import { buildShareMessageBody, SHARE_PAGE_TITLE } from "@/lib/shareBrag";

/** 공식 배포 스크립트 */
const KAKAO_SDK_SRC = "https://developers.kakao.com/sdk/js/kakao.min.js";

/** 카카오 피드 미리보기용(HTTPS). 동일 도메인 OG는 HTTPS 배포 시 교체 권장 */
const FALLBACK_FEED_IMAGE_HTTPS =
  "https://t1.kakaocdn.net/kakao_js_sdk/docs/img/sample.png";

declare global {
  interface Window {
    Kakao?: {
      init: (key: string) => void;
      isInitialized: () => boolean;
      Link: {
        sendDefault: (opts: Record<string, unknown>) => void;
      };
    };
  }
}

let sdkLoadPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("document 없음"));
      return;
    }
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Kakao SDK 로드 실패"))
      );
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Kakao SDK 로드 실패"));
    document.head.appendChild(s);
  });
}

/**
 * 카카오 JavaScript 키로 초기화 (앱당 1회)
 */
export async function ensureKakaoInitialized(): Promise<void> {
  const key = process.env.NEXT_PUBLIC_KAKAO_APP_KEY?.trim();
  if (!key) {
    throw new Error("NEXT_PUBLIC_KAKAO_APP_KEY가 설정되지 않았습니다.");
  }
  if (typeof window === "undefined") {
    throw new Error("브라우저에서만 사용할 수 있습니다.");
  }
  if (!sdkLoadPromise) {
    sdkLoadPromise = loadScript(KAKAO_SDK_SRC);
  }
  await sdkLoadPromise;
  const K = window.Kakao;
  if (!K) throw new Error("Kakao SDK를 찾을 수 없습니다.");
  if (!K.isInitialized()) {
    K.init(key);
  }
}

export type KakaoFeedShareOpts = {
  rank: number | null;
  timeMmSs: string;
};

/**
 * 카카오톡 공유 (피드)
 * - 링크: 쿼리 없는 랜딩 (요구사항)
 * - 미리보기 이미지: rank/time 반영 OG URL(HTTP면 카카오에서 거부될 수 있어 HTTPS 폴백 병행)
 */
export async function shareViaKakaoFeed(opts: KakaoFeedShareOpts): Promise<void> {
  await ensureKakaoInitialized();
  const K = window.Kakao!;
  const linkUrl = buildKakaoSharePageUrl();
  const title = SHARE_PAGE_TITLE;
  const description = buildShareMessageBody(opts);

  const rankStr =
    opts.rank != null && Number.isFinite(opts.rank) ? String(opts.rank) : undefined;
  const ogHttps = getShareOgImageUrlForMetadata(rankStr, opts.timeMmSs);
  const imageUrl =
    ogHttps.startsWith("https://") ? ogHttps : FALLBACK_FEED_IMAGE_HTTPS;

  K.Link.sendDefault({
    objectType: "feed",
    content: {
      title,
      description,
      imageUrl,
      link: {
        mobileWebUrl: linkUrl,
        webUrl: linkUrl,
      },
    },
    buttons: [
      {
        title: "도전하기",
        link: {
          mobileWebUrl: linkUrl,
          webUrl: linkUrl,
        },
      },
    ],
  });
}
