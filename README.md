# TD 시퀀셜 스크리너

업비트, 빗썸, 바이낸스에 상장된 코인에 TD Research v6 지표를 20개 타임프레임에서 세는 스크리너입니다. 9와 13이 나온 종목을 한 표로 보여 주고, 종목마다 차트와 라벨 목록을 보여 줍니다. GitHub Actions가 매일 TradingView 가격을 새로 받아 다시 세고, 결과를 GitHub Pages에 배포합니다.

- 지표는 `tlzkrh1029/pinescript`의 `td-research-v6/kidze_td_research_v6.pine`이고, 기본 설정 그대로 셉니다.
- 종목 목록, 순위, 시가총액은 WMA 스크리너(`tlzkrh1029/wma0.3-screenshot`)에서 매일 복사합니다. 가격은 TradingView의 `CRYPTO:<코인>USD`입니다.
- 타임프레임은 1D, 2D, 3D, 4D, 5D, 6D, 1W, 8D, 9D, 10D, 2W, 3W, 1M, 2M, 3M, 4M, 6M, 8M, 10M, 12M입니다.
- 신호는 셋업 9(9, 9*, 반복 9), 13 완성(13, 13r, 13x2처럼 차트의 글자 그대로), 다음 봉으로 미뤄진 13(+13)입니다.
- 진행 중인 봉이 어떤 가격으로 마감하면 다음 9나 13이 나오는지도 계산합니다(다음 봉 조건).

## 차트와 같다는 보장

사이트가 보여 주는 모든 9와 13은 소유자의 TradingView 차트(`CRYPTO:<코인>USD`, TD Research v6 기본 설정)와 하나도 빠짐없이 같아야 합니다. 이 규칙과 운영 원칙은 `CLAUDE.md`에 있습니다. 다음 방법으로 확인합니다.

- **Pine 스크립트가 명세입니다.** `dashboard/td-engine.js`는 Pine 스크립트를 문장 하나하나 옮긴 엔진입니다. 규칙을 바꿀 때는 소유자가 Pine 스크립트를 먼저 고치고, 두 구현이 그것을 따릅니다.
- **서로 따로 쓴 두 구현을 비교합니다.** `verify/ref/`의 Python 구현은 JavaScript 엔진을 보지 않고 Pine 원본만 보고 썼습니다. `verify/diff.mjs`는 두 구현이 티커와 타임프레임마다 만든 결과 파일을 바이트 단위로 비교합니다. 파일에는 확정 봉, 지표가 만든 라벨 하나하나, 마지막 봉 뒤의 상태가 들어갑니다. 기본 설정으로 모든 티커의 20개 타임프레임을 비교하고, 설정을 바꾼 네 가지 변형(`verify/variants/`)으로 63개 티커를 더 비교합니다. 불일치는 0건이어야 합니다. 매일 자동 실행도 그날 받은 데이터로 이 비교를 돌립니다. `verify/fuzz.mjs`는 무작위로 만든 가격과 설정으로 같은 비교를 합니다.
- **차트에서 본 라벨을 테스트로 고정했습니다.** CRYPTO:BTCUSD 2W의 2024-12-16 봉에는 분홍색 매도 `13x2`가 있고, 그 시작 봉은 2021-11-08과 2024-01-29입니다. Node 테스트와 Python 테스트가 모두 이 라벨을 확인합니다.
- **TradingView 자체 봉과 비교했습니다.** 2D, 3W 같은 사용자 지정 타임프레임은 로그인 없이 받을 수 없어서, 일봉이나 1W, 1M 봉을 묶어 만듭니다. `verify/native/check-native-bars.mjs`는 묶은 봉을 TradingView 자체 1W, 1M, 3M, 6M, 12M 봉과 비교합니다. 2026-11-01 검사에서 묶는 규칙이 178,226개 봉 모두와 맞았습니다.
- **다음 봉 조건을 과거 전체로 검사합니다.** `verify/triggers-check.mjs`는 모든 티커의 모든 확정 봉에서, 바로 전 봉까지의 상태로 계산한 조건을 실제 봉에 대 봅니다. 조건이 맞는 봉과 엔진이 9나 13을 만든 봉이 정확히 같아야 하고, 13의 글자(13r, 13x2)와 시작 봉까지 같아야 합니다.
- **사이트도 같은 엔진을 씁니다.** 빌드는 `dashboard/bars.js`와 `dashboard/td-engine.js`를 페이지에 그대로 넣습니다. 종목 상세 화면은 그 종목을 브라우저에서 같은 코드로 다시 셉니다.
- **사이트에서 직접 맞춰 볼 수 있습니다.** 검증 화면은 두 구현의 비교 결과와 데이터 신선도를 보여 줍니다. 시가총액 상위 종목의 최근 9와 13도 TradingView 차트 링크와 함께 보여 줍니다.

## 데이터

- **매번 전체 이력을 받습니다.** `scripts/fetch-tv.mjs`는 로그인 없이 TradingView 차트 웹소켓으로 모든 USD 티커의 일봉 전체 이력을 처음부터 받습니다. TD 카운트는 앞선 모든 봉에 달려 있고, TradingView는 오래된 봉을 고치기도 하기 때문입니다. 새로 받은 이력을 예전 파일과 합치지 않습니다.
- **마감된 봉만 셉니다.** 수집할 때 진행 중인 일봉은 버립니다. 엔진은 확정된 봉만 셉니다. 타임프레임 봉은 그 기간이 끝나야 확정됩니다.
- **1W와 1M은 TradingView 자체 봉으로 만듭니다.** 같은 수집에서 1W 봉과 1M 봉도 받아 `w`와 `m`으로 저장합니다. 1D부터 10D까지는 일봉으로, 1W, 2W, 3W는 1W 봉으로, 1M부터 12M까지는 1M 봉으로 만듭니다. TradingView의 1W, 1M 차트는 자체 봉을 그리고, 이 봉에는 일봉에서 나중에 고쳐진 가격이 남아 있을 수 있기 때문입니다.
- **빈 날은 채우지 않습니다.** TradingView에 봉이 없는 날은 `null`로 두고 봉으로 치지 않습니다. 이력의 앞부분도 자르지 않습니다.
- **두 가지 이력이 오는 티커가 있습니다.** 몇몇 티커는 요청할 때마다 TradingView가 두 이력 중 하나를 보냅니다. 2026-11-01에는 RSR, RVN, GHX, ARPA, BNB, USUAL, ZEC에서 보였습니다. AVU도 한쪽 이력에는 2024-08-28부터 270일이 빠져 있고, 한 번은 일봉과 1W 봉이 서로 다른 이력으로 왔습니다. 이력에 따라 9와 13이 실제로 달라지는 티커는 RSR과 AVU입니다. 차트가 어느 이력을 받는지는 알 수 없어서, 이런 차이는 고치지 않고 `data/daily/_status.json`에 기록합니다.
- **파일 형식.** `data/daily/<FILE_ID>.json`은 `{id, d0, o, h, l, c, m, w}`입니다. 배열의 i번째 값은 유닉스 날짜 `d0 + i`의 봉이고, 봉이 없는 날은 `null`입니다. `data/daily/_status.json`에는 수집 시각, 마지막으로 마감된 날, 실패한 티커, 과거 봉이 바뀐 티커가 들어갑니다.

## 화면

- **스크리너.** 종목마다 20개 타임프레임 칸에 고른 기간 안의 가장 강한 신호를 씁니다. 방향, 계열, 9 포함 여부, 기간(마지막 봉, 최근 4봉, 최근 13봉), 거래소, 검색, 정렬(점수, 시가총액, 최근 13)을 고를 수 있습니다. 칸에 마우스를 올리거나 방향키로 옮기면 자세한 내용이 나오고, 줄을 누르면 종목 상세가 열립니다. 점수 계산법은 화면의 "칸과 점수를 읽는 방법"에 있습니다.
- **TD 폭 보드.** 타임프레임마다 가장 최근 봉에서 9나 13을 완성한 종목 수를 보여 줍니다. 숫자를 누르면 그 종목들이 나옵니다. 아래 막대 차트는 봉마다 9와 13을 완성한 종목 수를 위(매도)와 아래(매수)로 쌓습니다.
- **종목 상세.** 캔들 차트에 지표가 그리는 위치와 크기로 라벨을 그립니다. 지표는 차트에 라벨을 최근 400개까지만 남기므로, TradingView 차트에서 지워지는 오래된 라벨은 흐리게 그립니다. 20개 타임프레임의 9와 13을 한 날짜 축에 모은 바코드, 타임프레임별 상태와 다음 봉 조건, 전체 라벨 목록도 있습니다.
- **검증.** 데이터 신선도, 두 구현의 비교 결과, 차트와 맞춰 볼 신호, 알아 둘 점을 보여 줍니다. 마지막으로 마감된 일봉이 끝난 지 36시간이 넘으면 모든 화면에 빨간 경고가 나옵니다.

## Bird eye 시안

`dashboard/mockups/`에는 Bird eye 화면의 시안이 있습니다. 세 가지 화면을 두 가지 방식씩 만들었고, 스크리너와 같은 데이터를 같은 엔진으로 셉니다. 소유자가 화면마다 방식을 고르면, 고른 방식을 사이트에 넣습니다.

- **시장 조감도.** 데이터가 있는 모든 종목의 20개 타임프레임을 한 화면에 보여 줍니다. A는 픽셀 매트릭스이고, B는 TF 신호 보드입니다.
- **여러 TF 한 장.** 한 종목의 20개 타임프레임을 한 장에 보여 줍니다. A는 격자 시트이고, B는 시간 정렬 레인입니다.
- **TF 사다리.** 한 종목의 타임프레임마다 9와 13까지의 진행 상황과 조건가를 보여 줍니다. A는 진행 게이지이고, B는 가격 사다리입니다.

`birdeye.html`은 화면 틀과 공통 함수(`BE`)이고, `be-<화면>-<a|b>.js` 파일 하나가 시안 하나입니다. `dashboard/td-view.js`는 진행 중인 봉이 어느 가격에 닿으면 9나 13이 나오는지를 계산합니다. `test/view.test.mjs`는 그 가격으로 만든 봉을 엔진에 넣고 다시 세어서, 계산한 가격이 맞는지 확인합니다.

시안 페이지를 `dist/birdeye`에 만듭니다. 여는 방법은 아래의 사이트와 같습니다.

```bash
node scripts/build-site.mjs dist/birdeye --template dashboard/mockups/birdeye.html --chunk 8
```

## 로컬에서 빌드하고 보기

Node.js 22가 필요합니다. 검증에는 Python 3도 필요하고, 표준 라이브러리만 씁니다.

의존성을 설치합니다.

```bash
npm ci
```

TradingView에서 데이터를 새로 받습니다. 저장소에 이미 데이터가 있으므로 건너뛰어도 됩니다.

```bash
node scripts/fetch-tv.mjs
```

사이트를 `dist/site`에 만듭니다.

```bash
node scripts/build-site.mjs dist/site
```

웹 서버로 엽니다. 페이지가 `b.json`과 `d/*.json`을 불러오므로 `index.html` 파일을 바로 열면 동작하지 않습니다.

```bash
python3 -m http.server --directory dist/site 8000
```

그다음 브라우저에서 `http://localhost:8000/`을 엽니다.

Node 테스트를 돌립니다.

```bash
node --test test/
```

Python 참조 구현의 테스트를 돌립니다.

```bash
python3 -m unittest discover -s verify/ref -p "test_*.py"
```

두 구현을 비교합니다. `verify/out/summary.json`을 새로 쓰고, 이 결과가 검증 화면에 나옵니다.

```bash
node verify/diff.mjs
```

다음 봉 조건을 과거 전체로 검사합니다.

```bash
node verify/triggers-check.mjs
```

한 티커의 라벨 목록을 파일로 봅니다.

```bash
node scripts/td-dump.mjs --out /tmp/td-dump --tickers CRYPTO:BTCUSD --tfs 2W
```

`dashboard/bars.js`나 `dashboard/td-engine.js`를 고쳤다면, 비교 결과의 불일치가 0건이고 모든 테스트가 통과해야 합니다.

## 매일 자동 실행

`.github/workflows/fetch-daily.yml`이 매일 00:23 UTC(한국 시간 09:23)에 실행됩니다. 일봉은 00:00 UTC에 마감합니다. Actions 탭에서 손으로 실행할 수도 있습니다.

1. `scripts/sync-universe.mjs`가 WMA 스크리너의 기본 브랜치에서 종목 목록을 복사합니다. 복사에 실패하면 커밋된 목록을 그대로 씁니다.
2. `scripts/fetch-tv.mjs`가 모든 티커의 전체 이력을 받습니다. 받지 못한 티커는 예전 파일을 그대로 둡니다. BTC를 받지 못하거나 실패한 티커가 5%를 넘으면 실행을 실패로 표시하지만, 다음 단계는 계속 진행합니다.
3. 바뀐 데이터를 커밋해서 푸시합니다.
4. `verify/diff.mjs`가 그날 데이터로 두 구현을 비교합니다. 이 결과가 사이트의 검증 화면에 나옵니다.
5. `scripts/build-site.mjs`가 사이트를 만들어 Pages 배포용으로 올립니다.
6. `scripts/check-fresh.mjs`가 데이터가 멈췄는지 봅니다. BTC가, 또는 USD 티커의 10%보다 많은 티커가 실행 전 2일(UTC) 동안 마감된 봉이 하나도 없으면 실행을 실패로 표시합니다.
7. 4단계의 비교에서 불일치가 나왔거나 비교가 끝나지 않았으면 실행을 실패로 표시합니다.

위 단계는 모두 fetch 작업 안에서 돕니다. fetch 작업이 끝나면 deploy 작업이 사이트를 GitHub Pages에 배포합니다. 6단계나 7단계가 실패해도 그날 사이트는 배포됩니다. 실패한 실행은 GitHub가 소유자에게 알립니다.

저장소에서 설정할 점이 있습니다.

- **GitHub Pages의 소스를 GitHub Actions로 둡니다.** Settings → Pages → Build and deployment에서 Source를 "GitHub Actions"로 고릅니다. 그래야 deploy 작업이 사이트를 배포할 수 있습니다.
- **예약 실행은 기본 브랜치에서만 돕니다.** GitHub는 기본 브랜치에 있는 워크플로 파일의 schedule만 실행합니다. 이 워크플로가 다른 브랜치에만 있으면 매일 실행되지 않으므로, 기본 브랜치에 합쳐야 합니다.
- **60일 규칙.** 공개 저장소에 60일 동안 활동이 없으면 GitHub가 예약 실행을 끕니다. 매일의 데이터 커밋이 이 저장소의 유일한 활동입니다. 더미 커밋, keepalive 커밋, 자동 "enable workflow" 호출은 쓰지 않습니다. 예약 실행이 꺼지면 Actions 탭에서 손으로 다시 켭니다.
- **로그인하지 않습니다.** TradingView 로그인 쿠키나 비밀 값을 쓰지 않습니다.

## 저장소 구성

- `dashboard/bars.js`: 일봉, 1W 봉, 1M 봉에서 20개 타임프레임의 봉을 만듭니다.
- `dashboard/td-engine.js`: TD Research v6 엔진과 다음 봉 조건을 계산합니다.
- `dashboard/screener.html`: 페이지 템플릿입니다. 빌드가 여기에 데이터와 위의 두 모듈을 넣습니다.
- `dashboard/td-view.js`: 다음 봉 조건이 충족되는 가격과, 화면에 쓰는 타임프레임별 상태를 계산합니다.
- `dashboard/mockups/`: Bird eye 시안입니다. 화면 틀(`birdeye.html`)과 시안 여섯 개(`be-*.js`)가 있습니다.
- `scripts/`: 수집(`fetch-tv.mjs`), 종목 목록 복사(`sync-universe.mjs`), 빌드(`build-site.mjs`), 신선도 검사(`check-fresh.mjs`), 라벨 덤프(`td-dump.mjs`)가 있습니다.
- `verify/`: Python 참조 구현(`ref/`), 두 구현 비교(`diff.mjs`, `fuzz.mjs`), 자체 봉 비교(`native/`), 다음 봉 조건 검사(`triggers-check.mjs`), 결과 파일(`out/`)이 있습니다.
- `test/`: Node 테스트입니다.
- `data/`: 종목 목록(`universe.json`, `tickers.json`)과 일봉 데이터(`daily/`)입니다.

## 출처

종목 목록, 순위, 시가총액은 CoinGecko에서 WMA 스크리너를 거쳐 옵니다. 사이트에는 "Data provided by CoinGecko"(https://www.coingecko.com) 표시를 둡니다. 가격은 TradingView에서 받습니다.
