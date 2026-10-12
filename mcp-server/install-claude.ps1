$ErrorActionPreference = 'Stop'

Write-Host "🤖 클로드 데스크톱용 글로벌 뉴스 스킬(MCP) 설치를 시작합니다..." -ForegroundColor Cyan

# 1. 파일 다운로드
$claudeDir = Join-Path $env:APPDATA "Claude"
if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null
}

$mcpScriptPath = Join-Path $claudeDir "global-news-mcp.js"
$baseUrl = "https://raw.githubusercontent.com/bin7335/global-news-briefing/main/mcp-server"

Write-Host "📥 1/2. 스킬 코어 스크립트 다운로드 중..."
Invoke-WebRequest -Uri "$baseUrl/global-news-mcp.bundle.js" -OutFile $mcpScriptPath -UseBasicParsing

# 2. claude_desktop_config.json 수정
$configPath = Join-Path $claudeDir "claude_desktop_config.json"
Write-Host "⚙️ 2/2. 클로드 설정 파일(claude_desktop_config.json) 수정 중..."

if (Test-Path $configPath) {
    $configRaw = Get-Content $configPath -Raw
    # 빈 파일이거나 내용이 없을 때 방어
    if ([string]::IsNullOrWhiteSpace($configRaw)) {
        $configJson = @{}
    } else {
        $configJson = $configRaw | ConvertFrom-Json
    }
} else {
    $configJson = @{}
}

if (-not $configJson.mcpServers) {
    $configJson | Add-Member -MemberType NoteProperty -Name "mcpServers" -Value @{}
}

# Windows 경로의 역슬래시를 유지하며 JSON 직렬화하기 위해 PSCustomObject 사용
$serverConfig = [PSCustomObject]@{
    command = "node"
    args = @($mcpScriptPath)
}

$configJson.mcpServers | Add-Member -MemberType NoteProperty -Name "global-news" -Value $serverConfig -Force

$configJson | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8

Write-Host ""
Write-Host "🎉 설치가 모두 완료되었습니다!" -ForegroundColor Green
Write-Host "👉 중요: 클로드 데스크톱 앱을 완전히 종료(우측 하단 트레이 아이콘 우클릭 -> Quit) 후 다시 실행해주세요." -ForegroundColor Yellow
Write-Host "👉 재시작 후, 우측 하단에 🔨(망치) 모양 도구 아이콘이 생겼는지 확인하세요."
Write-Host "👉 이제 클로드에게 '오늘 글로벌 시황 알려줘'라고 질문하시면 됩니다." -ForegroundColor Yellow
