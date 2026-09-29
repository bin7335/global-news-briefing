# Global News Briefing

한국경제TV 당잠사 플레이리스트의 첫 번째 공개 완료 영상을 요약합니다.
자막 수집이 실패하면 Gemini API의 공개 YouTube 영상 입력으로 같은 영상을 분석합니다.
이전 영상으로 넘어가서 새 브리핑을 만들지 않습니다. 새 영상이 없으면 기존 결과를 유지합니다.
브리핑 개수는 제한하지 않습니다. 시장·산업 파급력이 큰 이슈를 중요도순으로 선정하고 중복·단순 인사·홍보성 소식은 제외합니다.
선정 기준 버전이 변경되면 같은 영상도 한 번 다시 요약합니다.

## 실행

- Node.js 22 이상, `npm ci`, `npm test`
- `npm run check:source`: 영상 ID/제목만 확인. API 키나 결과 저장 불필요.
- `GEMINI_API_KEY`를 환경변수로 설정한 후 `npm run briefing`
- `npx tsx summarize-news.ts --market-only`: 시장 지표 수집
- 선택: `GEMINI_MODEL`로 모델 변경 (기본 `gemini-flash-latest`).

## 자동 실행

GitHub Actions가 한국 시간 월-금 07:30, 07:45, 08:00에 실행됩니다.
누락·지연 및 늦은 업로드를 확인하기 위해 08:17, 09:17, 10:17, 11:17, 12:17에도 재확인합니다.
예약 실행 시각은 GitHub 상황에 따라 지연될 수 있습니다.
필수 repository Secret은 `GEMINI_API_KEY`입니다.
선택 Secret `YOUTUBE_COOKIES`는 Netscape 형식이며, 없어도 영상 직접 분석을 시도합니다.
로컬 쿠키를 사용할 때에는 `YOUTUBE_COOKIE_FILE`에 파일 경로를 지정합니다.
쿠키는 저장소에 커밋하지 않습니다.

자막 경로는 `youtube-transcript` → yt-dlp (`--js-runtimes node`) 순서입니다.
Gemini 영상 입력은 공개 영상만 지원하며 API 할당량과 영상 접근 제한의 영향을 받습니다.
영상 분석 실패/빈 응답/미완성 출력은 기존 브리핑과 처리 ID를 변경하지 않고 오류로 종료합니다.
Actions는 60초 간격으로 최대 3회 시도합니다. 마지막에도 실패하면 실행이 실패로 표시됩니다.
시장 지표는 독립적으로 저장되며 수집 실패 시 이전 값과 갱신 지연 표시를 유지합니다.

미국·한국·일본 10년물 수익률은 CNBC 공개 시세를 사용합니다. 변동은 채권 가격 변동률이 아닌 수익률 차이(bp)로 계산합니다.
CNN 공포탐욕지수는 CNN 데이터 응답의 점수·등급·기준 시각을 사용합니다. 5일보다 오래된 응답은 새 값으로 저장하지 않습니다.
화면에는 제공처 기준 시각을 표시하며, CNBC가 날짜 없이 시간만 제공하면 이를 그대로 표시합니다. 수집 시각을 시세 기준 시각으로 바꾸지 않습니다.

공식 영상 입력 문서: https://ai.google.dev/gemini-api/docs/generate-content/video-understanding
