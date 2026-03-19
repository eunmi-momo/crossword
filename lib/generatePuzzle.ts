import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import type { NewsItem } from "./fetchNews";

const PUZZLE_COUNT = 15;
const GPT_WORD_COUNT = 25;
const NEWS_CONTEXT_COUNT = 30;
const GRID_SIZE = 10;
const MIN_INTERSECTIONS = 6;
const MAX_ATTEMPTS = 100;
const MAX_ROUNDS = 5;
const TIME_LIMIT_MS = 10_000;

function loadEnvLocal(): void {
  if (process.env.OPENAI_API_KEY) return;

  const root = process.cwd();
  const candidates: string[] = [
    path.join(root, ".env.local"),
    path.resolve(root, ".env.local"),
  ];

  try {
    const fromLib = path.resolve(__dirname, "..", "..", ".env.local");
    if (!candidates.includes(fromLib)) candidates.push(fromLib);
  } catch {}

  try {
    let dir = __dirname;
    for (let i = 0; i < 5; i++) {
      const envPath = path.join(dir, ".env.local");
      if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(envPath)) {
        if (!candidates.includes(envPath)) candidates.push(envPath);
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}

  for (const envPath of candidates) {
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
            const idx = trimmed.indexOf("=");
            const key = trimmed.slice(0, idx).trim();
            const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
            if (key && value) process.env[key] = value;
          }
        }
        return;
      }
    } catch {
      continue;
    }
  }
}

export type PuzzleItem = {
  word: string;
  hint: string;
  definition: string;
  link: string;
};

export type PlacedPuzzleItem = PuzzleItem & {
  direction: "across" | "down";
  row: number;
  col: number;
};

export type GeneratedCrossword = {
  words: PlacedPuzzleItem[];
  grid: string[][];
};

function underscore(word: string): string {
  return "_".repeat(word.length);
}

const KO_PARTICLES = [
  "이라는", "이라고", "으로서", "으로써", "에서는", "에서도",
  "이라", "이며", "이고", "에서", "에는", "에도", "으로",
  "에게", "한테", "처럼", "부터", "까지", "라는", "라고",
  "이다", "이면", "이나",
  "이", "가", "을", "를", "에", "의", "은", "는", "도",
  "로", "와", "과", "라", "만", "씩", "별",
];

function applyUnderscoreHint(word: string, hint: string): string {
  const w = word.trim();
  let h = hint.trim();
  if (!w || !h) return h;

  if (h.includes(w)) {
    return h.replaceAll(w, underscore(w));
  }

  for (const p of KO_PARTICLES) {
    const pattern = w + p;
    if (h.includes(pattern)) {
      return h.replaceAll(pattern, underscore(w) + p);
    }
  }

  if (/_{2,}/.test(h)) {
    return h;
  }

  return h + " (" + underscore(w) + ")";
}

/* ───────── 힌트 검증/복구 ───────── */

function findOriginalSentence(word: string, text: string): string | null {
  const normalized = text.replace(/\n+/g, " ");
  const sentences = normalized
    .split(/(?<=[.!?다요])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);

  for (const s of sentences) {
    if (s.includes(word)) return s;
  }
  for (const s of sentences) {
    for (const p of KO_PARTICLES) {
      if (s.includes(word + p)) return s;
    }
  }
  return null;
}

function validateItems(
  items: Array<{ word: string; hint: string; definition: string; link: string }>,
  newsItems: NewsItem[],
): Array<{ word: string; hint: string; definition: string; link: string }> {
  const textByLink = new Map<string, string>();
  for (const n of newsItems) {
    textByLink.set(n.link, [n.title, n.summary, n.content].join(" "));
  }

  return items
    .map((item) => {
      const fullText = textByLink.get(item.link);
      if (!fullText) return null;

      const wordExists =
        fullText.includes(item.word) ||
        KO_PARTICLES.some((p) => fullText.includes(item.word + p));
      if (!wordExists) return null;

      const restored = item.hint.replace(/_{2,}/g, item.word);
      const parts = restored
        .split(item.word)
        .map((p) => p.trim().replace(/^[^가-힣a-zA-Z0-9]+|[^가-힣a-zA-Z0-9]+$/g, ""))
        .filter((p) => p.length >= 4);

      const hintValid = parts.some((part) => fullText.includes(part));
      if (hintValid) return item;

      const realSentence = findOriginalSentence(item.word, fullText);
      if (realSentence) {
        return { ...item, hint: applyUnderscoreHint(item.word, realSentence) };
      }

      return item;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

/* ───────── 격자 배치 알고리즘 ───────── */

type WordEntry = { word: string; hint: string; definition: string; link: string };

function emptyGrid(): string[][] {
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => "")
  );
}

function emptyDirs(): number[][] {
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => 0)
  );
}

const ACROSS_BIT = 1;
const DOWN_BIT = 2;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function canPlace(
  word: string,
  dir: "across" | "down",
  row: number,
  col: number,
  grid: string[][],
  dirs: number[][],
): boolean {
  const len = word.length;
  const selfBit = dir === "across" ? ACROSS_BIT : DOWN_BIT;

  // 경계 체크
  if (dir === "across") {
    if (row < 0 || row >= GRID_SIZE || col < 0 || col + len > GRID_SIZE) return false;
  } else {
    if (col < 0 || col >= GRID_SIZE || row < 0 || row + len > GRID_SIZE) return false;
  }

  // 앞/뒤 1칸 비어있어야 함 (같은 방향으로 단어가 이어짐 방지)
  if (dir === "across") {
    if (col > 0 && grid[row]![col - 1] !== "") return false;
    if (col + len < GRID_SIZE && grid[row]![col + len] !== "") return false;
  } else {
    if (row > 0 && grid[row - 1]![col] !== "") return false;
    if (row + len < GRID_SIZE && grid[row + len]![col] !== "") return false;
  }

  // 이 단어가 차지하는 모든 칸 (인접 체크에서 자기 자신 스킵용)
  const wordCells = new Set<string>();
  for (let k = 0; k < len; k++) {
    const wr = dir === "across" ? row : row + k;
    const wc = dir === "across" ? col + k : col;
    wordCells.add(`${wr},${wc}`);
  }

  for (let i = 0; i < len; i++) {
    const r = dir === "across" ? row : row + i;
    const c = dir === "across" ? col + i : col;
    const existing = grid[r]![c]!;
    const existingDir = dirs[r]![c]!;

    if (existing !== "") {
      if (existing !== word[i]) return false;
      if ((existingDir & selfBit) !== 0) return false;
    } else {
      if (dir === "across") {
        for (const dr of [-1, 1]) {
          const nr = r + dr;
          if (nr < 0 || nr >= GRID_SIZE) continue;
          if (grid[nr]![c] === "") continue;
          if (wordCells.has(`${nr},${c}`)) continue;
          if ((dirs[nr]![c]! & DOWN_BIT) === 0) return false;
        }
      } else {
        for (const dc of [-1, 1]) {
          const nc = c + dc;
          if (nc < 0 || nc >= GRID_SIZE) continue;
          if (grid[r]![nc] === "") continue;
          if (wordCells.has(`${r},${nc}`)) continue;
          if ((dirs[r]![nc]! & ACROSS_BIT) === 0) return false;
        }
      }
    }
  }

  return true;
}

function placeWordOnGrid(
  entry: WordEntry,
  dir: "across" | "down",
  row: number,
  col: number,
  grid: string[][],
  dirs: number[][],
): PlacedPuzzleItem {
  const bit = dir === "across" ? ACROSS_BIT : DOWN_BIT;
  for (let i = 0; i < entry.word.length; i++) {
    const r = dir === "across" ? row : row + i;
    const c = dir === "across" ? col + i : col;
    grid[r]![c] = entry.word[i]!;
    dirs[r]![c]! |= bit;
  }
  return { ...entry, direction: dir, row, col };
}

function countIntersections(dirs: number[][]): number {
  let count = 0;
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (dirs[r]![c] === (ACROSS_BIT | DOWN_BIT)) count++;
    }
  }
  return count;
}

function quadrantFills(grid: string[][]): [number, number, number, number] {
  const half = Math.floor(GRID_SIZE / 2);
  const q: [number, number, number, number] = [0, 0, 0, 0];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r]![c] === "") continue;
      q[(r < half ? 0 : 2) + (c < half ? 0 : 1)]++;
    }
  }
  return q;
}

function isFullyIsolated(
  word: string,
  dir: "across" | "down",
  row: number,
  col: number,
  grid: string[][],
): boolean {
  for (let i = 0; i < word.length; i++) {
    const r = dir === "across" ? row : row + i;
    const c = dir === "across" ? col + i : col;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
        if (grid[nr]![nc] !== "") return false;
      }
    }
  }
  return true;
}

function findIntersectionCandidates(
  entry: WordEntry,
  grid: string[][],
  dirs: number[][],
): { dir: "across" | "down"; row: number; col: number; score: number }[] {
  const candidates: { dir: "across" | "down"; row: number; col: number; score: number }[] = [];
  const half = Math.floor(GRID_SIZE / 2);
  const qFill = quadrantFills(grid);

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r]![c] === "") continue;
      for (let i = 0; i < entry.word.length; i++) {
        if (entry.word[i] !== grid[r]![c]) continue;

        for (const dir of ["across", "down"] as const) {
          const sr = dir === "across" ? r : r - i;
          const sc = dir === "across" ? c - i : c;
          if (!canPlace(entry.word, dir, sr, sc, grid, dirs)) continue;

          let score = 0;
          for (let k = 0; k < entry.word.length; k++) {
            const kr = dir === "across" ? sr : sr + k;
            const kc = dir === "across" ? sc + k : sc;
            if (grid[kr]![kc] !== "") score += 20;
          }

          const midR = dir === "across" ? sr : sr + entry.word.length / 2;
          const midC = dir === "across" ? sc + entry.word.length / 2 : sc;
          const qi = (midR < half ? 0 : 2) + (midC < half ? 0 : 1);
          score += Math.max(0, 5 - Math.floor(qFill[qi]! / 3));

          candidates.push({ dir, row: sr, col: sc, score });
        }
      }
    }
  }
  return candidates;
}

function findFallbackCandidates(
  entry: WordEntry,
  grid: string[][],
  dirs: number[][],
): { dir: "across" | "down"; row: number; col: number; score: number }[] {
  const half = Math.floor(GRID_SIZE / 2);
  const qFill = quadrantFills(grid);
  const candidates: { dir: "across" | "down"; row: number; col: number; score: number }[] = [];

  for (const dir of ["across", "down"] as const) {
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (!canPlace(entry.word, dir, r, c, grid, dirs)) continue;
        if (!isFullyIsolated(entry.word, dir, r, c, grid)) continue;

        const midR = dir === "across" ? r : r + entry.word.length / 2;
        const midC = dir === "across" ? c + entry.word.length / 2 : c;
        const qi = (midR < half ? 0 : 2) + (midC < half ? 0 : 1);
        const score = 50 - qFill[qi]!;

        candidates.push({ dir, row: r, col: c, score });
      }
    }
  }
  return candidates;
}

function buildCrossword(entries: WordEntry[]): {
  grid: string[][];
  words: PlacedPuzzleItem[];
  intersections: number;
} {
  let bestResult = { grid: emptyGrid(), words: [] as PlacedPuzzleItem[], intersections: 0 };
  const targetWords = Math.min(entries.length, PUZZLE_COUNT);
  const t0 = Date.now();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (Date.now() - t0 > TIME_LIMIT_MS) break;

    const grid = emptyGrid();
    const dirs = emptyDirs();
    const placed: PlacedPuzzleItem[] = [];
    const placedWords = new Set<string>();

    const order =
      attempt === 0
        ? [...entries].sort((a, b) => b.word.length - a.word.length)
        : shuffle([...entries]);

    const first = order[0];
    if (!first) continue;

    const firstDir: "across" | "down" = attempt % 2 === 0 ? "across" : "down";
    const sr =
      firstDir === "across"
        ? Math.floor(GRID_SIZE / 2)
        : Math.floor((GRID_SIZE - first.word.length) / 2);
    const sc =
      firstDir === "across"
        ? Math.floor((GRID_SIZE - first.word.length) / 2)
        : Math.floor(GRID_SIZE / 2);

    if (
      sr >= 0 && sc >= 0 &&
      (firstDir === "across"
        ? sc + first.word.length <= GRID_SIZE
        : sr + first.word.length <= GRID_SIZE)
    ) {
      placed.push(placeWordOnGrid(first, firstDir, sr, sc, grid, dirs));
      placedWords.add(first.word);
    }

    for (let round = 0; round < MAX_ROUNDS; round++) {
      let placedThisRound = 0;

      for (const entry of order) {
        if (placedWords.has(entry.word)) continue;
        if (placed.length >= targetWords) break;

        const intCandidates = findIntersectionCandidates(entry, grid, dirs);

        let candidates = intCandidates;
        if (candidates.length === 0 && round >= 2) {
          candidates = findFallbackCandidates(entry, grid, dirs);
        }
        if (candidates.length === 0) continue;

        const acrossN = placed.filter(p => p.direction === "across").length;
        const downN = placed.filter(p => p.direction === "down").length;
        const preferDir = acrossN <= downN ? "across" : "down";
        for (const c of candidates) {
          if (c.dir === preferDir) c.score += 15;
        }

        candidates.sort((a, b) => b.score - a.score);
        const topN = Math.min(candidates.length, 3);
        const pick = candidates[Math.floor(Math.random() * topN)]!;

        placed.push(placeWordOnGrid(entry, pick.dir, pick.row, pick.col, grid, dirs));
        placedWords.add(entry.word);
        placedThisRound++;
      }

      if (placed.length >= targetWords) break;
      if (placedThisRound === 0 && round >= 2) break;
    }

    const intersections = countIntersections(dirs);
    const aCount = placed.filter(p => p.direction === "across").length;
    const dCount = placed.filter(p => p.direction === "down").length;
    const balanceBonus = Math.min(aCount, dCount) * 50;
    const score = placed.length * 1000 + intersections * 100 + balanceBonus;

    const bestAC = bestResult.words.filter(p => p.direction === "across").length;
    const bestDC = bestResult.words.filter(p => p.direction === "down").length;
    const bestBalanceBonus = Math.min(bestAC, bestDC) * 50;
    const bestScore = bestResult.words.length * 1000 + bestResult.intersections * 100 + bestBalanceBonus;

    if (score > bestScore) {
      bestResult = { grid, words: placed, intersections };
    }

    const balanced = Math.min(aCount, dCount) >= Math.floor(targetWords / 3);
    if (placed.length >= targetWords && intersections >= MIN_INTERSECTIONS && balanced) break;
  }

  return bestResult;
}

/* ───────── GPT 호출 + 메인 함수 ───────── */

export async function generatePuzzle(
  news: NewsItem[]
): Promise<GeneratedCrossword> {
  loadEnvLocal();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 .env.local에 설정되어 있지 않습니다.");
  }

  const client = new OpenAI({ apiKey });

  const numbered = news.slice(0, NEWS_CONTEXT_COUNT).map((n, i) => ({
    idx: i + 1,
    title: n.title,
    summary: n.summary,
    content: n.content,
    keywords: n.keywords,
    link: n.link,
  }));

  const newsContext = numbered
    .map((n) => {
      const parts = [
        `[번호] ${n.idx}`,
        `[제목] ${n.title}`,
        `[요약] ${n.summary}`,
      ];
      if (n.content && n.content.trim()) {
        parts.push(`[본문] ${n.content.trim()}`);
      }
      parts.push(`[키워드] ${n.keywords.join(", ")}`);
      parts.push(`[링크] ${n.link}`);
      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `너는 한국어 크로스워드 퍼즐 출제자다.
규칙을 반드시 지켜라:
1. 정답 단어(word)와 힌트(hint)는 오직 사용자가 제공한 뉴스 텍스트([제목][요약][본문][키워드]) 안에 나온 내용만 사용한다.
2. 위 뉴스에 없는 단어, 없는 사실, 만들어낸 내용은 절대 사용하지 않는다.
3. word는 반드시 해당 기사의 [제목], [요약], [본문] 텍스트에 그대로 등장하는 2~5글자 한국어 단어만 쓴다. 텍스트에 없는 단어를 만들어내지 마라.
4. 단어들 사이에 공통 글자가 최대한 많도록 골라라. 예: "경찰"과 "찰과상" → '찰'에서 교차 가능. 서로 겹치는 글자가 있는 단어를 우선 선택해라.
5. hint는 반드시 해당 기사 텍스트([제목], [요약], [본문])에서 정답 단어가 포함된 문장을 **한 글자도 바꾸지 않고 원문 그대로 복사**한 뒤, 정답 단어 부분만 밑줄(_)로 치환한 것이어야 한다.
   - 원문에 없는 문장을 새로 작성하면 절대 안 된다.
   - 원문을 요약하거나, 의역하거나, 재구성하면 절대 안 된다.
   - 반드시 제공된 텍스트에 실제로 존재하는 문장을 그대로 복사해야 한다.
6. hint에는 밑줄(_)이 반드시 포함되어야 한다. 밑줄이 없는 hint는 잘못된 것이다.
   - 밑줄(_) 개수는 word의 글자 수와 정확히 동일해야 한다. (2글자: __, 3글자: ___, 4글자: ____, 5글자: _____)
   - 예: 원문이 "경찰이 현장에 출동했다"이고 word가 "경찰"이면 → hint: "__이 현장에 출동했다" (O)
   - 예: 원문이 "고속도로에서 사고가 발생했다"이고 word가 "사고"이면 → hint: "고속도로에서 __가 발생했다" (O)
   - "법 집행기관이 출동했다" 같이 원문에 없는 문장을 만들어내면 안 된다 (X)
7. definition에는 정답 단어의 사전적 의미를 국어사전 스타일로 한 문장으로 쓴다. 쉬운 말로 쓴다.
8. 응답은 반드시 {"items": [{"word":"...", "hint":"...", "definition":"...", "link":"..."}, ...]} 형태의 JSON만 출력한다. 다른 말 없이 JSON만.`,
      },
      {
        role: "user",
        content: `아래는 오늘의 SBS 뉴스 기사들이고 각 기사에는 [번호]와 [링크]가 있다. [본문]이 있는 기사는 실제 기사 본문이다. 이 텍스트만 보고 크로스워드 문항 ${GPT_WORD_COUNT}개를 만들어라.
각 문항의 word는 반드시 아래 텍스트에 그대로 등장한 2~5글자 단어여야 하고, hint는 해당 단어가 포함된 원문 문장을 그대로 가져와야 한다. 각 문항에는 해당 단어가 나온 기사 [링크]도 포함해라. definition에 정답 단어의 사전적 의미(쉬운 말, 한 문장)를 포함해라.

중요: 단어들 사이에 공통 글자가 최대한 많도록 골라라. 크로스워드에서 가로/세로가 교차할 수 있게 같은 글자를 공유하는 단어 조합을 우선 선택해라. 예: "경찰"과 "경기" → '경'에서 교차, "사고"와 "고장" → '고'에서 교차. 이런 식으로 2글자 이상 겹치는 조합을 많이 만들어라.

★ 핵심 규칙: hint는 반드시 위 텍스트에서 해당 단어가 포함된 문장을 한 글자도 바꾸지 않고 그대로 복사한 뒤, 정답 단어만 밑줄(_)로 치환해야 한다. 문장을 수정하거나 새로 만들면 절대 안 된다. 기사에 "검찰은 규정 위반 혐의로 조사했다"라는 문장이 있고 word가 "검찰"이면, hint는 "__은 규정 위반 혐의로 조사했다"여야 한다.

${newsContext}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error("GPT-4o가 빈 응답을 반환했습니다.");
  }

  const parsed = JSON.parse(raw) as { items?: PuzzleItem[] };
  const items = parsed.items ?? [];

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("GPT-4o 응답에서 문항 배열을 찾을 수 없습니다.");
  }

  const normalized = items.slice(0, GPT_WORD_COUNT).map((item) => {
    const word = String(item?.word ?? "")
      .trim()
      .replace(/\s+/g, "")
      .slice(0, 5);
    const hint = String(item?.hint ?? "").trim();
    const definition = String((item as Partial<PuzzleItem>)?.definition ?? "").trim();
    const link = String(item?.link ?? "").trim();
    return { word, hint: applyUnderscoreHint(word, hint), definition, link };
  });

  const entries = normalized
    .filter((x) => x.word.length >= 2 && x.word.length <= 5)
    .filter((x, idx, arr) => arr.findIndex((y) => y.word === x.word) === idx);

  const validated = validateItems(entries, news);
  const result = buildCrossword(validated.length >= PUZZLE_COUNT ? validated : entries);

  // 최종 13x13 보장
  const finalGrid =
    result.grid.length === GRID_SIZE && result.grid[0]?.length === GRID_SIZE
      ? result.grid
      : emptyGrid();

  return { words: result.words, grid: finalGrid };
}
