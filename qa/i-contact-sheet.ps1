# Stream I: compose a labelled contact sheet (JPEG) from images, Acira's tile first and outlined in accent blue.
# powershell -File qa/i-contact-sheet.ps1 -Out docs/design/benchmark/sheets/sidebar.jpg -Title "Sidebar / vertical tabs" -Items "img/a.jpg|Acira (today)","img/b.png|Arc"
param([string]$Out, [string]$Title, [string]$List, [int]$Cols = 3, [int]$TileW = 440, [int]$TileH = 280)
# -List is "path|label;;path|label;;…" (a single string survives powershell -File from bash).
$Items = $List -split ';;' | Where-Object { $_ }
Add-Type -AssemblyName System.Drawing
$pad = 16; $labelH = 26; $headH = 44
$rows = [Math]::Ceiling($Items.Count / $Cols)
$W = $pad + $Cols * ($TileW + $pad); $H = $headH + $rows * ($TileH + $labelH + $pad) + $pad
$sheet = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::FromArgb(246, 246, 247))
$titleFont = New-Object System.Drawing.Font("Segoe UI Semibold", 14)
$labelFont = New-Object System.Drawing.Font("Segoe UI", 10)
$ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(24, 24, 27))
$muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(110, 110, 118))
$g.DrawString($Title, $titleFont, $ink, $pad, 12)
$i = 0
foreach ($item in $Items) {
  $parts = $item.Split('|'); $file = $parts[0]; $label = $parts[1]
  $c = $i % $Cols; $r = [Math]::Floor($i / $Cols)
  $x = $pad + $c * ($TileW + $pad); $y = $headH + $r * ($TileH + $labelH + $pad)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)), $x, $y, $TileW, $TileH)
  try {
    $img = [System.Drawing.Image]::FromFile((Resolve-Path $file))
    # Fit inside the tile, keep aspect, centre.
    $s = [Math]::Min($TileW / $img.Width, $TileH / $img.Height)
    $w = [int]($img.Width * $s); $h = [int]($img.Height * $s)
    $g.DrawImage($img, [int]($x + ($TileW - $w) / 2), [int]($y + ($TileH - $h) / 2), $w, $h)
    $img.Dispose()
  } catch { $g.DrawString("missing: $file", $labelFont, $muted, $x + 8, $y + 8) }
  $pen = if ($label -like 'Acira*') { New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(59, 110, 234)), 2 } else { New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(222, 222, 226)), 1 }
  $g.DrawRectangle($pen, $x, $y, $TileW, $TileH)
  $g.DrawString($label, $labelFont, $(if ($label -like 'Acira*') { $ink } else { $muted }), $x, $y + $TileH + 4)
  $i++
}
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 84L
$sheet.Save($Out, $codec, $params)
$g.Dispose(); $sheet.Dispose()
"sheet $Out ($($Items.Count) tiles)"
