param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [string]$Label = 'packaged-final',
  [string[]]$Scripts = @(),
  [switch]$InstallUninstallOnly,
  [switch]$StartupOnly
)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$releaseRoot = (Resolve-Path -LiteralPath (Join-Path $workspace 'release')).Path
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
if (-not $installerPath.StartsWith($releaseRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer must be generated inside this workspace release directory' }
if ($Label -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid QA label' }
# QA identity only (qa/installer-identity.ps1): a real-identity install or uninstall rewrites or removes the installed Acira's uninstall entry,
# registration and Start-menu shortcut. ACIRA_QA_REAL_IDENTITY=1 is the only way past this, and switches the checks below to the real names.
. (Join-Path $PSScriptRoot 'installer-identity.ps1')
Assert-AciraQaInstaller $installerPath
$real = Test-AciraRealIdentityAllowed
$idExe = if ($real) { 'AciraBrowser.exe' } else { 'AciraBrowserQA.exe' }
$idName = if ($real) { 'Acira Browser' } else { 'Acira Browser QA' }; $idKey = if ($real) { 'AciraBrowser' } else { 'AciraBrowserQA' }
$registryBefore = Get-AciraRegistrySnapshot
$installRoot = [IO.Path]::GetFullPath((Join-Path $workspace ('.qa-profiles\installed-' + $Label)))
$qaRoot = (Resolve-Path -LiteralPath (Join-Path $workspace '.qa-profiles')).Path
if (-not $installRoot.StartsWith($qaRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Install target escaped QA root' }
if (Test-Path -LiteralPath $installRoot) { throw 'Choose a new install label; do not overwrite an existing directory' }
function AciraRegistrations {
  foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue | ForEach-Object {
      $registryEntry = Get-Item -LiteralPath $_.PSPath -ErrorAction Stop
      $item = [pscustomobject]@{DisplayName=$registryEntry.GetValue('DisplayName'); InstallLocation=$registryEntry.GetValue('InstallLocation'); UninstallString=$registryEntry.GetValue('UninstallString')}
      if (($real -and $item.DisplayName -like 'Acira Browser*' -and $item.DisplayName -notlike 'Acira Browser QA*') -or (-not $real -and $item.DisplayName -like 'Acira Browser QA*')) { [pscustomobject]@{Key=$_.Name; InstallLocation=$item.InstallLocation; UninstallString=$item.UninstallString} }
    }
  }
}
if (@(AciraRegistrations).Count) { throw 'An existing Acira installation is registered; preserve it' }
function BrowserRegistrationPresent {
  (Test-Path -LiteralPath "HKCU:\Software\$idKey") -or
  (Test-Path -LiteralPath "HKCU:\Software\Classes\$idKey.Url") -or
  ($null -ne (Get-ItemProperty -LiteralPath 'HKCU:\Software\RegisteredApplications' -Name $idName -ErrorAction SilentlyContinue))
}
if (BrowserRegistrationPresent) { throw 'Existing Acira browser registration must be preserved' }
$startMenu = Join-Path ([Environment]::GetFolderPath('StartMenu')) "Programs\$idName.lnk"
if (Test-Path -LiteralPath $startMenu) { throw 'An existing Acira shortcut must be preserved' }
$oldEnv = @{APPDATA=$env:APPDATA; LOCALAPPDATA=$env:LOCALAPPDATA; D_APP_EXE=$env:D_APP_EXE; D_VISIBLE=$env:D_VISIBLE; ACIRA_BROWSER_TEST_DATA=$env:ACIRA_BROWSER_TEST_DATA}
$fixtureRoot = Join-Path $qaRoot ('installer-fixture-' + $Label)
$env:APPDATA = Join-Path $fixtureRoot 'roaming'
$env:LOCALAPPDATA = Join-Path $fixtureRoot 'local'
$env:ACIRA_QA_RUN = '1'; $env:ACIRA_BROWSER_TEST_DATA = Join-Path $fixtureRoot 'profile'
$env:D_VISIBLE = '1'
New-Item -ItemType Directory -Path $env:APPDATA,$env:LOCALAPPDATA,$env:ACIRA_BROWSER_TEST_DATA -Force | Out-Null
$record = @{verificationMode=$(if($InstallUninstallOnly){'install-uninstall-only'}elseif($StartupOnly){'startup-only'}else{'full'}); installer=$installerPath; sha256=(Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash; installRoot=$installRoot; installed=$false; suiteExit=$null; torConnectivityExit=$null; uninstalled=$false; registryClean=$false; shortcutClean=$false}
$installed = $false
try {
  $setup = Start-Process -FilePath $installerPath -ArgumentList @('/S',('/D=' + $installRoot)) -PassThru -WindowStyle Hidden
  if (-not $setup.WaitForExit(300000)) { Stop-Process -Id $setup.Id -Force; throw 'Installer timed out' }
  if ($setup.ExitCode -ne 0) { throw ('Installer exit ' + $setup.ExitCode) }
  $installed = $true
  $env:D_APP_EXE = Join-Path $installRoot $idExe
  if (-not (Test-Path -LiteralPath $env:D_APP_EXE)) { throw 'Installed executable missing' }
  $record.installed = $true
  $record.registration = @(AciraRegistrations)
  $record.shortcutCreated = Test-Path -LiteralPath $startMenu
  if ($record.registration.Count -ne 1 -or -not $record.shortcutCreated) { throw 'Installer did not create its uninstall entry and Start-menu shortcut' }
  $record.defaultBrowserRegistered = BrowserRegistrationPresent
  $registeredLocation = (Get-ItemProperty -LiteralPath "HKCU:\Software\$idKey" -Name InstallLocation).InstallLocation
  if ($registeredLocation -ne $installRoot -or -not $record.defaultBrowserRegistered) { throw 'Default-browser registration did not target this installation' }
  $capabilities = (Get-ItemProperty -LiteralPath 'HKCU:\Software\RegisteredApplications' -Name $idName).$idName
  $urlCommand = (Get-Item -LiteralPath "HKCU:\Software\Classes\$idKey.Url\shell\open\command").GetValue('')
  if ($capabilities -ne "Software\$idKey\Capabilities" -or $urlCommand -ne ('"' + $env:D_APP_EXE + '" "%1"')) { throw 'Browser URL handler registration is incorrect' }
  $pin = (Get-Content -LiteralPath (Join-Path $workspace 'desktop\browser-services\tor-engine\tor-version.json') -Raw | ConvertFrom-Json).files.'tor.exe'.sha256
  $installedTor = Join-Path $installRoot 'resources\tor\tor.exe'
  $record.torHashMatches = (Get-FileHash -LiteralPath $installedTor -Algorithm SHA256).Hash.ToLowerInvariant() -eq $pin
  if (-not $record.torHashMatches) { throw 'Installed Tor differs from the pinned engine' }
  if (-not $InstallUninstallOnly) {
  & node (Join-Path $PSScriptRoot 'coord-fresh-start.mjs')
  $record.freshStartupExit = $LASTEXITCODE
  if ($record.freshStartupExit -ne 0) { throw 'Bare installed-app startup failed' }
  if (-not $StartupOnly) {
  & node (Join-Path $PSScriptRoot 'run-all-live.mjs') $Label @Scripts
  $record.suiteExit = $LASTEXITCODE
  if ($record.suiteExit -eq 0) {
    & node (Join-Path $PSScriptRoot 'l-privacy-proof.mjs') 'n-tor-window' $Label
    $record.torConnectivityExit = $LASTEXITCODE
  }
  }
  }
} finally {
  try {
    if ($installed -or (Test-Path -LiteralPath $installRoot)) {
      $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue)
      if ($uninstallers.Count -ne 1) { throw 'Expected one owned uninstaller' }
      $uninstall = Start-Process -FilePath $uninstallers[0].FullName -ArgumentList @('/S','/currentuser') -PassThru -WindowStyle Hidden
      if (-not $uninstall.WaitForExit(180000)) { Stop-Process -Id $uninstall.Id -Force; throw 'Uninstaller timed out' }
      $until = [DateTime]::UtcNow.AddSeconds(30)
      # NSIS hands off to a temporary copy; files can disappear before its
      # registry/shortcut cleanup completes. Wait for the entire exit state.
      do {
        $cleanupComplete = -not (Test-Path -LiteralPath (Join-Path $installRoot $idExe)) -and @(AciraRegistrations).Count -eq 0 -and -not (BrowserRegistrationPresent) -and -not (Test-Path -LiteralPath $startMenu)
        if (-not $cleanupComplete) { Start-Sleep -Milliseconds 250 }
      } while (-not $cleanupComplete -and [DateTime]::UtcNow -lt $until)
      $record.uninstalled = -not (Test-Path -LiteralPath (Join-Path $installRoot $idExe))
    }
    $record.registryClean = @(AciraRegistrations).Count -eq 0
    $record.browserRegistrationClean = -not (BrowserRegistrationPresent)
    $record.shortcutClean = -not (Test-Path -LiteralPath $startMenu)
    try { $record.registryChangesQaOnly = @(Assert-AciraRealIdentityUnchanged $registryBefore 'install + uninstall'); $record.registryOutsideQaUnchanged = $true } catch { $record.registryOutsideQaUnchanged = $false; $record.registryError = $_.Exception.Message }
  } finally {
    foreach ($name in $oldEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $oldEnv[$name], 'Process') }
    $reportPath = Join-Path $workspace ('qa\artifacts\overnight\' + $Label + '-installer.json')
    $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    $record | ConvertTo-Json -Depth 5
    if ($record.registryOutsideQaUnchanged -eq $false) { throw $record.registryError }
  }
}
if ((-not $InstallUninstallOnly -and -not $StartupOnly -and ($record.suiteExit -ne 0 -or $record.torConnectivityExit -ne 0)) -or -not $record.uninstalled -or -not $record.registryClean -or -not $record.browserRegistrationClean -or -not $record.shortcutClean) { exit 1 }
