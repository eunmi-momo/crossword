/**
 * `next.config`의 `basePath`와 동일해야 합니다.
 * 클라이언트 `fetch`, `<img src>` 등은 Next가 자동으로 붙여주지 않아 여기서 접두사를 붙입니다.
 * `next/link`, `useRouter().push`는 basePath를 자동 처리하므로 그대로 `/...` 사용하면 됩니다.
 */
export function getBasePath(): string {
  const b = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (!b) return "";
  return b.startsWith("/") ? b : `/${b}`;
}

/** 절대 경로(/)로 시작하는 URL에 basePath 접두사 추가 */
export function withBasePath(path: string): string {
  const base = getBasePath();
  if (!path.startsWith("/")) {
    const joined = `${base}/${path}`.replace(/\/{2,}/g, "/");
    return joined || "/";
  }
  if (!base) return path;
  if (path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}
