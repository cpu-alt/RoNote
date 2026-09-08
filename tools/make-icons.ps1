# Génère les icônes PNG de l'extension (aucune dépendance externe).
# Usage : powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\src\icons'
$out = [System.IO.Path]::GetFullPath($out)
if (-not (Test-Path $out)) { New-Item -ItemType Directory -Path $out | Out-Null }

$S = 512
$bmp = New-Object System.Drawing.Bitmap($S, $S)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# --- fond arrondi avec dégradé -------------------------------------------
$r = 110
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, $r, $r, 180, 90)
$path.AddArc($S - $r, 0, $r, $r, 270, 90)
$path.AddArc($S - $r, $S - $r, $r, $r, 0, 90)
$path.AddArc(0, $S - $r, $r, $r, 90, 90)
$path.CloseFigure()

$rect = New-Object System.Drawing.Rectangle(0, 0, $S, $S)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 20, 28, 42),
    [System.Drawing.Color]::FromArgb(255, 10, 15, 24),
    45.0)
$g.FillPath($brush, $path)

$penEdge = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 0, 162, 255), 8)
$g.DrawPath($penEdge, $path)

# --- deux flèches d'échange ----------------------------------------------
function New-ArrowPen([System.Drawing.Color]$color) {
    $pen = New-Object System.Drawing.Pen($color, 46)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $cap = New-Object System.Drawing.Drawing2D.AdjustableArrowCap(2.2, 2.4, $true)
    $pen.CustomEndCap = $cap
    $pen
}

$green = [System.Drawing.Color]::FromArgb(255, 53, 196, 107)
$blue  = [System.Drawing.Color]::FromArgb(255, 0, 162, 255)

$penTop = New-ArrowPen $green
$g.DrawLine($penTop, 120, 190, 372, 190)     # -> vers la droite (je reçois)

$penBottom = New-ArrowPen $blue
$g.DrawLine($penBottom, 392, 322, 140, 322)  # <- vers la gauche (je donne)

# --- déclinaisons ---------------------------------------------------------
foreach ($size in 128, 48, 32, 16) {
    $small = New-Object System.Drawing.Bitmap($size, $size)
    $gs = [System.Drawing.Graphics]::FromImage($small)
    $gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gs.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $gs.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gs.DrawImage($bmp, 0, 0, $size, $size)
    $file = Join-Path $out "icon$size.png"
    $small.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $gs.Dispose(); $small.Dispose()
    Write-Host "ecrit: $file"
}

$g.Dispose(); $bmp.Dispose()
Write-Host "Icones generees dans $out"
