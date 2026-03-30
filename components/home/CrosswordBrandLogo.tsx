"use client";

/**
 * 뉴 / 크로스워드 교차 로고 — 세로 뉴→스 + 가로 크로스워드
 */
export function CrosswordBrandLogo() {
  return (
    <div className="cb-logo mx-auto w-max">
      <div
        className="grid grid-cols-5 gap-[0.35rem] sm:gap-2"
        style={{ perspective: "800px" }}
      >
        {/* row 0: 빈칸 + 뉴(중앙 정렬 느낌) */}
        <div className="cb-cell cb-cell--ghost" aria-hidden />
        <div className="cb-cell cb-cell--ghost" aria-hidden />
        <div
          className="cb-tile cb-tile--green cb-tile-flip"
          style={{ animationDelay: "0ms" }}
        >
          <span className="cb-badge">1</span>
          뉴
        </div>
        <div className="cb-cell cb-cell--ghost" aria-hidden />
        <div className="cb-cell cb-cell--ghost" aria-hidden />

        {/* row 1: 크로스워드 */}
        {(["크", "로", "스", "워", "드"] as const).map((ch, i) => {
          const delay = 120 + i * 90;
          const is스 = ch === "스";
          return (
            <div
              key={ch + i}
              className={
                is스
                  ? "cb-tile cb-tile--green cb-tile-flip"
                  : "cb-tile cb-tile--glass cb-tile-flip"
              }
              style={{ animationDelay: `${delay}ms` }}
            >
              {i === 0 && <span className="cb-badge">2</span>}
              {ch}
            </div>
          );
        })}
      </div>
      <p className="cb-news-crossword-label mt-3 text-center text-[0.65rem] font-medium tracking-[0.35em] text-white/45 sm:text-xs">
        NEWS CROSSWORD
      </p>
    </div>
  );
}
