# 배포 워크플로 (GCP VM)

## GitHub 푸시만으로는 프로덕션이 바뀌지 않음

배포는 **Vercel 자동 배포를 사용하지 않습니다.**  
코드를 수정해 GitHub에 `git push`해도 **프로덕션(실서비스)은 자동으로 갱신되지 않습니다.**

프로덕션에 반영하려면 **GCP VM에 SSH로 접속한 뒤**, 저장소 디렉터리에서 아래를 **직접 실행**해야 합니다.

## 코드 반영 명령 (매 배포마다)

클론해 둔 프로젝트 폴더로 이동합니다. (경로는 환경에 맞게 조정: `~/crossword`, `/var/www/crossword` 등)

```bash
cd crossword
git pull
npm run build
pm2 restart crossword
```

- **`package-lock.json`이 크게 바뀐 커밋**이면 `git pull` 다음에 `npm ci`를 한 번 실행한 뒤 `npm run build`를 권장합니다.
- **`.env.production.local`의 값을 바꾼 경우**에도 `NEXT_PUBLIC_*` 등은 빌드에 박히므로 **`npm run build`를 다시** 해야 합니다.

## 최초 VM 구성 (Nginx, SSL, PM2 최초 실행)

`docs/deploy-gcp-vm.md` 를 참고하세요.

## 자정 퍼즐 크론

Vercel Cron은 사용하지 않습니다. (레거시 `vercel.json`은 제거됨.)  
**GCP Cloud Scheduler** 또는 VM **crontab**으로 프로덕션 URL의 `GET /api/cron` 을 호출하세요.  
상세는 `deploy-gcp-vm.md` 8절.

## AI·협업 시 참고

저장소를 수정하는 도구/에이전트는 **커밋·푸시 후** 사용자에게 **“VM에서 위 명령 실행 필요”**를 안내하면 됩니다.
