# 用 Edge 直接加载扩展（免安装、免 Tampermonkey、免编译）
# 会创建一个独立的浏览器配置目录，不影响你日常的 Edge 数据和登录

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$profileDir = Join-Path $here '.edge-profile'

$edge = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) { throw '找不到 msedge.exe，请手动在 edge://extensions 里加载本目录' }

if (-not (Test-Path (Join-Path $here 'content.js'))) {
    Write-Host '先生成 content.js …' -ForegroundColor Cyan
    node (Join-Path $here 'tools\build-extension.mjs')
}

$args = @(
    "--user-data-dir=$profileDir",
    "--load-extension=$here",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
    'https://web.ewt360.com/site-study/'
)

Write-Host '启动 Edge（独立配置文件）…' -ForegroundColor Green
Start-Process -FilePath $edge -ArgumentList $args
Write-Host '提示：若扩展未自动启用，打开 edge://extensions 打开「开发人员模式」后确认「升学E网通助手」已启用。'
