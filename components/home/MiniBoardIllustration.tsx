"use client";

/** 장식용 5×5 — 검은칸 / 유리글자 / 초록열 / 보라 펄스 / 우하단 커서 */
type CellKind =
  | "block"
  | "letter"
  | "letter-green"
  | "letter-purple"
  | "cursor";

const ROWS: CellKind[][] = [
  ["block", "block", "letter-green", "letter", "letter"],
  ["letter", "letter-green", "letter-purple", "letter-green", "block"],
  ["block", "letter-green", "block", "block", "block"],
  ["block", "block", "block", "letter", "letter"],
  ["block", "block", "block", "block", "cursor"],
];

const CHARS: (string | null)[][] = [
  [null, null, "P", "R", "E"],
  ["N", "E", "W", "S", null],
  [null, "S", null, null, null],
  [null, null, null, "T", "A"],
  [null, null, null, null, null],
];

export function MiniBoardIllustration() {
  return (
    <div className="mini-board-wrap relative mx-auto mt-2 w-full max-w-[min(100%,18rem)] px-2 sm:max-w-[20rem]">
      {/* 둥실 떠다니는 알파벳 타일 */}
      <div
        className="mini-float-tile mini-float-tile--a"
        aria-hidden
      >
        A
      </div>
      <div
        className="mini-float-tile mini-float-tile--z"
        aria-hidden
      >
        Z
      </div>
      <div
        className="mini-float-tile mini-float-tile--q"
        aria-hidden
      >
        Q
      </div>

      <div
        className="mini-board glass-board-inner rounded-xl p-2 sm:p-3"
        role="img"
        aria-label="샘플 크로스워드 보드"
      >
        <div className="grid grid-cols-5 gap-[3px] sm:gap-1">
          {ROWS.map((row, ri) =>
            row.map((kind, ci) => {
              const ch = CHARS[ri]?.[ci] ?? null;
              if (kind === "block") {
                return (
                  <div
                    key={`${ri}-${ci}`}
                    className="mini-cell mini-cell--block"
                  />
                );
              }
              if (kind === "cursor") {
                return (
                  <div
                    key={`${ri}-${ci}`}
                    className="mini-cell mini-cell--cursor flex items-end justify-end pb-0.5 pr-0.5"
                  >
                    <span className="mini-cursor-blink text-[0.65rem] font-light text-violet-300 sm:text-sm">
                      |
                    </span>
                  </div>
                );
              }
              const cls =
                kind === "letter-green"
                  ? "mini-cell mini-cell--glass mini-cell--green"
                  : kind === "letter-purple"
                    ? "mini-cell mini-cell--glass mini-cell--purple-pulse"
                    : "mini-cell mini-cell--glass";
              return (
                <div key={`${ri}-${ci}`} className={cls}>
                  {ch ? (
                    <span className="mini-cell-char">{ch}</span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 콤보 위젯 */}
      <div className="mini-combo glass-combo-pill" aria-hidden>
        <span className="text-base leading-none">⚡</span>
        <span className="text-xs font-bold tabular-nums">×3</span>
        <span className="mini-combo-sparkles" aria-hidden>
          <span className="mini-dot" />
          <span className="mini-dot" />
          <span className="mini-dot" />
        </span>
      </div>
    </div>
  );
}
