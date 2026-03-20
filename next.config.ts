import type { NextConfig } from "next";

/** 프로덕션 URL: `http://<호스트>:3000/crossword` — 같은 VM의 다른 앱(예: 3001 `/election_graph`)과 경로로 구분 */
const basePath = "/crossword";

const nextConfig: NextConfig = {
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
