param([Parameter(Mandatory=$true)][int]$ExpectedPid,[Parameter(Mandatory=$true)][string]$ExpectedBuild)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $workspace
$profileDirectory=Join-Path $workspace '.preview-profile'
$metadataFile=Join-Path $profileDirectory 'processes.json'
$metadata=Get-Content -LiteralPath $metadataFile -Raw | ConvertFrom-Json
$prepared=Get-Content -LiteralPath (Join-Path $profileDirectory 'prepared-build.json') -Raw | ConvertFrom-Json
if($metadata.electron -ne $ExpectedPid -or $metadata.build -ne $ExpectedBuild){throw 'The preserved preview identity changed; no process was closed.'}
$allowedBuilds=[IO.Path]::GetFullPath((Join-Path $profileDirectory 'builds'))+[IO.Path]::DirectorySeparatorChar
foreach($target in @($metadata.launchPath,$prepared.launchPath)){
 $resolved=[IO.Path]::GetFullPath($target)
 if(-not $resolved.StartsWith($allowedBuilds,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notmatch '^[a-f0-9]{20}$'){throw 'Preview build path is outside the immutable build directory.'}
}
$process=Get-Process -Id $ExpectedPid
$expectedStart=if($metadata.started -is [DateTime]){$metadata.started.ToUniversalTime()}else{[DateTimeOffset]::Parse([string]$metadata.started).UtcDateTime}
if([IO.Path]::GetFullPath($process.Path) -ne [IO.Path]::GetFullPath($metadata.executable) -or [Math]::Abs(($process.StartTime.ToUniversalTime()-$expectedStart).TotalSeconds) -gt 5){throw 'Preview executable or creation time differs; no process was closed.'}
$native=Get-CimInstance Win32_Process -Filter "ProcessId = $ExpectedPid"
$package=Get-Content -LiteralPath (Join-Path $metadata.launchPath 'package.json') -Raw | ConvertFrom-Json
$resolvedEntry=[IO.Path]::GetFullPath((Join-Path $metadata.launchPath $package.main))
if($resolvedEntry -ne [IO.Path]::GetFullPath($metadata.entry) -or -not $native.CommandLine.Contains(('"'+[string]$metadata.launchPath+'"'))){throw 'The process does not name the exact preserved app directory and entry.'}
& node --input-type=module -e "import fs from 'node:fs';import{verifyPreservedBuild}from'./scripts/preview-snapshot.mjs';verifyPreservedBuild(JSON.parse(fs.readFileSync('.preview-profile/prepared-build.json','utf8')));"
if($LASTEXITCODE -ne 0){throw 'Prepared code verification failed; existing preview kept.'}
if(-not $process.CloseMainWindow()){throw 'The preview did not accept a normal close; no forced termination attempted.'}
for($attempt=0;$attempt -lt 50;$attempt++){if($process.HasExited){break};Start-Sleep -Milliseconds 200;$process.Refresh()}
if(-not $process.HasExited){throw 'The preview is still open, possibly awaiting beforeunload approval. No forced termination attempted.'}
& node scripts/preview.mjs --launch-prepared
if($LASTEXITCODE -ne 0){throw 'Prepared preview launch failed.'}
$replacement=Get-Content -LiteralPath $metadataFile -Raw | ConvertFrom-Json
if($replacement.build -ne $prepared.id -or $replacement.electron -eq $ExpectedPid -or [IO.Path]::GetFullPath($replacement.profile) -ne [IO.Path]::GetFullPath($profileDirectory)){throw 'Replacement preview identity could not be verified.'}
Write-Output ('Preview refresh: '+$ExpectedPid+' -> '+$replacement.electron+'; build '+$replacement.build+'; existing profile retained.')
