# Packaged QA for a release candidate (round 3). Installs the installer silently per-user into a scratch folder,
# runs the live QA against the INSTALLED exe on disposable profiles, and checks that the uninstaller leaves nothing behind.
#   powershell -File qa\r3-packaged.ps1 -Action Install   -Installer release\round\r3-final\assets\AciraBrowserQASetup.exe
#   powershell -File qa\r3-packaged.ps1 -Action Run       [-Steps bare,uptime,setup,suite,tor] [-Scripts d-tabs,h-split]
#   powershell -File qa\r3-packaged.ps1 -Action Uninstall
# Evidence: qa\artifacts\r3-packaged\*.json|*.log.  Never touches the real profile (every app gets ACIRA_BROWSER_TEST_DATA under
# .qa-profiles), never uses Windows Hello (ACIRA_PASSWORDS_TEST_GATE=allow), takes a native slot (C:\ae\slot-1..3.lock) per app run.
param(
  [Parameter(Mandatory=$true)][ValidateSet('Install','Run','Uninstall')][string]$Action,
  [string]$Installer,
  [string]$InstallRoot = 'C:\ae\inst-r3',
  [string]$Work = 'C:\ae\r3\packaged',
  [string]$Label = 'r3-packaged',
  [string]$EvidenceName = 'r3-packaged',   # folder under qa\artifacts; a later round uses its own so earlier evidence is kept
  [string[]]$Steps = @('bare','uptime','setup','suite','tor'),
  [string[]]$Scripts = @(),
  [switch]$Continue
)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$evidence = Join-Path $workspace ('qa\artifacts\' + $EvidenceName)
New-Item -ItemType Directory -Force -Path $evidence, $Work, (Join-Path $Work 'roaming'), (Join-Path $Work 'local'), (Join-Path $Work 'shots') | Out-Null
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
# $exe is set below, once the identity is known: the QA identity installs AciraBrowserQA.exe.
# QA identity by default (qa/installer-identity.ps1): this rig installs and removes "Acira Browser QA", never the real Acira the PC may also
# have; ACIRA_QA_REAL_IDENTITY=1 switches every check to the real names. Registry and shortcuts outside that identity must not change.
. (Join-Path $PSScriptRoot 'installer-identity.ps1')
$real = Test-AciraRealIdentityAllowed
$idName = if ($real) { 'Acira Browser' } else { 'Acira Browser QA' }; $idKey = if ($real) { 'AciraBrowser' } else { 'AciraBrowserQA' }; $idProgId = "$idKey.Url"; $exeName = if ($real) { 'AciraBrowser.exe' } else { 'AciraBrowserQA.exe' }; $exe = Join-Path $InstallRoot $exeName
$idEntry = { param($n) if ($real) { $n -like 'Acira Browser*' -and $n -notlike 'Acira Browser QA*' } else { $n -like 'Acira Browser QA*' } }
$registryBeforeFile = Join-Path $evidence 'registry-before.json'

function UninstallEntries {
  foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue | ForEach-Object {
      $item = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
      if (& $idEntry $item.DisplayName) { [pscustomobject]@{Key=$_.Name; DisplayName=$item.DisplayName; DisplayVersion=$item.DisplayVersion; InstallLocation=$item.InstallLocation; UninstallString=$item.UninstallString; QuietUninstallString=$item.QuietUninstallString} }
    }
  }
}
# Everything that makes Acira appear as a browser: capabilities, URL ProgID, RegisteredApplications, StartMenuInternet, App Paths.
function BrowserRegistrations {
  $found = @()
  foreach ($p in @("HKCU:\Software\$idKey","HKCU:\Software\Classes\$idProgId","HKCU:SoftwareClassesApplications$exeName",'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\AciraBrowser.exe')) { if (Test-Path -LiteralPath $p) { $found += $p } }
  foreach ($p in @('HKCU:\Software\RegisteredApplications','HKLM:\Software\RegisteredApplications')) { if ($null -ne (Get-ItemProperty -LiteralPath $p -Name $idName -ErrorAction SilentlyContinue)) { $found += "$p [$idName]" } }
  foreach ($p in @('HKCU:\Software\Clients\StartMenuInternet','HKLM:\Software\Clients\StartMenuInternet')) { Get-ChildItem -LiteralPath $p -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like "$idKey*" -or $_.PSChildName -eq $idName } | ForEach-Object { $found += ($p + '\' + $_.PSChildName) } }
  Get-ChildItem -LiteralPath 'HKCU:\Software\Classes' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -eq $idProgId } | ForEach-Object { $found += ('HKCU:\Software\Classes\' + $_.PSChildName) }
  @($found | Select-Object -Unique)
}
function Shortcuts {
  $dirs = @(
    @{Where='Start menu (user)';   Path=[Environment]::GetFolderPath('Programs')},
    @{Where='Start menu (all users)'; Path=[Environment]::GetFolderPath('CommonPrograms')},
    @{Where='Desktop (user)';      Path=[Environment]::GetFolderPath('DesktopDirectory')},
    @{Where='Desktop (all users)'; Path=[Environment]::GetFolderPath('CommonDesktopDirectory')})
  # Start menu: shortcuts or folders named *Acira* (one level deep); Desktop: top-level *Acira*.lnk only (the founder keeps project folders there).
  foreach ($d in $dirs) {
    if (-not ($d.Path -and (Test-Path -LiteralPath $d.Path))) { continue }
    $items = if ($d.Where -like 'Start menu*') { Get-ChildItem -LiteralPath $d.Path -Recurse -Depth 1 -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*Acira*' } } else { Get-ChildItem -LiteralPath $d.Path -Filter '*Acira*.lnk' -File -Force -ErrorAction SilentlyContinue }
    $items | ForEach-Object { "$($d.Where): $($_.FullName)" }
  }
}
# Shortcuts that existed before the install (the founder's own) are preserved and ignored; only new ones count.
$baselineFile = Join-Path $evidence 'shortcuts-baseline.json'
function NewShortcuts { $base = if (Test-Path -LiteralPath $baselineFile) { @(Get-Content -LiteralPath $baselineFile -Raw | ConvertFrom-Json) } else { @() }; @(Shortcuts | Where-Object { $base -notcontains $_ }) }
$startMenuLnk = Join-Path ([Environment]::GetFolderPath('Programs')) "$idName.lnk"
# The founder's own Acira data folder must not change while this QA runs (every QA app uses a disposable profile).
function RealDataSnapshot {
  $dir = Join-Path $env:APPDATA 'AciraBrowser'
  if (-not (Test-Path -LiteralPath $dir)) { return 'absent' }
  (Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object { $_.Name + '|' + $_.LastWriteTimeUtc.Ticks }) -join ';'
}
function Save($name, $value) { ConvertTo-Json -InputObject $value -Depth 6 | Set-Content -LiteralPath (Join-Path $evidence $name) -Encoding UTF8 }
function Load($name) { Get-Content -LiteralPath (Join-Path $evidence $name) -Raw | ConvertFrom-Json }
function Stop-Tree($id) { & taskkill.exe /PID $id /T /F 2>&1 | Out-Null }

if ($Action -eq 'Install') {
  $releaseRoot = (Resolve-Path -LiteralPath (Join-Path $workspace 'release')).Path
  $installerPath = (Resolve-Path -LiteralPath $Installer).Path
  if (-not $installerPath.StartsWith($releaseRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer must be inside this workspace release directory' }
  Assert-AciraQaInstaller $installerPath
  # The snapshot comes back as one array object (,@()); @() around it would save an array inside an array, which then matches nothing.
  ConvertTo-Json -InputObject ([string[]](Get-AciraRegistrySnapshot)) | Set-Content -LiteralPath $registryBeforeFile -Encoding UTF8
  if (Test-Path -LiteralPath $InstallRoot) { throw "Install target $InstallRoot already exists; pick a new one" }
  if (@(UninstallEntries).Count) { throw 'An Acira installation is already registered; it is preserved, nothing installed' }
  if (@(BrowserRegistrations).Count) { throw 'An Acira browser registration already exists; it is preserved, nothing installed' }
  if (Test-Path -LiteralPath $startMenuLnk) { throw "An `"$idName`" Start-menu shortcut already exists; it is preserved, nothing installed" }
  $shortcutsBefore = @(Shortcuts)
  ConvertTo-Json -InputObject $shortcutsBefore | Set-Content -LiteralPath $baselineFile -Encoding UTF8
  $record = [ordered]@{ installer=$installerPath; bytes=(Get-Item -LiteralPath $installerPath).Length; sha256=(Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant(); installRoot=$InstallRoot; realDataBefore=(RealDataSnapshot); startedUtc=(Get-Date).ToUniversalTime().ToString('o'); installed=$false }
  $old = @{A=$env:APPDATA; L=$env:LOCALAPPDATA}
  $env:APPDATA = Join-Path $Work 'roaming'; $env:LOCALAPPDATA = Join-Path $Work 'local'
  try {
    $setup = Start-Process -FilePath $installerPath -ArgumentList @('/S',('/D=' + $InstallRoot)) -PassThru -WindowStyle Hidden
    if (-not $setup.WaitForExit(300000)) { Stop-Tree $setup.Id; throw 'Installer timed out' }
    $record.installerExit = $setup.ExitCode
    if ($setup.ExitCode -ne 0) { throw ('Installer exit ' + $setup.ExitCode) }
  } finally { $env:APPDATA = $old.A; $env:LOCALAPPDATA = $old.L; $record.finishedUtc = (Get-Date).ToUniversalTime().ToString('o') }
  $record.exePresent = Test-Path -LiteralPath $exe
  $record.exeSha256 = if ($record.exePresent) { (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
  $record.exeSignature = if ($record.exePresent) { (Get-AuthenticodeSignature -LiteralPath $exe).Status.ToString() } else { $null }
  $record.uninstallEntries = @(UninstallEntries)
  $record.startMenuShortcut = Test-Path -LiteralPath $startMenuLnk
  $record.shortcutsBefore = $shortcutsBefore
  $record.newShortcuts = @(NewShortcuts)
  $record.newDesktopShortcuts = @(NewShortcuts | Where-Object { $_ -like 'Desktop*' })   # none expected: createDesktopShortcut is false
  $record.browserRegistrations = @(BrowserRegistrations)
  $record.registeredInstallLocation = (Get-ItemProperty -LiteralPath "HKCU:\Software\$idKey" -Name InstallLocation -ErrorAction SilentlyContinue).InstallLocation
  $record.urlAssociations = (Get-ItemProperty -LiteralPath "HKCU:\Software\$idKey\Capabilities\URLAssociations" -ErrorAction SilentlyContinue | Select-Object http, https)
  $record.capabilitiesPointer = (Get-ItemProperty -LiteralPath 'HKCU:\Software\RegisteredApplications' -Name $idName -ErrorAction SilentlyContinue).$idName
  $record.urlHandlerCommand = (Get-Item -LiteralPath "HKCU:\Software\Classes\$idProgId\shell\open\command" -ErrorAction SilentlyContinue).GetValue('')
  $pin = (Get-Content -LiteralPath (Join-Path $workspace 'desktop\browser-services\tor-engine\tor-version.json') -Raw | ConvertFrom-Json).files.'tor.exe'.sha256
  $tor = Join-Path $InstallRoot 'resources\tor\tor.exe'
  $record.torHashMatchesPin = (Test-Path -LiteralPath $tor) -and ((Get-FileHash -LiteralPath $tor -Algorithm SHA256).Hash.ToLowerInvariant() -eq $pin)
  $record.installDirBytes = (Get-ChildItem -LiteralPath $InstallRoot -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  $problems = @()
  if (-not $record.exePresent) { $problems += 'installed exe missing' }
  if ($record.uninstallEntries.Count -ne 1) { $problems += 'expected exactly one uninstall entry' }
  if (-not $record.startMenuShortcut) { $problems += 'Start-menu shortcut missing' }
  if ($record.registeredInstallLocation -ne $InstallRoot) { $problems += 'browser registration does not point at this install' }
  if ($record.capabilitiesPointer -ne "Software\$idKey\Capabilities" -or $record.urlAssociations.http -ne $idProgId -or $record.urlAssociations.https -ne $idProgId) { $problems += 'capabilities / URL associations wrong' }
  if ($record.urlHandlerCommand -ne ('"' + $exe + '" "%1"')) { $problems += 'URL handler command wrong' }
  if (-not $record.torHashMatchesPin) { $problems += 'installed tor.exe differs from the pinned hash' }
  $record.problems = $problems; $record.ok = ($problems.Count -eq 0)
  Save 'install.json' $record
  $record | ConvertTo-Json -Depth 6
  if (-not $record.ok) { exit 1 }
  exit 0
}

if ($Action -eq 'Run') {
  if (-not (Test-Path -LiteralPath $exe)) { throw "No installed exe at $exe; run -Action Install first" }
  $env:APPDATA = Join-Path $Work 'roaming'; $env:LOCALAPPDATA = Join-Path $Work 'local'
  $env:D_APP_EXE = $exe; $env:D_VISIBLE = '1'; $env:ACIRA_QA_SLOT = '1'; $env:ACIRA_PASSWORDS_TEST_GATE = 'allow'
  if ($Continue) { $env:ACIRA_LIVE_CONTINUE = '1' }   # live suite: keep going after a failing script so every failure is listed
  Remove-Item Env:\ELECTRON_RUN_AS_NODE, Env:\ACIRA_DEV -ErrorAction SilentlyContinue
  $env:ACIRA_BARE_START_OUT = Join-Path $evidence 'bare-start.json'
  $rows = @()
  function Step($name, [string[]]$nodeArgs, [int]$limitSeconds, [string]$slotName) {
    $out = Join-Path $evidence "$name.log"; $err = Join-Path $evidence "$name.err.log"
    $argList = if ($slotName) { @('qa\native-slot.mjs', $slotName, '--') + @('node') + $nodeArgs } else { $nodeArgs }
    $started = Get-Date
    $p = Start-Process -FilePath 'node' -ArgumentList $argList -WorkingDirectory $workspace -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
    $null = $p.Handle   # Windows PowerShell 5.1: without a cached handle, ExitCode comes back empty after Start-Process -PassThru
    $timedOut = -not $p.WaitForExit($limitSeconds * 1000)
    if ($timedOut) { Stop-Tree $p.Id }
    $secs = [int]((Get-Date) - $started).TotalSeconds
    $tail = ((Get-Content -LiteralPath $out -Tail 4 -ErrorAction SilentlyContinue) -join ' | ')
    if ($tail.Length -gt 400) { $tail = $tail.Substring($tail.Length - 400) }
    $row = [ordered]@{ step=$name; exit=$(if ($timedOut) { 'timeout' } else { $p.ExitCode }); ok=(-not $timedOut -and $p.ExitCode -eq 0); seconds=$secs; log=$out; tail=$tail }
    $script:rows += [pscustomobject]$row
    Write-Host ("{0,-7} {1,-8} {2,4}s  {3}" -f $(if ($row.ok) { 'PASS' } else { 'FAIL' }), $name, $secs, $tail)
  }
  $wantRun = $Steps
  if ($wantRun -contains 'bare')   { Step 'bare-start' @('qa\coord-fresh-start.mjs') 240 "$Label-bare-start" }
  if ($wantRun -contains 'uptime') { Step 'uptime' @('qa\coord-uptime-smoke.mjs') 240 "$Label-uptime" }
  if ($wantRun -contains 'setup')  { Step 'setup-finale' @('qa\h-setup-viewport.mjs','--path','finish','--shots',(Join-Path $Work 'shots')) 300 "$Label-setup" }
  if ($wantRun -contains 'suite')  {
    $live = Join-Path $workspace '.tmp-d'
    Step 'live-suite' (@('qa\run-all-live.mjs', $Label) + $Scripts) 7200 $null
    if (Test-Path -LiteralPath (Join-Path $live "live-$Label.json")) {
      Copy-Item -LiteralPath (Join-Path $live "live-$Label.json") -Destination (Join-Path $evidence "live-suite-$(Get-Date -Format 'HHmmss').json") -Force
      $dest = Join-Path $evidence 'live'; New-Item -ItemType Directory -Force -Path $dest | Out-Null
      Copy-Item -Path (Join-Path $live "live-$Label\*.log") -Destination $dest -Force -ErrorAction SilentlyContinue
    }
  }
  if ($wantRun -contains 'tor')    { Step 'tor-bootstrap' @('qa\l-privacy-proof.mjs','n-tor-window',$Label) 900 "$Label-tor" }
  $existing = if (Test-Path -LiteralPath (Join-Path $evidence 'run.json')) { @(Load 'run.json') } else { @() }
  Save 'run.json' (@($existing | Where-Object { $_ }) + $rows)
  if (@($rows | Where-Object { -not $_.ok }).Count) { exit 1 }
  exit 0
}

if ($Action -eq 'Uninstall') {
  $record = [ordered]@{ installRoot=$InstallRoot; startedUtc=(Get-Date).ToUniversalTime().ToString('o') }
  Assert-AciraQaInstall $InstallRoot
  # Only processes started from THIS install are stopped (a leftover test window would lock files).
  $record.strayProcessesStopped = @(Get-CimInstance Win32_Process -Filter "Name='$exeName'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallRoot + '\', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Tree $_.ProcessId; $_.ProcessId })
  $entries = @(UninstallEntries)
  $quiet = ($entries | Where-Object { $_.QuietUninstallString } | Select-Object -First 1).QuietUninstallString
  $record.uninstallEntriesBefore = $entries
  $record.shortcutsBefore = @(NewShortcuts); $record.browserRegistrationsBefore = @(BrowserRegistrations)
  try {
    $uninstallers = @(Get-ChildItem -LiteralPath $InstallRoot -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue)
    if ($uninstallers.Count -ne 1) { throw 'Expected one owned uninstaller' }
    $record.command = "$($uninstallers[0].FullName) /S /currentuser"
    $record.quietUninstallString = $quiet
    $u = Start-Process -FilePath $uninstallers[0].FullName -ArgumentList @('/S','/currentuser') -PassThru -WindowStyle Hidden
    $null = $u.Handle
    if (-not $u.WaitForExit(180000)) { Stop-Tree $u.Id; throw 'Uninstaller timed out' }
    $record.uninstallerExit = $u.ExitCode
  } catch { $record.error = $_.Exception.Message }
  finally {
    # NSIS hands off to a temporary copy: files can vanish before its registry/shortcut cleanup finishes. Wait for the whole exit state.
    $until = [DateTime]::UtcNow.AddSeconds(90); $t0 = Get-Date
    do {
      $state = [ordered]@{ installDirGone = -not (Test-Path -LiteralPath $InstallRoot); exeGone = -not (Test-Path -LiteralPath $exe); uninstallKeysGone = (@(UninstallEntries).Count -eq 0); browserRegistrationGone = (@(BrowserRegistrations).Count -eq 0); shortcutsGone = (@(NewShortcuts).Count -eq 0) }
      $done = -not ($state.Values -contains $false)
      if (-not $done) { Start-Sleep -Milliseconds 500 }
    } while (-not $done -and [DateTime]::UtcNow -lt $until)
    $record.waitedSeconds = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    $record.state = $state
    $record.leftoverInstallFiles = if (Test-Path -LiteralPath $InstallRoot) { @(Get-ChildItem -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue | Select-Object -First 20 -ExpandProperty FullName) } else { @() }
    $record.remainingUninstallEntries = @(UninstallEntries); $record.remainingBrowserRegistrations = @(BrowserRegistrations); $record.remainingShortcuts = @(NewShortcuts); $record.preexistingShortcutsStillPresent = @(Shortcuts)
    $record.realDataAfter = RealDataSnapshot
    $install = if (Test-Path -LiteralPath (Join-Path $evidence 'install.json')) { Load 'install.json' } else { $null }
    $record.realDataUnchanged = ($null -ne $install) -and ($install.realDataBefore -eq $record.realDataAfter)
    # after a whole install + uninstall cycle, nothing outside the QA identity may differ from the snapshot taken before the install
    if (Test-Path -LiteralPath $registryBeforeFile) { try { $record.registryChangesQaOnly = @(Assert-AciraRealIdentityUnchanged ([string[]]@((Get-Content -LiteralPath $registryBeforeFile -Raw | ConvertFrom-Json) | ForEach-Object { $_ } | ForEach-Object { $_ })) 'install + uninstall'); $record.registryOk = $true } catch { $record.registryOk = $false; $record.registryError = $_.Exception.Message } } else { $record.registryOk = $false; $record.registryError = 'no registry snapshot from the install step' }
    $record.ok = $done -and -not $record.error -and $record.registryOk
    $record.finishedUtc = (Get-Date).ToUniversalTime().ToString('o')
    Save 'uninstall.json' $record
    $record | ConvertTo-Json -Depth 6
  }
  if (-not $record.ok) { exit 1 }
  exit 0
}
