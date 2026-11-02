# Shared guard for every QA rig that installs, repairs, updates or uninstalls Acira on this PC (dot-source it: . "$PSScriptRoot\installer-identity.ps1").
# QA installers carry their OWN identity ("Acira Browser QA", built with `node scripts/release.mjs --qa-identity`): a different app id, uninstall
# entry, browser registration, URL ProgID, Start-menu shortcut, install and data folders. The real identity shares them with the founder's own
# Acira, so a test install or uninstall with it would rewrite or delete his uninstall entry, registration and shortcut (this happened, 27-28 Oct).
#   Assert-AciraQaInstaller <setup.exe>          refuses a real-identity installer unless ACIRA_QA_REAL_IDENTITY=1
#   Assert-AciraQaInstall <install folder>       refuses to uninstall or repair a real-identity install unless ACIRA_QA_REAL_IDENTITY=1
#   $before = Get-AciraRegistrySnapshot          uninstall entries, StartMenuInternet, Classes\Acira*, RegisteredApplications, Software\AciraBrowser*, Start-menu shortcuts
#   Assert-AciraRealIdentityUnchanged $before    fails if anything outside the QA identity changed since $before
$script:AciraQaProduct = 'Acira Browser QA'
$script:AciraQaGuid = '7c3f8a1e-5b2d-5e94-a6c0-3d1e9f4b2a87'   # packaging/signing-config.cjs QA_IDENTITY.guid
$script:AciraQaPattern = 'Acira Browser QA|AciraBrowserQA|acira-browser-qa|computer\.acira\.browser\.qa|' + [regex]::Escape($script:AciraQaGuid)

function Test-AciraRealIdentityAllowed { return $env:ACIRA_QA_REAL_IDENTITY -eq '1' }

function Assert-AciraQaInstaller([string]$Path) {
  $info = (Get-Item -LiteralPath $Path).VersionInfo
  $product = ($info.ProductName + '').Trim()
  if ($product -eq $script:AciraQaProduct) { return }
  if (Test-AciraRealIdentityAllowed) { Write-Warning "ACIRA_QA_REAL_IDENTITY=1: running the REAL-identity installer $Path ($product); it shares the installed Acira's uninstall entry, registration and shortcut."; return }
  throw "Refusing: $Path is a real-identity installer ('$product'). Installing or uninstalling it replaces or removes the installed Acira's uninstall entry, browser registration and Start-menu shortcut. Build a QA candidate: node scripts/release.mjs --qa-identity --skip-tests --out release/round/<name>  (or set ACIRA_QA_REAL_IDENTITY=1 if that is really meant)."
}

function Assert-AciraQaInstall([string]$InstallRoot) {
  $exe = Join-Path $InstallRoot 'AciraBrowser.exe'
  if (-not (Test-Path -LiteralPath $exe)) { return }
  $product = ((Get-Item -LiteralPath $exe).VersionInfo.ProductName + '').Trim()
  if ($product -eq $script:AciraQaProduct) { return }
  if (Test-AciraRealIdentityAllowed) { Write-Warning "ACIRA_QA_REAL_IDENTITY=1: touching the REAL-identity install in $InstallRoot."; return }
  throw "Refusing: $InstallRoot holds a real-identity Acira ('$product'); removing or repairing it changes the registration the installed Acira shares. Use a QA-identity build (or ACIRA_QA_REAL_IDENTITY=1)."
}

function Get-AciraRegistrySnapshot {
  $lines = New-Object System.Collections.Generic.List[string]
  $add = { param($prefix, $path) if (-not (Test-Path -LiteralPath $path)) { return }; $k = Get-Item -LiteralPath $path; foreach ($v in $k.GetValueNames()) { $lines.Add("$prefix | $v = " + $k.GetValue($v, $null, 'DoNotExpandEnvironmentNames')) }; if ($k.GetValueNames().Count -eq 0) { $lines.Add("$prefix | (key)") } }
  foreach ($k in @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue)) { & $add ("Uninstall\" + $k.PSChildName) $k.PSPath }
  foreach ($k in @(Get-ChildItem 'HKCU:\Software\Clients\StartMenuInternet' -Recurse -ErrorAction SilentlyContinue)) { & $add ($k.Name -replace '^HKEY_CURRENT_USER\\', '') $k.PSPath }
  foreach ($k in @(Get-ChildItem 'HKCU:\Software\Classes' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like 'Acira*' })) { foreach ($s in @($k) + @(Get-ChildItem -LiteralPath $k.PSPath -Recurse -ErrorAction SilentlyContinue)) { & $add ($s.Name -replace '^HKEY_CURRENT_USER\\', '') $s.PSPath } }
  foreach ($proto in 'http', 'https') { foreach ($p in "HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\$proto\UserChoice", "HKCU:\Software\Classes\$proto\shell\open\command") { & $add ($p -replace '^HKCU:\\', '') $p } }
  $reg = Get-Item -LiteralPath 'HKCU:\Software\RegisteredApplications' -ErrorAction SilentlyContinue
  if ($reg) { foreach ($v in $reg.GetValueNames() | Where-Object { $_ -like '*Acira*' }) { $lines.Add("Software\RegisteredApplications | $v = " + $reg.GetValue($v)) } }
  foreach ($k in @(Get-ChildItem 'HKCU:\Software' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like 'AciraBrowser*' -or $_.PSChildName -match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' })) { foreach ($s in @($k) + @(Get-ChildItem -LiteralPath $k.PSPath -Recurse -ErrorAction SilentlyContinue)) { & $add ($s.Name -replace '^HKEY_CURRENT_USER\\', '') $s.PSPath } }
  $menu = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
  $shell = New-Object -ComObject WScript.Shell
  foreach ($f in @(Get-ChildItem -LiteralPath $menu -Filter '*Acira*.lnk' -Recurse -ErrorAction SilentlyContinue) + @(Get-ChildItem -LiteralPath ([Environment]::GetFolderPath('Desktop')) -Filter '*Acira*.lnk' -ErrorAction SilentlyContinue)) { $lines.Add('Shortcut ' + $f.FullName + ' -> ' + $shell.CreateShortcut($f.FullName).TargetPath + ' @ ' + $f.LastWriteTimeUtc.Ticks) }
  return ,@($lines | Sort-Object)
}

# Every difference must belong to the QA identity (its key, GUID, names); anything else (the real Acira's entry, registration, ProgID,
# shortcut, the person's default-browser choice) is a failure.
function Assert-AciraRealIdentityUnchanged($Before, [string]$Label = 'this run') {
  $after = Get-AciraRegistrySnapshot
  $diff = @(Compare-Object @($Before) @($after))
  $foreign = @($diff | Where-Object { $_.InputObject -notmatch $script:AciraQaPattern })
  if ($foreign.Count) { throw ("Registry / shortcut changes outside the QA identity during ${Label}:`n" + (($foreign | ForEach-Object { $_.SideIndicator + ' ' + $_.InputObject }) -join "`n")) }
  return @($diff | ForEach-Object { $_.SideIndicator + ' ' + $_.InputObject })
}
