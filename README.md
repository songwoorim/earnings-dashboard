# 실적 번역기 📊

어려운 재무제표를 **쉬운 말**로 풀어주는 대시보드 웹앱 (미국 + 한국 주식).
용어는 눌러서 바로 설명을 보고, 실적 발표별 분석도 함께 확인할 수 있어요.

**화면은 `index.html` 파일 하나**예요. 설치할 것도, 빌드할 것도 없어요.

## 내 컴퓨터에서 보기

`index.html` 을 **더블클릭**하면 브라우저에서 열려요. (차트 라이브러리를 인터넷에서 받아오므로 인터넷 연결은 필요해요.)

- 더블클릭으로 열면 **샘플 데이터**(가상의 회사)가 보여요. 브라우저가 로컬 파일끼리의 읽기를 막아서 실제 데이터 파일(`data/companies.json`)은 못 읽기 때문이에요.
- 로컬에서 실제 데이터까지 보려면 폴더에서 `python3 -m http.server` 를 실행하고 `http://localhost:8000` 을 열어요. (선택 사항)
- 화면을 고치고 싶으면 `index.html` 을 메모장/VS Code 로 열어 수정하고 새로고침하면 바로 반영돼요.

## 파일 구성

```
index.html                 화면·스타일·코드가 전부 들어 있는 파일 (이것만 있으면 화면은 동작)
data/companies.json        실제 재무 데이터 (GitHub Actions 가 매일 만들어요. 처음엔 없어도 돼요)
scripts/                   데이터를 받아오는 스크립트 (GitHub 서버에서만 실행돼요)
.github/workflows/         자동 갱신(update-data.yml) · 배포(deploy.yml)
```

`index.html` 안에서 자주 만지게 될 곳:
- 맨 위 `설정` : `ANALYSIS_ENDPOINT` (AI 분석 서버 주소, 3단계에서 연결)
- `SAMPLE` : 샘플 회사 데이터
- 화면 구성은 `renderInfo`(주요정보) · `renderFin`(재무) · `renderEarn`(실적) · `renderDiv`(배당) · `renderPeer`(동종업계) · `renderAnalyst`(애널리스트) 함수로 나뉘어 있어요
- `GLOSSARY` : 용어 사전 (용어를 추가하면 화면 어디서든 `term("id")` 로 쓸 수 있어요)
- 맨 위 `<style>` : 색상 · 글자 크기

## 데이터가 들어오는 방식

```
GitHub Actions (매일 06:00 KST)
  └─ scripts/build-data.mjs 가 SEC EDGAR · DART 에서 재무 데이터를 받아
     data/companies.json 으로 저장 → 커밋
        └─ 배포 워크플로가 다시 돌아 GitHub Pages 갱신
              └─ index.html 이 data/companies.json 을 읽어서 표시
```

- `data/companies.json` 이 없으면 **샘플 데이터**를 보여줘요 (상단에 "샘플 데이터" 표시).
- API 키는 GitHub Secrets 에만 있고 화면(브라우저)에는 노출되지 않아요.
- 한 종목이 실패해도 나머지는 계속 진행하고, 실패한 종목은 이전 값을 그대로 둬요.
- 이 과정은 모두 GitHub 서버에서 돌아서 **내 컴퓨터에 Node.js 가 없어도 돼요.**

### 처음 한 번 설정하기

1. GitHub 에 새 **Public** 저장소를 만들고 이 폴더의 파일을 올려요. (숨김 폴더 `.github` 도 함께!)
2. **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 선택
3. **DART API 키 발급**: https://opendart.fss.or.kr 에서 회원가입 후 인증키 신청 (무료)
4. 저장소 **Settings → Secrets and variables → Actions** 에서
   - **Secrets** 탭: `DART_API_KEY` = 발급받은 키
   - **Variables** 탭: `SEC_USER_AGENT` = `earnings-dashboard 내이메일@example.com`
     (SEC 는 누가 접속하는지 알 수 있도록 연락처가 들어간 User-Agent 를 요구해요)
5. **Actions 탭 → Update financial data → Run workflow** 로 처음 한 번 직접 실행

### 종목 추가·변경

`scripts/watchlist.json` 을 고치면 돼요.
- 미국: `cik` (SEC 의 10자리 기업 번호)
- 한국: `corpCode` (DART 의 8자리 고유번호)
- 한국 종목은 **12월 결산 법인**만 지원해요.

### 알아둘 점

- 분기 이름은 분기 기간의 가운데 날짜 기준이에요. 그래서 엔비디아처럼 1월 말에 끝나는 분기는 "2025Q4"로 표시돼요.
- 4분기 값은 "연간 − 1~3분기", 현금흐름은 누적값에서 앞 기간을 빼서 계산해요.
- 차입금(빚)은 회사마다 공시 항목이 달라서 **대략적인 합계**예요.
- 분기 데이터가 5개 미만이거나 필요한 항목이 빠진 종목은 표시하지 않아요.
- (선택) 변환 로직 테스트: Node.js 가 있다면 `node scripts/test.mjs`

## 로드맵

- [x] 1단계: 샘플 데이터 화면 프로토타입 (토스 스타일 화이트)
- [x] 2단계: 실제 데이터 연결 (SEC EDGAR / DART) ← 코드 완료, 첫 실행 확인 필요
- [x] 화면 개편: 토스증권 종목정보 구성 (주요정보 · 재무 · 실적 · 배당 · 동종업계 · 애널리스트)
- [ ] 시장 데이터 연결: 주가 · 시가총액 · PER/PSR/PBR · 배당 · 애널리스트 의견·목표주가 (화면에는 '연결 예정'으로 표시 중)
- [ ] 3단계: AI 분석 자동 생성 (서버리스 함수 + `ANALYSIS_ENDPOINT`)
- [ ] 4단계: 내 포트폴리오 · 실적 발표 일정
