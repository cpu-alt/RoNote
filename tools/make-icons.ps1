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
# Dégradé de la marque, bleu (je donne) vers vert (je reçois) : lisible en 16 px sur barre claire comme sombre.
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 28, 110, 255),
    [System.Drawing.Color]::FromArgb(255, 22, 190, 120),
    45.0)
$g.FillPath($brush, $path)

# reflet doux en haut
$hl = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(0, 0, $S, ($S / 2))),
    [System.Drawing.Color]::FromArgb(60, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
    90.0)
$g.SetClip($path)
$g.FillRectangle($hl, 0, 0, $S, ($S / 2))
$g.ResetClip()

# --- deux flèches d'échange, blanches -------------------------------------
function New-ArrowPen([System.Drawing.Color]$color) {
    $pen = New-Object System.Drawing.Pen($color, 54)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $cap = New-Object System.Drawing.Drawing2D.AdjustableArrowCap(2.0, 2.1, $true)
    $pen.CustomEndCap = $cap
    $pen
}

$shadow = New-ArrowPen ([System.Drawing.Color]::FromArgb(55, 0, 20, 60))
$g.DrawLine($shadow, 126, 198, 366, 198)
$g.DrawLine($shadow, 386, 330, 146, 330)
$white = New-ArrowPen ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
$g.DrawLine($white, 120, 186, 360, 186)      # -> je reçois
$soft = New-ArrowPen ([System.Drawing.Color]::FromArgb(225, 255, 255, 255))
$g.DrawLine($soft, 392, 318, 152, 318)       # <- je donne

# --- déclinaisons ---------------------------------------------------------
# 48 et 128 (store, chrome://extensions, popup) : le logo grimoire, tiré de store-assets/logo-grimoire-1024.png
# (dépôt Neuronal, logos/grimoire). Ce script ne refait que les petites icônes de la barre d'outils.
foreach ($size in 32, 16) {
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
