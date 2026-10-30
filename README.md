# 공격대 작전판 (WoW: Forever)

보스별 지형 위에 공대원·징표를 끌어다 놓고, 그림판처럼 그려서 공격대에게 설명하는 웹 앱입니다.
같은 주소를 연 사람들 화면에 실시간으로 똑같이 보입니다.

## 할 수 있는 것

| 기능 | 설명 |
|---|---|
| 공대원 명단 | 이름·직업·역할 입력, 여러 줄 **일괄 입력** (`홍길동 전사 탱`) |
| 배치 | 명단에서 지도 위로 끌어다 놓기, 지도 밖으로 끌어내면 해제, **역할별 자동 배치** |
| 보스·징표 | 보스 동그라미, 쫄, 공격대 징표 8종을 끌어다 놓기 |
| 행동 연결 | 공대원을 **2초 길게 누르면** 공격·탱·힐·차단·해제 메뉴 → 대상 클릭. 힐은 공대원만, 나머지는 보스·쫄·징표만 |
| 이펙트 | 탱(사슬·방패·어그로 고리), 원거리 공격(투명 공격 선 + 발사체), 근거리 공격(베기), 힐(투명 힐링 선 + 날아가는 +), 차단(보라 점선 + 순서 번호 + ⊘) |
| 그림판 | 펜, 직선, 화살표, 원, 사각형, 글자, 지우개, 20색 + 직접 고르기, 굵기 3단계, 채우기, 점선, 되돌리기 |
| 보스·단계 | 보스마다 여러 단계(페이즈). 새 단계는 현재 배치를 복사해서 시작하고, 단계를 넘기면 토큰이 움직이는 애니메이션 |
| 지형 | 기본 경기장 3종, 이미지 파일·주소·**Ctrl+V 붙여넣기**·끌어다 놓기 |
| 발표 | **발표 시작**을 누르면 내가 보는 보스·단계를 모두가 따라봄. 핑(Alt+클릭), **크게 보기(F)** |
| 공유 | **편집 링크**(공대장용) / **보기 링크**(공대원용, 편집 도구 숨김) |
| 접속자 | 처음 들어오면 이름 입력(명단에서 고르기 가능), 상단 **접속 N명**을 누르면 누가 접속했는지 목록, 명단에 접속 중인 사람 초록 점 |
| 백업 | JSON 백업 저장·불러오기 |

조작: ←/→ 단계, ↑/↓ 보스, 휠 확대, 빈 곳 드래그로 지도 이동 (그리기 중엔 Space+드래그),
V 선택 · P 펜 · L 직선 · A 화살표 · O 원 · R 사각형 · T 글자 · E 지우개 · Ctrl+Z 되돌리기

## 실시간 공유 방법 고르기

`js/config.js` 의 `mode` 로 정합니다. 기본값 `auto` 는 아래 순서로 자동 선택합니다.

1. Firebase 설정이 있으면 → **Firebase**
2. 같은 주소에 실시간 서버가 있으면 → 그 서버 (**Cloudflare Worker** 또는 `server.js`)
3. 둘 다 없으면 (GitHub Pages 등) → **공개 MQTT 중계 서버** (설정 없이 바로 동작)

공개 MQTT 중계 서버(`broker.emqx.io`, `broker.hivemq.com`)는 누구나 쓰는 무료 공용 서버입니다.
- 계정이나 서버 없이 폴더만 올리면 바로 동작합니다.
- 공용이라 가끔 느리거나 보관 데이터가 지워질 수 있습니다. 지워지면 마지막으로 열었던 사람의 브라우저 사본으로 자동 복구됩니다. 그래도 중요한 작전은 **백업 저장**을 해 두세요.
- 작전판 주소(`room`)를 아는 사람은 내용을 볼 수 있습니다. 공략 배치 정도의 정보만 올리세요.
- 오래 쓰다 불안정하면 아래 Firebase 로 바꾸세요. 설정값만 넣으면 됩니다.

### Cloudflare (추천 · 우리 전용 실시간 서버)

이 저장소에는 Cloudflare Workers 용 실시간 서버(`worker/index.js`, `wrangler.toml`)가 들어 있습니다.
작전판마다 Durable Object 하나가 접속자와 내용을 맡아서, 공개 중계 서버 없이 우리만 쓰는 서버로 동작합니다.

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Workers** 쪽의 **Import a repository**
   (Pages 가 아니라 **Workers** 로 만들어야 실시간 서버까지 올라갑니다)
2. GitHub 연결 → `gray5353/raid-planner` 선택 → 배포 명령은 기본값 `npx wrangler deploy` 그대로 → **Deploy**
3. 끝나면 `https://raid-planner.<계정>.workers.dev` 주소가 생깁니다. 이후 `main` 에 올릴 때마다 자동 배포됩니다.
4. 가지고 있는 도메인을 쓰려면 Worker → **Settings → Domains & Routes** 에서 추가

로컬에서 미리 실행: `npm install` 후 `npm run dev` → <http://localhost:8787>

### A. Firebase (무료 · 내 데이터베이스)

1. <https://console.firebase.google.com> → **프로젝트 추가**
2. 왼쪽 메뉴 **빌드 → Realtime Database → 데이터베이스 만들기** (위치는 가까운 `asia-southeast1` 추천)
3. **규칙** 탭에 아래를 붙여넣고 게시
   ```json
   {
     "rules": {
       "rooms": {
         "$room": { ".read": true, ".write": true }
       }
     }
   }
   ```
4. **프로젝트 설정(톱니바퀴) → 내 앱 → 웹(`</>`) 앱 추가** → 나오는 `firebaseConfig` 값을
   `js/config.js` 의 `firebase: { ... }` 에 붙여넣기 (`databaseURL` 이 꼭 있어야 합니다)
5. 폴더 전체(`index.html`, `css/`, `js/`)를 사이트에 업로드

### B. Node 서버 (서버를 직접 운영할 때)

```bash
npm install
npm start          # http://localhost:8080
```

`PORT`, `DATA_DIR` 환경변수로 포트와 저장 위치를 바꿀 수 있습니다. 작전판 내용은 `data/` 에 JSON 으로 저장됩니다.
리버스 프록시(nginx 등) 뒤에 둘 때는 `/ws` 경로의 웹소켓 업그레이드를 열어 주세요.

## 사이트에 넣기

앱을 올린 주소를 페이지에 iframe 으로 넣으면 됩니다.

```html
<iframe src="https://내사이트/raid-planner/?room=우리공대"
        style="width:100%;height:900px;border:0"
        allow="clipboard-write; fullscreen"></iframe>
```

`room` 값이 같으면 같은 작전판입니다. 비워 두면 새 작전판이 만들어지고 주소에 붙습니다.
공대원에게는 `&mode=view` 가 붙은 **보기 링크**를 주세요.

## 보스 지형 이미지 얻기

- **WoW Model Viewer**: Buildings 탭에서 레이드 건물을 불러와 위에서 내려다본 뒤 Screenshot
- **WoW Model Viewer**: Textures 탭에서 `worldmap` 검색 → 레이드 지도 그림 저장
- **wow.export** 3D 맵 뷰어, 게임 안 지도(M) 캡처
- 얻은 이미지는 지도 위로 끌어다 놓거나 Ctrl+V 로 붙여넣기 (긴 변 2000px 로 줄여서 저장)

> 하이잘 정상·Barrow Deeps 는 2026-12-09 개방 예정이라, 그 전에는 게임 파일에 지형이 없을 수 있습니다.
> 프리셋의 보스 이름은 개방 전 비공식 명칭이니 앱에서 고쳐 쓰세요.

## 주의

- 링크(`room`)를 아는 사람은 누구나 편집할 수 있습니다. 보기 링크는 편집 도구를 숨길 뿐, 권한을 막지는 않습니다.
  공개 게시판 등에 편집 링크를 올리지 마세요. 권한이 필요해지면 로그인 기능을 추가할 수 있습니다.
- 보스 이름·직업(오리지널 9직업)·레이드 프리셋은 `js/data.js` 에서 고칠 수 있습니다.

## 파일 구조

```
index.html      화면 구조
css/style.css   디자인
js/config.js    실시간 공유 설정 (Firebase / 서버 주소)
js/data.js      직업, 역할, 징표, 레이드 프리셋, 기본 지형
js/sync.js      실시간 동기화 (Firebase / 웹소켓 / 로컬)
js/app.js       앱 동작
server.js       Node 실시간 서버 (직접 서버를 운영할 때)
worker/index.js Cloudflare Workers 실시간 서버 (Durable Objects)
wrangler.toml   Cloudflare 배포 설정 · .assetsignore 는 공개하지 않을 파일 목록
```
