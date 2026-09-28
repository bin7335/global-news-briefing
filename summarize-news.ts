
const { execSync } = require('child_process');
function getTranscriptFallback(videoId) {
  console.log('   [우회] yt-dlp를 사용하여 자막 강제 추출 시도 중...');
  try {
    execSync(`yt-dlp --write-auto-subs --write-subs --sub-langs ko --skip-download -o "transcript_${videoId}.%(ext)s" "https://www.youtube.com/watch?v=${videoId}"`, { stdio: 'pipe' });
    const files = fs.readdirSync('.');
    const vttFile = files.find(f => f.startsWith('transcript_' + videoId) && f.endsWith('.vtt'));
    if (!vttFile) return null;
    
    const vttContent = fs.readFileSync(vttFile, 'utf-8');
    const lines = vttContent.split('\n')
        .filter(line => !line.includes('-->') && !line.startsWith('WEBVTT') && !line.startsWith('Kind:') && !line.startsWith('Language:') && line.trim() !== '')
        .map(line => line.replace(/<[^>]+>/g, '').trim())
        .filter(line => line.length > 0);
    
    const uniqueLines = [...new Set(lines)];
    const text = uniqueLines.join(' ');
    
    fs.unlinkSync(vttFile);
    return text;
  } catch (e) {
    console.log('   [우회 실패]: ' + e.message);
    return null;
  }
}
import * as fs from "fs";
import { YoutubeTranscript } from "youtube-transcript";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY 환경변수가 설정되지 않았습니다.");
  process.exit(1);
}

// 사용자 설정 영역
// 사용자님이 주신 당잠사 플레이리스트 ID
const PLAYLIST_ID = "PLh6kUo7pqm_69KUuM0hOj-ClLo6GWdgUH";

// [추가] 야후 파이낸스, 구글 파이낸스, CNN에서 시장 지표 가져오기
async function fetchMarketSnapshot() {
  const tickers = {
    fx: 'KRW=X',
    nasdaq: '^IXIC',
    sp500: '^GSPC',
    kospi: '^KS11',
    us10y: '^TNX'
  };

  const results = {};
  for (const [key, symbol] of Object.entries(tickers)) {
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`);
      const json = await res.json();
      const meta = json.chart.result[0].meta;
      const price = meta.regularMarketPrice;
      const prev = meta.chartPreviousClose || meta.previousClose;
      let change = 0;
      if (prev && prev > 0) {
        change = ((price - prev) / prev) * 100;
      }
      results[key] = { price, change };
    } catch (err) {
      console.log(`[시장 지표] ${key} 가져오기 실패:`, err.message);
      results[key] = { price: 0, change: 0 };
    }
  }

  // 구글 파이낸스에서 한국/일본 10년물 긁어오기 (로컬 사내망에서는 차단될 수 있으나 GitHub Actions 서버는 문제없음)
  const bonds = {
    kr10y: 'https://www.google.com/finance/quote/KR10YT=RR:BOK',
    jp10y: 'https://www.google.com/finance/quote/JP10YT=RR:BOJ'
  };
  for (const [key, url] of Object.entries(bonds)) {
    try {
      const res = await fetch(url);
      const html = await res.text();
      // data-last-price="3.123" 형태 파싱
      const priceMatch = html.match(/data-last-price="([^"]+)"/);
      let price = priceMatch ? parseFloat(priceMatch[1]) : 0;
      results[key] = { price: price, change: 0 }; // 변동률은 파싱이 까다로우므로 0으로 처리 (화면엔 --%로 표시됨)
    } catch (err) {
      console.log(`[시장 지표] ${key} 가져오기 실패:`, err.message);
      results[key] = { price: 0, change: 0 };
    }
  }

  // 진짜 CNN 공포탐욕지수 실시간 호출 (봇 차단 우회를 위한 User-Agent 설정)
  try {
    const cnnRes = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36' }
    });
    const cnnJson = await cnnRes.json();
    const score = cnnJson.fear_and_greed.score;
    const prevScore = cnnJson.fear_and_greed.previous_close;
    const change = prevScore ? ((score - prevScore) / prevScore) * 100 : 0;
    results['fgi'] = { price: score.toFixed(0), change: change };
  } catch(e) {
    console.log(`[시장 지표] CNN 공포지수 실패:`, e.message);
    results['fgi'] = { price: 50, change: 0 };
  }

  // 업데이트 시간 기록
  const updateTime = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  results['updatedAt'] = updateTime;

  fs.writeFileSync('market-data.json', JSON.stringify(results, null, 2), 'utf-8');
  console.log('✅ 시장 지표(Market Snapshot) 저장 완료!');
}

async function runNewsSummary() {
  console.log("=== 🌍 Global News Briefing 시작 (Gemini API) ===\n");
  
  try {
    await fetchMarketSnapshot(); // 지표 수집 먼저 실행
    
    // 1. 유튜브 플레이리스트에서 최신 영상 가져오기
    console.log(`1. 당잠사 플레이리스트에서 최신 영상을 찾습니다...`);
    
    // RSS 대신 직접 HTML 스크래핑 방식으로 최신 영상 추출
    const htmlResponse = await fetch(`https://www.youtube.com/playlist?list=${PLAYLIST_ID}`);
    const html = await htmlResponse.text();
    
    const videoMatches = html.match(/watch\?v=([a-zA-Z0-9_-]{11})/g);
    
    if (!videoMatches || videoMatches.length === 0) {
      console.log(`❌ 영상을 찾을 수 없습니다.`);
      return;
    }
    
    
    const uniqueVideos = [...new Set(videoMatches)];
    let fullTranscript = '';
    let processedVideoId = '';
    const stateFile = 'last_processed_videoId.txt';

    for (const matchStr of uniqueVideos) {
      const vId = matchStr.replace('watch?v=', '');
      const vUrl = 'https://www.youtube.com/watch?v=' + vId;
      
      if (fs.existsSync(stateFile)) {
        const lastProcessed = fs.readFileSync(stateFile, 'utf-8').trim();
        if (lastProcessed === vId) {
          console.log('✅ [' + vId + '] 영상은 이미 요약이 완료되었습니다.');
          return;
        }
      }
      
      console.log('\n👉 확인 중: [' + vId + '] ' + vUrl);
      try {
        const transcriptLines = await YoutubeTranscript.fetchTranscript(vId);
        fullTranscript = transcriptLines.map(t => t.text).join(' ');
        processedVideoId = vId;
        console.log('   ✅ 자막 추출 성공 (YoutubeTranscript)!');
        break;
      } catch (ytErr) {
        console.log('   🚨 YoutubeTranscript 실패, yt-dlp 우회 시도 중...');
        try {
          const { execSync } = require('child_process');
          const cookieArg = fs.existsSync('cookies.txt') ? '--cookies cookies.txt ' : '';
          execSync('yt-dlp ' + cookieArg + '--write-auto-subs --write-subs --sub-langs ko --skip-download -o "transcript_' + vId + '.%(ext)s" "' + vUrl + '"', { stdio: 'pipe' });
          const files = fs.readdirSync('.');
          const vttFile = files.find(f => f.startsWith('transcript_' + vId) && f.endsWith('.vtt'));
          if (vttFile) {
            const vttContent = fs.readFileSync(vttFile, 'utf-8');
            const lines = vttContent.split('\n')
                .filter(line => !line.includes('-->') && !line.startsWith('WEBVTT') && !line.startsWith('Kind:') && !line.startsWith('Language:') && line.trim() !== '')
                .map(line => line.replace(/<[^>]+>/g, '').trim())
                .filter(line => line.length > 0);
            fullTranscript = [...new Set(lines)].join(' ');
            fs.unlinkSync(vttFile);
            processedVideoId = vId;
            console.log('   ✅ 자막 추출 성공 (yt-dlp 우회)!');
            break;
          } else {
             throw new Error('VTT file not found');
          }
        } catch (fallbackErr) {
          console.log('   🚨 yt-dlp 우회도 실패했습니다. 사유: ' + fallbackErr.message); console.log('   🚨 yt-dlp 출력: ' + (fallbackErr.stdout ? fallbackErr.stdout.toString() : '')); console.log('   🚨 yt-dlp 에러출력: ' + (fallbackErr.stderr ? fallbackErr.stderr.toString() : ''));
          continue;
        }
      }
    }

    if (!fullTranscript || !processedVideoId) {
      console.log('❌ 처리할 수 있는 새 영상(자막 포함)을 찾지 못했습니다.');
      return;
    }

    // 4. Gemini API 호출
    console.log("\n4. Gemini Flash 최신 API를 호출하여 요약합니다...");
    
    const prompt = `
다음은 오늘자 경제 뉴스 영상의 전체 자막입니다. 
바쁜 직장인이 아침에 읽기 좋게, HTML과 마크다운을 섞어 아래 형식에 맞춰 요약해 주세요.

[출력 형식]
## ☕ Market Overview
(나스닥 등 주요 글로벌 증시의 흐름과 가장 핵심적인 거시경제 상황을 2~3문장으로 짧게 요약)

## 🗞️ Today's Briefing
(오늘의 주요 개별 뉴스 이슈들을 아래처럼 HTML <details>와 <summary> 태그를 사용해 아코디언 형태로 작성해 주세요. 최소 3개 이상 5개 이하)

<details>
  <summary><strong>1. [뉴스 제목을 여기에 작성 (예: 미 연준 금리 동결)]</strong></summary>
  <div style="padding-top: 10px; padding-bottom: 15px;">
    (이 공간에 해당 뉴스의 세부 내용, 배경, 그리고 시장에 미치는 영향을 3~4문장으로 상세히 설명)
  </div>
</details>

<details>
  <summary><strong>2. [두 번째 뉴스 제목]</strong></summary>
  <div style="padding-top: 10px; padding-bottom: 15px;">
    (세부 내용)
  </div>
</details>

[주의사항]
- 🚀, ✨, 📈, 🔥 같은 지나치게 화려한 'AI가 생성한 듯한(바이브코딩 느낌)' 이모지는 절대 사용하지 말 것.
- 이모지를 쓴다면 ☕, 🗞️, 🏛️, 📊, 📎 처럼 담백하고 차분한 것만 제한적으로 사용할 것.
- 반드시 <details> 태그 구조를 정확히 지킬 것

[자막 데이터]
${fullTranscript.substring(0, 30000)}
`;

    let response;
    let retries = 3;
    
    for (let i = 0; i < retries; i++) {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0.3
          }
        })
      });

      if (response.ok) {
        break; // 성공
      }
      
      const errorText = await response.text();
      console.log(`[시도 ${i + 1}/${retries} 실패] ${response.statusText} - ${errorText}`);
      
      if (i < retries - 1) {
        console.log("5초 후 다시 시도합니다...");
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        throw new Error(`API 호출 최종 실패: ${response.statusText}`);
      }
    }

    const data = await response.json();
    const summary = data.candidates[0].content.parts[0].text;
    
    // 5. 결과 출력 및 상태 저장
    console.log("\n=== ✨ 요약 결과 ===");
    console.log(summary);
    
    const today = new Date().toISOString().split("T")[0];
    const reportContent = `# ${today} Global News Briefing\n\n- 출처: [당잠사 최신 영상](${'https://www.youtube.com/watch?v=' + processedVideoId})\n\n---\n\n${summary}`;
    
    fs.writeFileSync("news-summary-result.md", reportContent);
    fs.writeFileSync(stateFile, processedVideoId); // 성공한 영상 ID 저장
    
    console.log("\n👉 'news-summary-result.md' 파일에 상세 브리핑이 저장되었습니다.");

  } catch (error) {
    console.error("오류 발생:", error);
    process.exit(1);
  }
}

runNewsSummary();



