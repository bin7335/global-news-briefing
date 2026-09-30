$ErrorActionPreference = 'Stop'

Write-Host "🤖 글로벌 뉴스 브리핑 AI 스킬(플러그인) 설치를 시작합니다..." -ForegroundColor Cyan

# 설치 경로 설정 (글로벌 플러그인 디렉토리)
$pluginDir = Join-Path $HOME ".gemini\config\plugins\global-news-briefing"
$skillsDir = Join-Path $pluginDir "skills\macro-briefing"

# 디렉토리가 없으면 생성
if (-not (Test-Path $skillsDir)) {
    New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null
}

# 깃헙 Raw URL 베이스
$baseUrl = "https://raw.githubusercontent.com/bin7335/global-news-briefing/main/antigravity-plugin"

Write-Host "📥 파일 다운로드 중..."
# 파일 다운로드
Invoke-WebRequest -Uri "$baseUrl/plugin.json" -OutFile (Join-Path $pluginDir "plugin.json") -UseBasicParsing
Invoke-WebRequest -Uri "$baseUrl/skills/macro-briefing/SKILL.md" -OutFile (Join-Path $skillsDir "SKILL.md") -UseBasicParsing

Write-Host "✅ 설치가 완료되었습니다! 이제 AI에게 '오늘 글로벌 시황 알려줘'라고 질문해보세요." -ForegroundColor Green
