import Parser from "rss-parser";
import { parse as parseHtml } from "node-html-parser";

const SBS_RSS_URL =
  "https://news.sbs.co.kr/news/newsflashRssFeed.do?plink=RSSREADER";

/** RSS에서 가져올 최대 기사 수 (문장·출제 다양화) */
const MAX_FEED_ITEMS = 50;
const MIN_FEED_ITEMS = 10;
/** 본문을 직접 긁어오는 상위 N개 (나머지는 RSS 요약만) */
const MAX_ARTICLES_WITH_BODY = 40;
const MAX_CONTENT_LENGTH = 1500;

/** 광고·앱 링크 등 불필요한 문장 제거 */
const SKIP_PATTERNS = [
  /앱\s*다운로드/i,
  /스브스\s*프리미엄/i,
  /무단\s*복제|무단\s*재배포/i,
  /RSS\s*피드|개인\s*리더/i,
  /^▶\s*/,
  /^ⓒ\s*|ⓒ\s*SBS/i,
  /SBS\s*뉴스\s*앱/i,
  /전체\s*내용\s*확인/i,
  /track\s*pixel/i,
  /저작권|무단\s*복제/i,
];

function isJunkLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 3) return true;
  return SKIP_PATTERNS.some((re) => re.test(t));
}

/** HTML 문자열에서 태그 제거 후 순수 텍스트만 반환 */
function stripHtml(html: string): string {
  const root = parseHtml(html);
  return (root.textContent ?? "").trim();
}

/** 기사 URL에서 본문(content:encoded 영역) 추출 → 태그 제거, 불필요 문구 제거, 500자. 실패 시 null */
async function fetchArticleContent(link: string): Promise<string | null> {
  try {
    const res = await fetch(link, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SBS Crossword Bot/1.0)",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const root = parseHtml(html);

    // 본문: content:encoded에 해당하는 영역 → 기사 페이지에서는 보통 article 또는 .article_body 등
    const article =
      root.querySelector("article") ??
      root.querySelector("[class*='article']") ??
      root.querySelector(".news_content") ??
      root.querySelector("main") ??
      root.querySelector("body");

    if (article) {
      article.querySelectorAll("script,style,noscript,iframe").forEach((el) => {
        el.remove();
      });
    }

    const rawHtml = article?.innerHTML ?? "";
    const fullText = stripHtml(rawHtml);

    const lines = fullText
      .split(/\s*\n+\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !isJunkLine(s));

    const body = lines.join("\n").trim();
    return body ? body.slice(0, MAX_CONTENT_LENGTH) : null;
  } catch {
    return null;
  }
}

export type NewsItem = {
  title: string;
  summary: string;
  keywords: string[];
  content: string;
  link: string;
};

const parser = new Parser();

/** SBS 뉴스 RSS에서 기사 목록을 가져오고, 상위 5개는 기사 링크로 접속해 본문(content) 수집 */
export async function fetchNews(): Promise<NewsItem[]> {
  const feed = await parser.parseURL(SBS_RSS_URL);
  const rawItems = (feed.items ?? []).slice(0, MAX_FEED_ITEMS);
  if (rawItems.length < MIN_FEED_ITEMS) {
    // RSS가 일시적으로 적게 내려오는 경우가 있어도 그대로 진행하되,
    // 최소치 미달은 호출 측에서 알 수 있도록 에러로 처리한다.
    throw new Error(`뉴스 기사 수가 부족합니다. (${rawItems.length}개)`);
  }

  const items: NewsItem[] = await Promise.all(
    rawItems.map(async (item, index) => {
      const title = item.title?.trim() ?? "";
      const rssSummary =
        item.description?.trim()?.slice(0, 300) ||
        item.contentSnippet?.trim()?.slice(0, 300) ||
        "";

      const categories = item.categories ?? [];
      const keywords = categories
        .filter(
          (c) =>
            c &&
            c.length <= 20 &&
            !/^(SBS|NEWS|뉴스|서울방송|Seoul|Broadcast|Station|일반기사|한국|정치|국제|사회|경제|문화|IT|과학)$/i.test(
              c
            )
        )
        .slice(0, 10);

      let content = "";
      if (index < MAX_ARTICLES_WITH_BODY && item.link) {
        const fetched = await fetchArticleContent(item.link);
        content = fetched ?? rssSummary;
      } else {
        content = rssSummary;
      }

      return {
        title,
        summary: rssSummary,
        keywords,
        content: content || rssSummary,
        link: item.link ?? "",
      };
    })
  );

  return items;
}
