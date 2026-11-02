# Metadata/identity only. Never opens a browser profile. Stop is restricted to this unique run's executable and arguments.
param([ValidateSet('metadata','inspect','close','stop')][string]$Action='inspect', [string]$Executable, [string]$Nonce, [string]$Profile, [int]$Port=0, [string]$FixtureFile)
$ErrorActionPreference='Stop'
if($FixtureFile -and $Action -ne 'inspect'){throw 'Fixture mode is read-only inspection only'}
if ($Action -eq 'metadata') {
  $item=Get-Item -LiteralPath $Executable
  [ordered]@{executable=$item.FullName;productVersion=$item.VersionInfo.ProductVersion;fileVersion=$item.VersionInfo.FileVersion;sha256=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLower()} | ConvertTo-Json -Compress
  exit
}
if ($Nonce -notmatch '^[a-f0-9-]{36}$' -or -not $Profile -or $Port -lt 1024) { throw 'Missing run identity' }
$resolvedExecutable=[IO.Path]::GetFullPath($Executable)
if($FixtureFile){$all=@(foreach($entry in (Get-Content -LiteralPath $FixtureFile -Raw | ConvertFrom-Json)){$entry})}else{$all=@(Get-CimInstance Win32_Process)}
function Has-RunArgument([string]$Command,[string]$Argument){return $Command -match ('(?:^|[\s"])'+[regex]::Escape($Argument)+'(?=[\s"]|$)')}
$roots=@($all | Where-Object { $_.ExecutablePath -and $_.CommandLine -and [string]::Equals($_.ExecutablePath,$resolvedExecutable,[StringComparison]::OrdinalIgnoreCase) -and (Has-RunArgument $_.CommandLine ('--acira-perf-run='+$Nonce)) -and (Has-RunArgument $_.CommandLine ('--user-data-dir='+$Profile)) -and (Has-RunArgument $_.CommandLine ('--remote-debugging-port='+$Port)) -and $_.CommandLine -notmatch '--type=' })
if ($roots.Count -gt 1) { throw 'Multiple owned browser roots; contaminated run' }
if ($Action -eq 'inspect') {
  $owned=@($roots | ForEach-Object { $p=$null;if(-not $FixtureFile){$p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue}; [ordered]@{pid=[int]$_.ProcessId;created=([datetime]$_.CreationDate).ToUniversalTime().ToString('o');windowVisible=!!($p -and $p.MainWindowHandle -ne 0);bootstrap=$_.CommandLine.Contains('--acira-native-key-bootstrap=1')} })
  [ordered]@{roots=$owned;fixtureOnly=!!$FixtureFile} | ConvertTo-Json -Compress -Depth 4
  exit
}
if ($Action -eq 'close') {
  foreach($ownedRoot in $roots) { $p=Get-Process -Id $ownedRoot.ProcessId -ErrorAction SilentlyContinue; if($p){[void]$p.CloseMainWindow()} }
  [ordered]@{requested=$roots.Count;method='CloseMainWindow'} | ConvertTo-Json -Compress
  exit
}
# Last resort after normal CDP/window close. Capture only descendants of the verified root, and recheck each creation time and executable before stopping.
$ownedIds=@{};foreach($ownedRoot in $roots){$ownedIds[[int]$ownedRoot.ProcessId]=$true}
for($pass=0;$pass -lt 12;$pass++){ $added=$false;foreach($candidate in $all){if($ownedIds.ContainsKey([int]$candidate.ParentProcessId) -and -not $ownedIds.ContainsKey([int]$candidate.ProcessId)){$ownedIds[[int]$candidate.ProcessId]=$true;$added=$true}};if(-not $added){break} }
$stopped=@()
foreach($candidate in @($all | Where-Object {$ownedIds.ContainsKey([int]$_.ProcessId)} | Sort-Object CreationDate -Descending)){
  if(-not [string]::Equals($candidate.ExecutablePath,$resolvedExecutable,[StringComparison]::OrdinalIgnoreCase)){continue}
  $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$candidate.ProcessId)
  if($current -and $current.CreationDate -eq $candidate.CreationDate -and [string]::Equals($current.ExecutablePath,$resolvedExecutable,[StringComparison]::OrdinalIgnoreCase)){
    Stop-Process -Id $current.ProcessId -Force -ErrorAction SilentlyContinue;$stopped+= [int]$current.ProcessId
  }
}
[ordered]@{stopped=$stopped;method='verified-owned-executable-descendants-only'} | ConvertTo-Json -Compress
