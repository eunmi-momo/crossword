export type Direction = "across" | "down";

export type PuzzleClue = {
  word: string;
  hint: string;
  definition: string;
  link: string;
};

export type Placement = {
  id: number;
  number: number;
  word: string;
  hint: string;
  definition: string;
  link: string;
  row: number;
  col: number;
  dir: Direction;
  length: number;
};

export type CrosswordLayout = {
  width: number;
  height: number;
  grid: (string | null)[][];
  numbers: (number | null)[][];
  placements: Placement[];
};

type Cell = { ch: string; number?: number };

function isHangulChar(ch: string): boolean {
  return /^[\uac00-\ud7a3]$/.test(ch);
}

function sanitizeWord(word: string): string {
  return (word ?? "").trim().replace(/\s+/g, "");
}

function tryPlace(
  board: Map<string, Cell>,
  placed: Placement[],
  clue: PuzzleClue,
  dir: Direction,
  row: number,
  col: number
): { ok: boolean; intersections: number; cells?: Array<{ r: number; c: number; ch: string }> } {
  const w = sanitizeWord(clue.word);
  if (!w || w.length < 2 || w.length > 5) return { ok: false, intersections: 0 };

  const cells: Array<{ r: number; c: number; ch: string }> = [];
  let intersections = 0;

  for (let i = 0; i < w.length; i++) {
    const r = dir === "across" ? row : row + i;
    const c = dir === "across" ? col + i : col;
    const ch = w[i]!;
    if (!isHangulChar(ch)) return { ok: false, intersections: 0 };

    const key = `${r},${c}`;
    const existing = board.get(key);
    if (existing) {
      if (existing.ch !== ch) return { ok: false, intersections: 0 };
      intersections++;
    }
    cells.push({ r, c, ch });
  }

  // 단어 앞/뒤 칸이 다른 글자와 붙어있으면 배치 불가 (가독성)
  const beforeKey =
    dir === "across" ? `${row},${col - 1}` : `${row - 1},${col}`;
  const afterKey =
    dir === "across"
      ? `${row},${col + w.length}`
      : `${row + w.length},${col}`;
  if (board.has(beforeKey) || board.has(afterKey)) return { ok: false, intersections: 0 };

  // 옆으로 붙는 “평행 접촉” 최소화: 각 글자 칸의 좌/우(세로 단어), 상/하(가로 단어) 체크
  for (let i = 0; i < w.length; i++) {
    const r = dir === "across" ? row : row + i;
    const c = dir === "across" ? col + i : col;
    const key = `${r},${c}`;
    const existing = board.get(key);
    if (existing) continue; // 교차 지점은 허용

    if (dir === "across") {
      if (board.has(`${r - 1},${c}`) || board.has(`${r + 1},${c}`)) return { ok: false, intersections: 0 };
    } else {
      if (board.has(`${r},${c - 1}`) || board.has(`${r},${c + 1}`)) return { ok: false, intersections: 0 };
    }
  }

  // 기존 단어들과 완전 겹침 방지
  for (const p of placed) {
    if (p.dir !== dir) continue;
    if (dir === "across" && p.row === row) {
      const a1 = p.col;
      const a2 = p.col + p.length - 1;
      const b1 = col;
      const b2 = col + w.length - 1;
      const overlap = Math.max(a1, b1) <= Math.min(a2, b2);
      if (overlap && intersections === 0) return { ok: false, intersections: 0 };
    }
    if (dir === "down" && p.col === col) {
      const a1 = p.row;
      const a2 = p.row + p.length - 1;
      const b1 = row;
      const b2 = row + w.length - 1;
      const overlap = Math.max(a1, b1) <= Math.min(a2, b2);
      if (overlap && intersections === 0) return { ok: false, intersections: 0 };
    }
  }

  return { ok: true, intersections, cells };
}

export function buildCrosswordLayout(clues: PuzzleClue[]): CrosswordLayout {
  const input = clues
    .map((c) => ({ ...c, word: sanitizeWord(c.word) }))
    .filter((c) => c.word.length >= 2 && c.word.length <= 5)
    .slice(0, 10);

  // 긴 단어부터 배치
  const sorted = [...input].sort((a, b) => b.word.length - a.word.length);

  const board = new Map<string, Cell>();
  const placements: Placement[] = [];

  // 첫 단어: (0,0) 가로
  if (sorted.length > 0) {
    const first = sorted[0]!;
    for (let i = 0; i < first.word.length; i++) {
      board.set(`0,${i}`, { ch: first.word[i]! });
    }
    placements.push({
      id: 1,
      number: 0,
      word: first.word,
      hint: first.hint,
      definition: first.definition,
      link: first.link,
      row: 0,
      col: 0,
      dir: "across",
      length: first.word.length,
    });
  }

  let nextId = 2;
  for (const clue of sorted.slice(1)) {
    let best:
      | { dir: Direction; row: number; col: number; intersections: number; cells: Array<{ r: number; c: number; ch: string }> }
      | null = null;

    // 교차 후보 탐색: 기존 보드의 글자와 clue 글자 매칭
    for (const [key, cell] of board.entries()) {
      const [rStr, cStr] = key.split(",");
      const r = Number(rStr);
      const c = Number(cStr);
      const ch = cell.ch;

      for (let i = 0; i < clue.word.length; i++) {
        if (clue.word[i] !== ch) continue;

        // 가로 배치(기존 글자 위치가 i번째 글자가 되도록)
        {
          const row = r;
          const col = c - i;
          const attempt = tryPlace(board, placements, clue, "across", row, col);
          if (attempt.ok && attempt.cells) {
            if (!best || attempt.intersections > best.intersections) {
              best = {
                dir: "across",
                row,
                col,
                intersections: attempt.intersections,
                cells: attempt.cells,
              };
            }
          }
        }
        // 세로 배치
        {
          const row = r - i;
          const col = c;
          const attempt = tryPlace(board, placements, clue, "down", row, col);
          if (attempt.ok && attempt.cells) {
            if (!best || attempt.intersections > best.intersections) {
              best = {
                dir: "down",
                row,
                col,
                intersections: attempt.intersections,
                cells: attempt.cells,
              };
            }
          }
        }
      }
    }

    // 교차가 안 되면, 아래로 쌓기(가로) 시도
    if (!best) {
      const baseRow = placements.length * 2;
      const baseCol = 0;
      const attempt = tryPlace(board, placements, clue, "across", baseRow, baseCol);
      if (attempt.ok && attempt.cells) {
        best = {
          dir: "across",
          row: baseRow,
          col: baseCol,
          intersections: attempt.intersections,
          cells: attempt.cells,
        };
      }
    }

    if (!best) continue;

    for (const c of best.cells) board.set(`${c.r},${c.c}`, { ch: c.ch });
    placements.push({
      id: nextId++,
      number: 0,
      word: clue.word,
      hint: clue.hint,
      definition: clue.definition,
      link: clue.link,
      row: best.row,
      col: best.col,
      dir: best.dir,
      length: clue.word.length,
    });
  }

  // 좌표 정규화
  let minR = Infinity,
    minC = Infinity,
    maxR = -Infinity,
    maxC = -Infinity;
  for (const key of board.keys()) {
    const [rStr, cStr] = key.split(",");
    const r = Number(rStr);
    const c = Number(cStr);
    minR = Math.min(minR, r);
    minC = Math.min(minC, c);
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
  }
  if (!Number.isFinite(minR) || !Number.isFinite(minC)) {
    return { width: 0, height: 0, grid: [], numbers: [], placements: [] };
  }

  const height = maxR - minR + 1;
  const width = maxC - minC + 1;
  const grid: (string | null)[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => null)
  );
  const numbers: (number | null)[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => null)
  );

  // grid 채우기
  for (const [key, cell] of board.entries()) {
    const [rStr, cStr] = key.split(",");
    const r = Number(rStr) - minR;
    const c = Number(cStr) - minC;
    grid[r]![c] = cell.ch;
  }

  // 번호 매기기(가로/세로 시작칸)
  const starts: Array<{ r: number; c: number; dir: Direction; placement: Placement }> = [];
  for (const p of placements) {
    const r = p.row - minR;
    const c = p.col - minC;
    starts.push({ r, c, dir: p.dir, placement: p });
  }
  // 같은 칸에서 가로/세로 시작이 겹치면 같은 번호
  starts.sort((a, b) => (a.r - b.r) || (a.c - b.c) || (a.dir === "across" ? -1 : 1));
  let n = 1;
  const keyToNumber = new Map<string, number>();
  for (const s of starts) {
    const k = `${s.r},${s.c}`;
    const existing = keyToNumber.get(k);
    const num = existing ?? n++;
    keyToNumber.set(k, num);
    numbers[s.r]![s.c] = num;
  }
  for (const p of placements) {
    const r = p.row - minR;
    const c = p.col - minC;
    p.number = keyToNumber.get(`${r},${c}`) ?? 0;
    p.row = r;
    p.col = c;
  }

  return { width, height, grid, numbers, placements };
}

