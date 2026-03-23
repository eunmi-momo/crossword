/**
 * HTTP(비보안 컨텍스트)에서도 동작하도록 클립보드 복사 fallback 포함
 * @returns 성공 시 "clipboard" | "exec", 실패 시 "failed"
 */
export async function copyTextToClipboard(
  text: string
): Promise<"clipboard" | "exec" | "failed"> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "clipboard";
    }
  } catch {
    /* fallback */
  }

  try {
    if (typeof document === "undefined") return "failed";
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return "exec";
  } catch {
    /* */
  }

  return "failed";
}
