# 升学E网通助手 · APK 一键构建脚本
#
# 前提：工具链已装在 $ToolRoot（默认 C:\dsh-android）
#   jdk\<jdk-17>          OpenJDK 17
#   sdk\                  由 cmdline-tools 装的 platform-tools / platforms;android-34 / build-tools;34.0.0
#   gradle\gradle-8.7\    Gradle 8.7（工程里没有 gradle-wrapper.jar，直接用它）
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-apk.ps1

param(
    [string]$ToolRoot = 'C:\dsh-android',
    [switch]$KeepWork
)

$ErrorActionPreference = 'Stop'

$ws   = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$proj = Join-Path $ws 'android'
$work = Join-Path $ToolRoot 'work\android'
$sdk  = Join-Path $ToolRoot 'sdk'
$apkOut = Join-Path $ws 'dist'

if (-not (Test-Path $proj)) { throw "找不到工程目录：$proj" }

$jdkDir = Get-ChildItem (Join-Path $ToolRoot 'jdk') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jdkDir) { throw "找不到 JDK，请先解压到 $ToolRoot\jdk" }
$gradleBat = Join-Path $ToolRoot 'gradle\gradle-8.7\bin\gradle.bat'
if (-not (Test-Path $gradleBat)) { throw "找不到 Gradle：$gradleBat" }
if (-not (Test-Path (Join-Path $sdk 'platforms\android-34\android.jar'))) { throw "Android SDK 34 未安装完整" }

Write-Host '=== 1/5 环境变量 ===' -ForegroundColor Cyan
$env:JAVA_HOME = $jdkDir.FullName
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:GRADLE_USER_HOME = Join-Path $ToolRoot 'gradle-home'
$env:PATH = "$($jdkDir.FullName)\bin;$env:PATH"
$env:NODE_OPTIONS = ''
Write-Host "  JAVA_HOME = $env:JAVA_HOME"

Write-Host '=== 2/5 复制到短路径工程目录 ===' -ForegroundColor Cyan
# 中文路径 + 深目录容易触发 Windows MAX_PATH 问题，编译放到 C:\ 下的短路径
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $work | Out-Null
robocopy $proj $work /E /XD build .gradle .idea /NFL /NDL /NJH /NJS /NP | Out-Null
Write-Host "  工作副本：$work"

Write-Host '=== 3/5 写 local.properties ===' -ForegroundColor Cyan
$sdkEsc = $sdk.Replace('\', '\\')
Set-Content -Encoding ASCII -Path (Join-Path $work 'local.properties') -Value @(
    "sdk.dir=$sdkEsc"
)
Write-Host "  sdk.dir=$sdkEsc"

Write-Host '=== 4/5 gradle assembleDebug（首次会下依赖，几分钟起）===' -ForegroundColor Cyan
$log = Join-Path $work 'build.log'
Push-Location $work
& $gradleBat assembleDebug --no-daemon --console=plain --stacktrace *> $log
$code = $LASTEXITCODE
Pop-Location

if ($code -ne 0) {
    Write-Host '--- 编译失败，最后 60 行 ---' -ForegroundColor Red
    Get-Content $log -Tail 60
    throw "gradle 编译失败（exit=$code），完整日志：$log"
}

Write-Host '=== 5/5 收取 APK ===' -ForegroundColor Cyan
$apk = Join-Path $work 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $apk)) { throw "没找到 APK：$apk" }
New-Item -ItemType Directory -Force -Path $apkOut | Out-Null
$dest = Join-Path $apkOut 'EWT360-Helper-1.0.0-debug.apk'
Copy-Item $apk $dest -Force

Write-Host ''
Write-Host ('完成 ✅  APK：' + $dest) -ForegroundColor Green
Write-Host ('  大小：{0:N1} MB' -f ((Get-Item $dest).Length / 1MB))
Get-Content $log -Tail 6

if (-not $KeepWork) { Write-Host "（中间产物在 $work，可手工删除）" }
