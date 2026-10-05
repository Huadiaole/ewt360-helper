# 升学E网通助手 · 桌面版 一键打包脚本
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File .\build-exe.ps1
#
# 这套流程踩过的坑（脚本里都处理了）：
#   1) 本机 NODE_OPTIONS 带 --use-system-ca，Electron 不认会直接退出      -> 启动器里清掉
#   2) 受限环境里 Chromium 沙箱初始化被拒 + 配置目录不能落在受限范围外    -> 由启动器在命令行上带
#      --no-sandbox 与 --user-data-dir（从 main.js 里改已经太晚，Chromium 早就决定了）
#   3) electron-builder 解压 winCodeSign 要建 macOS 符号链接会失败        -> signAndEditExecutable=false + 自带 rcedit
#   4) 受限环境里 makensis 报 error creating mmap，打不出单文件           -> 自动降级为 dir 绿色目录版
#   5) 旧目录被残留进程锁住会导致打包失败                                  -> 先杀干净再打

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $here

$outDir   = Join-Path $here 'dist'
$appDir   = Join-Path $outDir 'win-unpacked'
$exeName  = '升学E网通助手.exe'
$ico      = Join-Path $here 'build\icon.ico'
$rcedit   = Join-Path $here '.electron-builder-cache\winCodeSign-2.6.0\rcedit-x64.exe'
$localTmp = Join-Path $env:LOCALAPPDATA 'Temp\ewt-nsis'

Write-Host '=== 1/7 同步用户脚本 ===' -ForegroundColor Cyan
$src = Join-Path (Split-Path -Parent $here) 'src\ewt360-helper.user.js'
if (Test-Path $src) {
    Copy-Item $src (Join-Path $here 'ewt360-helper.user.js') -Force
    Write-Host "已同步：$src"
} elseif (-not (Test-Path (Join-Path $here 'ewt360-helper.user.js'))) {
    throw '找不到用户脚本 ewt360-helper.user.js'
}

Write-Host '=== 2/7 环境变量 ===' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $localTmp | Out-Null
$env:TEMP = $localTmp
$env:TMP = $localTmp
$env:NODE_OPTIONS = ''
$env:npm_config_cache = Join-Path $here '.npm-cache'
$env:ELECTRON_CACHE = Join-Path $here '.electron-cache'
$env:ELECTRON_BUILDER_CACHE = Join-Path $here '.electron-builder-cache'
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

if (-not (Test-Path (Join-Path $here 'node_modules\electron\dist\electron.exe'))) {
    Write-Host '=== 3/7 首次安装依赖（约 100-300MB）===' -ForegroundColor Cyan
    npm install --no-audit --no-fund
} else {
    Write-Host '=== 3/7 依赖已就绪 ===' -ForegroundColor Cyan
}

Write-Host '=== 4/7 清掉残留进程（否则旧目录删不掉）===' -ForegroundColor Cyan
foreach ($n in @('app.exe', $exeName, 'electron.exe')) {
    Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($n)) -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -like "$outDir*" } | ForEach-Object {
            Write-Host "  kill PID=$($_.Id) $($_.ProcessName)"
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
}

Write-Host '=== 5/7 打包绿色目录版 ===' -ForegroundColor Cyan
& (Join-Path $here 'node_modules\.bin\electron-builder.cmd') --win dir --x64
if ($LASTEXITCODE -ne 0) { throw '打包失败，把完整输出贴给鲸鱼娘' }

Write-Host '=== 6/7 主程序改名 app.exe + 编译启动器 ===' -ForegroundColor Cyan
$mainExe = Join-Path $appDir $exeName
$appExe = Join-Path $appDir 'app.exe'
if (Test-Path $mainExe) { Move-Item $mainExe $appExe -Force }

if (-not (Test-Path $ico) -and (Test-Path (Join-Path (Split-Path -Parent $here) 'extension\icons'))) {
    $iconsDir = Join-Path (Split-Path -Parent $here) 'extension\icons'
    node (Join-Path $here 'tools\make-ico.mjs') $ico `
        (Join-Path $iconsDir 'icon16.png') (Join-Path $iconsDir 'icon48.png') `
        (Join-Path $iconsDir 'icon128.png') (Join-Path $iconsDir 'icon256.png')
}

$csc = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw '找不到 csc.exe（.NET Framework 4.x），无法编译启动器' }

& $csc /nologo /target:winexe /platform:anycpu /optimize+ "/win32icon:$ico" `
    "/out:$(Join-Path $appDir $exeName)" /r:System.Windows.Forms.dll `
    (Join-Path $here 'tools\launcher.cs')
if ($LASTEXITCODE -ne 0) { throw '启动器编译失败' }

Write-Host '=== 7/7 刻图标与版本信息 ===' -ForegroundColor Cyan
if (Test-Path $rcedit) {
    $common = @(
        "--set-icon", $ico,
        "--set-file-version", '1.0.0.0',
        "--set-product-version", '1.0.0',
        "--set-version-string", 'ProductName', '升学E网通助手',
        "--set-version-string", 'CompanyName', '大肥鱼',
        "--set-version-string", 'LegalCopyright', '本地学习辅助工具'
    )
    & $rcedit $appExe @common --set-version-string 'FileDescription' '升学E网通助手 桌面版'
    & $rcedit (Join-Path $appDir $exeName) @common --set-version-string 'FileDescription' '升学E网通助手 启动器'
    Write-Host '  已刻图标 ✅' -ForegroundColor Green
} else {
    Write-Warning '找不到 rcedit，跳过图标'
}

Write-Host ''
Write-Host '完成！双击这个就能用：' -ForegroundColor Green
Write-Host "  $appDir\$exeName" -ForegroundColor Yellow
