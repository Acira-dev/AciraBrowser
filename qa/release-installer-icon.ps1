param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$workspace = (Resolve-Path -LiteralPath '.').Path
if (-not $installerPath.StartsWith((Join-Path $workspace 'release\installers\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Use an owned generated installer' }
$canonicalPath = Join-Path $workspace 'packaging\acira-icon.ico'
$actualIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($installerPath)
$expectedIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($canonicalPath)
$actual = $actualIcon.ToBitmap()
$expected = $expectedIcon.ToBitmap()
try {
  if ($actual.Width -ne 32 -or $actual.Height -ne 32 -or $expected.Width -ne 32 -or $expected.Height -ne 32) { throw 'Unexpected native associated icon size' }
  $different = 0
  for ($x=0; $x -lt 32; $x++) { for ($y=0; $y -lt 32; $y++) { if ($actual.GetPixel($x,$y).ToArgb() -ne $expected.GetPixel($x,$y).ToArgb()) { $different++ } } }
  $stem = 'release-installer-icon-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $png = Join-Path $workspace ('qa\artifacts\' + $stem + '.png')
  $json = Join-Path $workspace ('qa\artifacts\' + $stem + '.json')
  $actual.Save($png,[System.Drawing.Imaging.ImageFormat]::Png)
  $record = @{schema=1;checkedAt=[DateTime]::UtcNow.ToString('o');installerSha256=(Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant();canonicalIconSha256=(Get-FileHash -LiteralPath $canonicalPath -Algorithm SHA256).Hash.ToLowerInvariant();width=32;height=32;pixels=1024;differentPixels=$different;status=$(if($different -eq 0){'PASS'}else{'FAIL'});png=[System.IO.Path]::GetFileName($png);method='Read native associated icon resource without executing installer; compare all ARGB pixels against canonical ICO at32px'}
  $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $json -Encoding UTF8
  $record | ConvertTo-Json -Depth 5
  if ($different -ne 0) { throw 'Installer icon differs from canonical resource' }
} finally { $actual.Dispose();$expected.Dispose();$actualIcon.Dispose();$expectedIcon.Dispose() }
