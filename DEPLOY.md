# 배포 안내 (Cloudflare) · 브리핑 포에버

이 문서는 이 앱을 Cloudflare 에 올릴 사람(또는 AI)을 위한 전달 사항입니다.
앱 기능 설명은 `README.md` 에 있습니다.

## 한눈에 보기

| 항목 | 내용 |
|---|---|
| 앱 | 브리핑 포에버 (Briefing Forever). WoW: Forever 공격대 브리핑 웹앱. 지도 위에 공대원·보스를 놓고 그리면 같은 주소를 연 사람들에게 실시간으로 보임 |
| 함께 들어 있는 앱 | **던전 도감** `dungeons.html` (Cloudflare 에서는 `/dungeons`). 던전 선택, 지도·보스 위치, 공략, 획득 아이템, 그리기, 같은 실시간 공유 |
| 저장소 | <https://github.com/gray5353/raid-planner> (공개), 배포 브랜치 `main` |
| 지금 운영 중 | GitHub Pages <https://gray5353.github.io/raid-planner/> (실시간은 공개 MQTT 중계 서버로 동작) |
| 목표 | Cloudflare **Workers** 로 배포 → 실시간을 우리 전용 서버(Durable Objects)로 |
| 빌드 | 없음. 정적 파일 + Worker 하나. 배포 명령은 `npx wrangler deploy` |
| 확인된 범위 | `wrangler dev` (wrangler 4.151.0, workerd) 로컬 실행에서 실시간·저장·재시작 후 복구까지 테스트 완료. **실제 Cloudflare 계정 배포는 아직 안 함** |

## 구조

```
index.html, css/, js/   브리핑 화면 (정적 파일, 빌드 과정 없음)
dungeons.html           던전 도감 화면 (js/dungeons.js, js/dungeon-data.js, js/dungeon-maps.js, css/dungeons.css)
assets/maps/            던전 지도 그림 44장 (약 5.6MB, 보는 층만 내려받음)
worker/index.js         Cloudflare Worker
                          /ws?room=<작전판>  → 작전판마다 Durable Object(Room) 하나가 웹소켓 접속을 받음
                          그 밖의 경로       → 정적 파일 (Workers Assets)
wrangler.toml           Worker 이름 raid-planner, Durable Object 바인딩 ROOMS → 클래스 Room (SQLite)
.assetsignore           정적 파일로 공개하지 않을 파일 목록 (server.js, wrangler.toml, worker/ 등)
server.js               Node 로 직접 운영할 때의 대체 서버. Cloudflare 배포에는 쓰지 않음
js/config.js            실시간 방식 설정. mode: 'auto' 그대로 두면 됨
```

`mode: 'auto'` 는 접속한 주소의 `/ws` 실시간 서버를 먼저 쓰고, 연결이 안 되면(GitHub Pages 처럼 서버가 없는 곳) 공개 MQTT 중계 서버로 넘어갑니다.
그래서 Cloudflare Worker 로 올리면 **설정 변경 없이** 우리 서버를 씁니다.

## 배포 방법

### 방법 1. 대시보드에서 저장소 연결 (추천, 이후 자동 배포)

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create**
2. **Workers** 쪽의 **Import a repository** 선택 → GitHub 연결 → `gray5353/raid-planner`
3. 설정
   - Worker / Project name: **`raid-planner`** (wrangler.toml 의 `name` 과 같아야 빌드가 됨)
   - Production branch: `main`
   - Root directory: `/` (비워 둠)
   - Build command: 비워 둠
   - Deploy command: `npx wrangler deploy` (기본값)
4. **Deploy** → 끝나면 `https://raid-planner.<계정 서브도메인>.workers.dev` 가 생김
5. 이후 `main` 에 커밋이 올라가면 자동으로 다시 배포됨

### 방법 2. 명령줄

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler deploy
```

## 꼭 지켜야 할 것

- **Pages 가 아니라 Workers 로** 만들 것. Pages 로 올리면 정적 파일만 올라가고 Durable Object 가 없어서, 앱이 공개 MQTT 중계 서버로 넘어갑니다 (동작은 하지만 우리 전용 서버가 아님).
- `wrangler.toml` 의 `[[migrations]]` (`tag = "v1"`, `new_sqlite_classes = ["Room"]`) 를 지우거나 바꾸지 말 것. 클래스 이름 `Room` 을 바꾸면 저장된 작전판이 사라집니다. 바꿔야 하면 새 migration 을 추가.
- `.assetsignore` 를 지우지 말 것. 지우면 `server.js`, `wrangler.toml` 등이 웹에 공개됩니다.
- Durable Objects (SQLite 방식) 는 Workers 무료 요금제에서도 쓸 수 있는 것으로 알고 있습니다. 배포 중에 유료 요금제(Workers Paid, 월 5달러)를 요구하면 진행하지 말고 사용자에게 먼저 물어볼 것.
- 앱은 **도메인 루트**에서 동작해야 합니다. 실시간 주소가 `/ws` 로 고정이라 `example.com/briefing/*` 처럼 하위 경로에 올리면 안 됩니다. 아래 중 하나로 하세요.
  - workers.dev 주소 그대로 사용
  - 하위 도메인 연결 (예: `briefing.example.com`): Worker → **Settings → Domains & Routes → Add → Custom domain** (도메인이 Cloudflare 에 있어야 함)
  - 기존 사이트 페이지에는 iframe 으로 넣기 (아래)

## 기존 사이트에 넣기

```html
<iframe src="https://briefing.example.com/?room=our-raid-x7k2"
        style="width:100%;height:900px;border:0"
        allow="clipboard-write; fullscreen"></iframe>
```

- `room` 값이 같으면 같은 작전판. 비우면 새 작전판이 만들어지고 주소에 붙습니다.
- `room` 은 영문·숫자·`-`·`_` 만 (최대 40자). 한글은 지워져서 매번 새 작전판이 되니 쓰지 말 것. 남이 짐작하기 어려운 값으로.
- 늘 같은 작전판을 열고 싶으면 `js/config.js` 의 `defaultRoom` 에 이름을 넣어도 됩니다.
- 공대원에게는 주소 끝에 `&mode=view` 가 붙은 **보기 링크**를 줍니다 (앱 상단 "보기 링크" 버튼).

## 배포 후 확인

1. 주소를 열면 시작 화면("브리핑 포에버" 안내 글)이 나왔다가 사라지고, 오른쪽 위에 **초록 점 + "실시간 연결됨"** 이 보여야 함
2. 브라우저 개발자 도구 콘솔에서 `RP.debug.sync.mode` 가 **`'ws'`** 여야 함 (`'mqtt'` 면 Durable Object 연결 실패 → Pages 로 올렸거나 `/ws` 가 막힌 것)
3. 아래 주소의 응답 확인

   | 주소 | 기대 결과 |
   |---|---|
   | `/` | 200 (앱 화면) |
   | `/dungeons` | 200 (던전 도감. `/dungeons.html` 은 여기로 307 이동) |
   | `/server.js`, `/wrangler.toml`, `/DEPLOY.md` | 404 (공개되면 안 됨) |
   | `/ws?room=test` (그냥 열기) | 426 "WebSocket only" |

4. 레이드 하나 고르고 → 다른 브라우저(또는 휴대폰)에서 **보기 링크** 열기 → 한쪽에서 공대원을 끌면 다른 쪽도 움직여야 함
5. 둘 다 닫았다가 다시 열어도 내용이 남아 있어야 함 (Durable Object 저장)

## 로컬에서 미리 실행

```bash
npm install
```

```bash
npx wrangler dev
```

→ <http://localhost:8787>

## 알아 둘 점

- **권한**: 로그인이 없습니다. 편집 링크(주소에 `room` 만 있는 것)를 아는 사람은 누구나 편집할 수 있고, 보기 링크는 편집 도구를 숨길 뿐입니다. 편집 비밀번호는 나중에 추가 예정.
- **데이터**: 작전판(room)마다 Durable Object 저장소에 JSON 으로 저장 (키 `n`, `p0`, `p1`… 로 나눠 저장). 지형 이미지는 브라우저에서 약 230KB 이하로 줄여서 보냄. 웹소켓 메시지 하나가 1MiB 를 넘지 않도록 클라이언트·서버 모두 나눠 보냄.
- **GitHub Pages**: Cloudflare 가 정상이면 GitHub Pages 는 예비로 두거나, 저장소 Settings → Pages 에서 끌 수 있음 (사용자에게 확인 후).
- **문구 수정**: 화면 문구를 바꾸면 `js/i18n-en.js` 에 영어도 넣어야 함 (한국어 문장이 번역 열쇠).
- **앞으로 할 일**: wow4.net 레이드 빌더의 "브리핑" 버튼으로 명단 넘겨받기, 편집 비밀번호, 하이잘·Barrow Deeps 정식 보스 이름(2026-12-09 개방 후).
