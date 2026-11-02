# Prints how many ms after -StartMs (epoch ms) the first process whose command line contains -Needle got a visible top-level window.
#   powershell -NoProfile -File qa/window-wait.ps1 -Needle "<unique text>" -StartMs 1700000000000 [-TimeoutSec 60]
param([string]$Needle, [double]$StartMs, [int]$TimeoutSec = 60, [string]$Executable)
$deadline = (Get-Date).AddSeconds($TimeoutSec); $procId = 0
while ((Get-Date) -lt $deadline) {
  # Reacquire after a first-profile native-key bootstrap exits/relaunches.
  if ($procId -and -not (Get-Process -Id $procId -ErrorAction SilentlyContinue)) { $procId = 0 }
  if (-not $procId) {
    $hits = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Needle) -and $_.CommandLine -notmatch '--type=' -and $_.ProcessId -ne $PID -and (-not $Executable -or [string]::Equals($_.ExecutablePath,$Executable,[StringComparison]::OrdinalIgnoreCase)) })
    if ($hits.Count -gt 1) { '{"firstWindowMs":null,"error":"multiple matching browser roots"}'; exit 1 }
    $hit = $hits | Select-Object -First 1
    if ($hit) { $procId = [int]$hit.ProcessId }
  }
  if ($procId) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne 0) { $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); '{"pid":' + $procId + ',"firstWindowMs":' + [int]($now - $StartMs) + '}'; exit 0 }
  }
  Start-Sleep -Milliseconds 25
}
'{"pid":' + $procId + ',"firstWindowMs":null}'
