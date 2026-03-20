# GCP VM 배포 가이드 (`yaongc.newscloud.sbs.co.kr`)

Next.js 16 앱을 **Compute Engine VM**에 두고, **Nginx**로 리버스 프록시 + **Let’s Encrypt**로 HTTPS를 쓰는 흐름입니다.

> **배포 방식:** Vercel 자동 배포는 사용하지 않습니다. GitHub에 푸시한 뒤 **VM에서** `git pull` → `npm run build` → `pm2 restart crossword` 를 실행해야 반영됩니다. 요약은 **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

## 0. 사전 준비

- DNS: `yaongc.newscloud.sbs.co.kr` **A 레코드**가 해당 VM의 **외부 IP**를 가리키게 설정
- GCP 방화벽: **TCP 80, 443** 인바운드 허용 (또는 HTTP/HTTPS 태그 규칙)
- VM OS 예: Ubuntu 22.04 LTS

## 1. VM에 Node.js 설치

```bash
# Node 20 LTS (예시)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v && npm -v
```

## 2. 코드 배치

**방법 A – Git 클론 (권장)**

```bash
sudo mkdir -p /var/www && sudo chown $USER:$USER /var/www
cd /var/www
git clone https://github.com/eunmi-momo/crossword.git
cd crossword
```

**방법 B – 로컬에서 빌드 후 rsync/scp**

```bash
# 로컬 PC
npm ci && npm run build
rsync -avz --exclude node_modules ./ user@VM_IP:/var/www/crossword/
# VM에서 npm ci && npm run build 다시 하는 편이 깔끔함
```

## 3. 환경 변수

로컬 `.env.local`과 **동일한 키**를 VM에 둡니다.

```bash
cd /var/www/crossword
nano .env.production.local
```

최소 예시 (값은 실제로 교체):

```env
OPENAI_API_KEY=...
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Next는 빌드 시 `NEXT_PUBLIC_*`가 번들에 들어갑니다. 값을 바꾼 뒤에는 **`npm run build`를 다시** 해야 합니다.

## 4. 빌드 & 실행

```bash
cd /var/www/crossword
npm ci
npm run build
```

개발용 포트가 아니라 기본 **3000**으로 띄웁니다.

```bash
PORT=3000 npm run start
```

접속 테스트(VM 안에서):

```bash
curl -sI http://127.0.0.1:3000
```

## 5. PM2로 상시 구동

```bash
sudo npm install -g pm2
cd /var/www/crossword
pm2 start npm --name "crossword" -- start
pm2 save
pm2 startup   # 출력되는 sudo 명령 그대로 실행
```

**이후 코드 반영(매번):** 저장소 경로에 맞춰 실행합니다.

```bash
cd crossword
# 또는: cd /var/www/crossword
git pull
npm run build
pm2 restart crossword
```

`package-lock.json` 변경이 크면 `git pull` 후 `npm ci` 를 한 번 실행한 다음 `npm run build` 하세요.  
한 줄로: `cd /var/www/crossword && git pull && npm ci && npm run build && pm2 restart crossword` (경로 조정)

## 6. Nginx 리버스 프록시

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/yaongc.newscloud.sbs.co.kr
```

내용 예시:

```nginx
server {
    listen 80;
    server_name yaongc.newscloud.sbs.co.kr;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

활성화:

```bash
sudo ln -sf /etc/nginx/sites-available/yaongc.newscloud.sbs.co.kr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 7. HTTPS (Let’s Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yaongc.newscloud.sbs.co.kr
```

인증서 자동 갱신은 certbot이 crontab/systemd 타이머로 잡습니다.

## 8. 크론 (Vercel 미사용)

프로덕션이 GCP VM만 쓰는 경우 **Vercel Cron은 동작하지 않습니다.** 다음 중 하나로 매일 퍼즐을 준비하세요.

- **GCP Cloud Scheduler** → VM 외부 URL `https://yaongc.newscloud.sbs.co.kr/api/cron` GET (또는 배포 시 만든 시크릿 헤더)
- 또는 VM **crontab**에서 `curl`로 같은 URL 호출

`/api/cron`이 **인증 없이** 열려 있으면 URL만 알면 누구나 호출할 수 있으므로, **시크릿 쿼리/헤더**를 API에 추가하는 것을 권장합니다.

## 9. 자주 나는 이슈

| 증상 | 점검 |
|------|------|
| 502 Bad Gateway | `pm2 status`, `curl localhost:3000`, Nginx `error.log` |
| 빈 화면 / 500 | `pm2 logs crossword`, `NEXT_PUBLIC_*` 재빌드 여부 |
| 퍼즐 생성 타임아웃 | `app/api/puzzle/route.ts`의 `maxDuration`은 **Vercel 전용** — VM에서는 Node 프로세스 제한만 적용 |

---

**정리:** VM에는 **Node + PM2 + Nginx + SSL**, 코드는 **`npm ci` → `npm run build` → `npm run start`**, 도메인은 DNS·방화벽·Nginx `server_name`을 맞추면 됩니다.
