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

/**
 * 단어 끝에 붙는 조사·접미(명사+조사 형태). 긴 것부터 매칭.
 * '나라'(나+라 오인) 방지: stem은 최소 2글자만 조사 분리로 인정.
 */
const TRAILING_JOSA_SUFFIXES: string[] = [
  ...new Set([
    "이라는",
    "이라고",
    "으로서",
    "으로써",
    "에서는",
    "에서도",
    "라는",
    "라고",
    "에서",
    "까지",
    "부터",
    "처럼",
    "만큼",
    "조차",
    "밖에",
    "으로",
    "에는",
    "에도",
    "에게",
    "한테",
    "이랑",
    "이며",
    "이고",
    "이든",
    "이나",
    "이다",
    "들",
    "이",
    "가",
    "을",
    "를",
    "은",
    "는",
    "와",
    "과",
    "도",
    "만",
    "에",
    "의",
    "로",
  ]),
].sort((a, b) => b.length - a.length);

/** 정답이 '어근+조사'처럼 보이면 true (2글자 미만 어근은 제외해 나라·정도 등 오탐 감소) */
function looksLikeWordPlusTrailingJosa(word: string): boolean {
  const w = word.normalize("NFC");
  if (w.length < 3) return false;
  for (const suf of TRAILING_JOSA_SUFFIXES) {
    if (suf.length >= w.length) continue;
    if (!w.endsWith(suf)) continue;
    const stem = w.slice(0, w.length - suf.length);
    if (stem.length < 2 || stem.length > 5) continue;
    if (!/^[가-힣]+$/.test(stem)) continue;
    return true;
  }
  return false;
}

/** 끝 조사를 떼어 낸 어근(크로스워드 정답 후보). 없으면 null */
function stripTrailingJosa(word: string): string | null {
  const w = word.normalize("NFC");
  for (const suf of TRAILING_JOSA_SUFFIXES) {
    if (suf.length >= w.length) continue;
    if (!w.endsWith(suf)) continue;
    const stem = w.slice(0, w.length - suf.length);
    if (stem.length < 2 || stem.length > 5) continue;
    if (!/^[가-힣]+$/.test(stem)) continue;
    return stem;
  }
  return null;
}

/** GPT가 조사를 붙여 준 경우 어근만 남김. 반복 적용(학생들은 → 학생). */
function normalizeAnswerWord(raw: string): string | null {
  let w = raw
    .trim()
    .replace(/\s+/g, "")
    .normalize("NFC")
    .slice(0, 14);
  if (!w) return null;
  for (let i = 0; i < 6; i++) {
    const stem = stripTrailingJosa(w);
    if (!stem) break;
    w = stem;
  }
  w = w.slice(0, 5);
  if (w.length < 2 || w.length > 5) return null;
  if (!/^[가-힣]+$/.test(w)) return null;
  if (looksLikeWordPlusTrailingJosa(w)) return null;
  return w;
}

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

/** 힌트는 한 줄·짧게: 정답 주변만 잘라 원문 일부만 사용 (너무 긴 문장 방지) */
const MAX_HINT_SENTENCE_CHARS = 72;

function clipSentenceAroundWord(sentence: string, word: string): string {
  const s = sentence.replace(/\s+/g, " ").trim();
  if (s.length <= MAX_HINT_SENTENCE_CHARS) return s;

  let idx = s.indexOf(word);
  let matchLen = word.length;
  if (idx < 0) {
    for (const p of KO_PARTICLES) {
      const wp = word + p;
      const i = s.indexOf(wp);
      if (i >= 0) {
        idx = i;
        matchLen = wp.length;
        break;
      }
    }
  }
  if (idx < 0) {
    return s.slice(0, MAX_HINT_SENTENCE_CHARS - 1) + "…";
  }

  const innerBudget = MAX_HINT_SENTENCE_CHARS - 2; // 양끝 …
  const pad = innerBudget - matchLen;
  const leftPad = Math.max(0, Math.floor(pad / 2));
  const rightPad = pad - leftPad;
  let start = Math.max(0, idx - leftPad);
  let end = Math.min(s.length, idx + matchLen + rightPad);
  let out = s.slice(start, end);
  if (start > 0) out = "…" + out;
  if (end < s.length) out = out + "…";
  return out;
}

/* ───────── 기사에서 문장 추출 ───────── */

type ExtractedSentence = {
  idx: number;
  sentence: string;
  articleIdx: number;
  link: string;
};

function extractSentences(news: NewsItem[]): ExtractedSentence[] {
  const result: ExtractedSentence[] = [];
  let globalIdx = 1;

  for (let ai = 0; ai < news.length; ai++) {
    const n = news[ai]!;
    const fullText = [n.title, n.summary, n.content]
      .filter(Boolean)
      .join(". ")
      .replace(/\n+/g, " ");

    const raw = fullText
      .split(/(?<=[.!?])\s+/)
      .flatMap((s) => s.split(/(?<=다[\.\s])/))
      .map((s) => s.trim())
      .filter((s) => s.length >= 10 && /[가-힣]/.test(s));

    const seen = new Set<string>();
    for (const s of raw) {
      const normalized = s.replace(/\s+/g, " ");
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      result.push({
        idx: globalIdx++,
        sentence: normalized,
        articleIdx: ai + 1,
        link: n.link,
      });
    }
  }

  return result;
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

  const sentences = extractSentences(news.slice(0, NEWS_CONTEXT_COUNT));
  const sentenceMap = new Map<number, ExtractedSentence>();
  for (const s of sentences) sentenceMap.set(s.idx, s);

  const sentenceList = sentences
    .map((s) => `[${s.idx}] ${s.sentence}`)
    .join("\n");

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `너는 한국어 크로스워드 퍼즐 출제자다.

사용자가 번호가 붙은 문장 목록을 제공한다. 이 문장들은 실제 뉴스 기사 원문에서 추출한 것이다.

너의 역할:
1. 각 문장에서 크로스워드 정답으로 적합한 2~5글자 한국어 단어를 찾아라.
2. 반드시 해당 문장 안에 그대로 등장하는 단어만 골라라.
3. ★ word는 조사·복수 접미사가 붙지 않은 **독립 단어(명사·동사 원형 등)**만 쓴다.
   문장에 "사고가", "학생들은", "정책을"처럼 붙어 있어도 word에는 "사고", "학생", "정책"처럼 조사 없는 형태만 넣는다.
   절대 word에 이/가/을/를/은/는/에/의/도/만/와/과/로/으로/에서/까지/부터/들/이다(서술어 붙은 명사 뒤) 등을 붙이지 마라.
4. 단어들 사이에 공통 글자가 최대한 많도록 골라라 (크로스워드 교차를 위해).
   예: "경찰"과 "경기" → '경'에서 교차 가능.
5. definition에는 정답 단어의 사전적 의미를 국어사전 스타일로 한 문장으로 쓴다.
6. 총 ${GPT_WORD_COUNT}개 문항을 만들어라.

응답 형식 (JSON만 출력, 다른 말 없이):
{"items": [{"word": "단어", "sentence_idx": 번호, "definition": "사전적 의미"}, ...]}

- word: 조사 없는 2~5글자 단어만. 문장 속에 그 형태가 부분 문자열로 포함되면 된다(예: 문장의 "사고가"에 대해 word는 "사고").
- sentence_idx: 해당 단어가 포함된 문장의 번호 (사용자가 제공한 [번호])
- definition: 단어의 사전적 의미 (쉬운 말, 한 문장)`,
      },
      {
        role: "user",
        content: `아래 문장들에서 크로스워드 문항 ${GPT_WORD_COUNT}개를 만들어라.
각 문항의 word는 해당 sentence_idx 문장 안에 등장하는 **조사 없는** 2~5글자 단어여야 한다(문장에 "단어+조사"로만 나와도, word는 어근만).
단어들 사이에 공통 글자가 많은 조합을 우선 선택해라.

${sentenceList}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error("GPT-4o가 빈 응답을 반환했습니다.");
  }

  const parsed = JSON.parse(raw) as {
    items?: Array<{ word?: string; sentence_idx?: number; definition?: string }>;
  };
  const items = parsed.items ?? [];

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("GPT-4o 응답에서 문항 배열을 찾을 수 없습니다.");
  }

  const entries: WordEntry[] = [];
  const usedWords = new Set<string>();

  for (const item of items) {
    const word = normalizeAnswerWord(String(item?.word ?? ""));
    if (!word) continue;
    if (usedWords.has(word)) continue;

    const sIdx = Number(item?.sentence_idx ?? 0);
    const sentenceData = sentenceMap.get(sIdx);
    if (!sentenceData) continue;

    const wordInSentence =
      sentenceData.sentence.includes(word) ||
      KO_PARTICLES.some((p) => sentenceData.sentence.includes(word + p));
    if (!wordInSentence) continue;

    const shortSentence = clipSentenceAroundWord(sentenceData.sentence, word);
    const hint = applyUnderscoreHint(word, shortSentence);
    const definition = String(item?.definition ?? "").trim();
    const link = sentenceData.link;

    usedWords.add(word);
    entries.push({ word, hint, definition, link });
  }

  const result = buildCrossword(entries);

  const finalGrid =
    result.grid.length === GRID_SIZE && result.grid[0]?.length === GRID_SIZE
      ? result.grid
      : emptyGrid();

  return { words: result.words, grid: finalGrid };
}
