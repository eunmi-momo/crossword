This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 퍼즐이 안 바뀔 때

- **오늘 날짜로 저장된 한 문제**가 `/api/puzzle`(force 없음)에서 나옵니다. 새로고침만으로는 GPT가 다시 돌지 않습니다.
- **Supabase `puzzles` upsert가 실패**(RLS 등)하면, 예전에는 DB에 남은 옛 퍼즐만 보였습니다. 지금은 **방금 생성한 퍼즐**을 우선 반환합니다.
- 수동으로 오늘 퍼즐을 다시 만들려면 브라우저/도구에서 `GET /api/puzzle?force=1` 호출(시간·API 비용 큼).

### Table Editor 내용이 화면과 다를 때

화면은 새 퍼즐인데 **Supabase `puzzles` 행이 예전이면** → **저장(INSERT/UPDATE)이 막힌 상태**입니다.

1. Supabase 대시보드 → **SQL Editor**
2. 저장소의 `supabase/puzzles-rls.sql` 내용을 붙여 넣고 **Run**
3. 터미널에서 `/api/puzzle?force=1` 로 한 번 더 생성
4. **Table Editor → `puzzles`** 에서 해당 `date` 행의 `data` 가 바뀌었는지 확인

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3100](http://localhost:3100) with your browser (this project uses port **3100**).

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
