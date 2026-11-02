# Release gate, check 1: a packaged build opens, stays open past the splash's 20 s timeout, and closes when asked.
# 31 Oct (r22): every source test passed, yet the installed app never opened: no window, the splash couldn't be closed, and it quit at 20 s.
# Runs the exe the way a user does: a throwaway ACIRA_BROWSER_TEST_DATA profile and NO logging flags. With --enable-logging and redirected output
# the window title reads as the exe path, so a title check there proves nothing. Prints one JSON line; exit 0 only when every requirement holds.
#   powershell -NoProfile -File qa/release-alive.ps1 -Exe <win-unpacked\AciraBrowser.exe> -Profile <empty folder> [-Seconds 28]
param([Parameter(Mandatory = $true)][string]$Exe, [Parameter(Mandatory = $true)][string]$Profile, [int]$Seconds = 28)
$Exe = (Resolve-Path -LiteralPath $Exe).Path
New-Item -ItemType Directory -Force $Profile | Out-Null
$env:ACIRA_QA_RUN = '1'; $env:ACIRA_BROWSER_TEST_DATA = $Profile
Remove-Item Env:ELECTRON_ENABLE_LOGGING, Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
# The app's processes are found by exact exe path, never by image name: the founder's own installed Acira has another path and must stay untouched.
function Get-Owned { @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe }) }
$result = [ordered]@{ ok = $false; processes = 0; title = $null; responding = $null; closed = $false; reason = $null }
$null = Start-Process -FilePath $Exe -WorkingDirectory (Split-Path $Exe)
# The body runs in its own scriptblock so each early `return` ends only the checks, never the script before the cleanup and the verdict below.
try { & {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $early = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    # The app may relaunch itself once on a first profile, so liveness is "some owned process exists", sampled for the whole window.
    if ((Get-Owned).Count -eq 0 -and $null -eq $early) { $early = [math]::Round(($Seconds - ($deadline - (Get-Date)).TotalSeconds), 1) }
    elseif ((Get-Owned).Count -gt 0) { $early = $null }
  }
  $owned = Get-Owned
  $result.processes = $owned.Count
  if ($owned.Count -eq 0) { $result.reason = if ($null -ne $early) { "no process left after $early s (the app quit on its own)" } else { 'no process alive' }; return }
  $windows = @($owned | Where-Object { $_.MainWindowHandle -ne 0 })
  $main = $windows | Where-Object { $_.MainWindowTitle -eq 'Acira' } | Select-Object -First 1
  if (-not $main) { $result.reason = "no window titled exactly 'Acira' after $Seconds s (window titles: " + (($windows | ForEach-Object { "'" + $_.MainWindowTitle + "'" }) -join ', ') + ')'; return }
  $result.title = $main.MainWindowTitle; $result.responding = [bool]$main.Responding
  if (-not $main.Responding) { $result.reason = 'main window is not responding'; return }
  [void]$main.CloseMainWindow()
  $end = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $end -and (Get-Owned).Count -gt 0) { Start-Sleep -Milliseconds 300 }
  $result.closed = ((Get-Owned).Count -eq 0)
  if (-not $result.closed) { $result.reason = 'processes still running 15 s after CloseMainWindow'; return }
  $result.ok = $true
} }
finally {
  # Anything left is ours (exact path) and is stopped by id.
  foreach ($p in (Get-Owned)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  $result | ConvertTo-Json -Compress
}
if ($result.ok) { exit 0 } else { exit 1 }
