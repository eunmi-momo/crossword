# 뉴스 크로스워드

Next.js 기반 뉴스 RSS → 크로스워드 생성 · Supabase 저장 · 랭킹.

## 배포 (GCP VM) — **자동 배포 없음**

**GitHub에 푸시만 해서는 실서비스가 바뀌지 않습니다.**  
프로덕션 반영은 VM에서 수동으로 빌드·재시작해야 합니다.

```bash
cd crossword          # 실제 클론 경로에 맞게
git pull
npm run build
pm2 restart crossword
```

자세한 절차·크론·환경 변수: **[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)** · 초기 VM 세팅: **[docs/deploy-gcp-vm.md](./docs/deploy-gcp-vm.md)**

---

## 로컬 개발

```bash
npm install
npm run dev
```

브라우저: [http://localhost:3100](http://localhost:3100) (이 프로젝트는 포트 **3100**)

## 퍼즐이 안 바뀔 때

- `/api/puzzle`은 **오늘 날짜** 기준 DB(또는 생성) 한 세트를 돌려줍니다.
- Supabase `puzzles` 저장이 안 되면 `supabase/puzzles-rls.sql` 참고.
- 수동 재생성: `GET /api/puzzle?force=1` (비용·시간 큼).

## 기술 스택

Next.js 16, React 19, Tailwind, Supabase, OpenAI.

## 라이선스

Private 프로젝트.
