# 升学E网通助手 · 图标生成器
# 从一张源图（jpg/png）生成全部四种形态需要的图标：
#   ① 浏览器扩展   extension/icons/icon{16,48,128,256}.png
#   ② 桌面 EXE     desktop/build/icon.png（再由 tools/make-ico.mjs 转 .ico）
#   ③ 安卓 APK     android/.../mipmap-*dpi/{ic_launcher,ic_launcher_round,ic_launcher_foreground}.png
#
# 用法： pwsh -File tools\make-icons.ps1
#        pwsh -File tools\make-icons.ps1 -Source 别的图.png

param(
    [string]$Source = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) '..\docs/icon-source.jpg')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) '..')).Path
$extDir = Join-Path $root 'extension\icons'
$deskDir = Join-Path $root 'desktop\build'
$andRes = Join-Path $root 'android\app\src\main\res'

if (-not (Test-Path $Source)) { throw "找不到源图：$Source" }
$Source = (Resolve-Path $Source).Path

# ---------------------------------------------------------------- 绘图工具

function New-Canvas([int]$w, [int]$h) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    return @{ bmp = $bmp; g = $g }
}

# 正方形（带边框色背景，避免透明导致某些启动器显示怪）
function Save-Square($img, $crop, [int]$size, [string]$path) {
    $c = New-Canvas $size $size
    $dest = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $c.g.DrawImage($img, $dest, $crop, [System.Drawing.GraphicsUnit]::Pixel)
    $c.g.Dispose()
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    $c.bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $c.bmp.Dispose()
}

# 圆形（透明角）
function Save-Round($img, $crop, [int]$size, [string]$path) {
    $c = New-Canvas $size $size
    $c.g.Clear([System.Drawing.Color]::Transparent)
    $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
    $clip.AddEllipse(0, 0, $size, $size)
    $c.g.SetClip($clip)
    $dest = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $c.g.DrawImage($img, $dest, $crop, [System.Drawing.GraphicsUnit]::Pixel)
    $c.g.Dispose()
    $clip.Dispose()
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    $c.bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $c.bmp.Dispose()
}

# 安卓自适应图标前景：108dp 画布，图案缩到安全区（约 80%），底色填充
function Save-Foreground($img, $crop, [int]$canvas, [System.Drawing.Color]$bg, [string]$path) {
    $c = New-Canvas $canvas $canvas
    $c.g.Clear($bg)
    $inner = [int]($canvas * 0.78)
    $off = [int](($canvas - $inner) / 2)
    $dest = New-Object System.Drawing.Rectangle($off, $off, $inner, $inner)
    $c.g.DrawImage($img, $dest, $crop, [System.Drawing.GraphicsUnit]::Pixel)
    $c.g.Dispose()
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    $c.bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $c.bmp.Dispose()
}

# ---------------------------------------------------------------- 开始

$src = [System.Drawing.Image]::FromFile($Source)
Write-Host ("源图：{0}  {1}x{2}" -f (Split-Path -Leaf $Source), $src.Width, $src.Height) -ForegroundColor Cyan

# 居中裁成正方形
$side = [Math]::Min($src.Width, $src.Height)
$crop = New-Object System.Drawing.Rectangle(
    [int](($src.Width - $side) / 2), [int](($src.Height - $side) / 2), $side, $side)

# 取四条边的平均色当作底色（自适应图标背景 + 圆形外圈）
$r = 0; $g2 = 0; $b = 0; $n = 0
$step = [Math]::Max(1, [int]($side / 90))
$last = $side - 1
foreach ($i in 0..$last) {
    if ($i % $step -ne 0) { continue }
    $pts = @()
    $pts += , @($i, 0)
    $pts += , @($i, $last)
    $pts += , @(0, $i)
    $pts += , @($last, $i)
    foreach ($p in $pts) {
        $px = $src.GetPixel($p[0], $p[1])
        $r += $px.R; $g2 += $px.G; $b += $px.B; $n++
    }
}
$bgColor = [System.Drawing.Color]::FromArgb(255, [int]($r / $n), [int]($g2 / $n), [int]($b / $n))
$bgHex = '#{0:X2}{1:X2}{2:X2}' -f $bgColor.R, $bgColor.G, $bgColor.B
Write-Host "取样底色：$bgHex" -ForegroundColor Cyan

# ① 浏览器扩展
foreach ($s in 16, 48, 128, 256) {
    Save-Square $src $crop $s (Join-Path $extDir "icon$s.png")
}
Write-Host "① 扩展图标 4 张 -> extension/icons/" -ForegroundColor Green

# ② 桌面 EXE
Save-Square $src $crop 256 (Join-Path $deskDir 'icon.png')
Write-Host "② 桌面图标 -> desktop/build/icon.png" -ForegroundColor Green

# ③ 安卓
$densities = @{ 'mdpi' = 1.0; 'hdpi' = 1.5; 'xhdpi' = 2.0; 'xxhdpi' = 3.0; 'xxxhdpi' = 4.0 }
if (Test-Path $andRes) {
    foreach ($d in $densities.Keys) {
        $k = $densities[$d]
        $dir = Join-Path $andRes "mipmap-$d"
        Save-Square $src $crop ([int](48 * $k)) (Join-Path $dir 'ic_launcher.png')
        Save-Round  $src $crop ([int](48 * $k)) (Join-Path $dir 'ic_launcher_round.png')
        Save-Foreground $src $crop ([int](108 * $k)) $bgColor (Join-Path $dir 'ic_launcher_foreground.png')
    }
    # 删掉旧的矢量兜底图（会被同名 PNG 取代，留着容易打架）
    foreach ($old in @('mipmap\ic_launcher.xml', 'mipmap\ic_launcher_round.xml')) {
        $p = Join-Path $andRes $old
        if (Test-Path $p) { Remove-Item $p -Force; Write-Host "   删除旧矢量图 $old" }
    }
    Write-Host "③ 安卓图标 15 张 -> android/.../mipmap-*dpi/" -ForegroundColor Green
} else {
    Write-Host "③ 跳过安卓（找不到 $andRes）" -ForegroundColor Yellow
}

$src.Dispose()
Write-Host "全部完成 ✅" -ForegroundColor Green
