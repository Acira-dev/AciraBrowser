# Sample one browser's whole process tree: CPU time, private memory, process count; optionally GPU engine utilization.
#   powershell -NoProfile -File qa/proc-sample.ps1 -RootPid 1234 [-Gpu 10]
# Prints one JSON line. Only reads; never touches a process.
param([int]$RootPid, [int]$Gpu = 0)
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine, UserModeTime, KernelModeTime
$cpuSnapshotEpochMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$children = @{}
foreach ($p in $all) { if (-not $children.ContainsKey([int]$p.ParentProcessId)) { $children[[int]$p.ParentProcessId] = @() }; $children[[int]$p.ParentProcessId] += $p }
$tree = New-Object System.Collections.Generic.List[object]
$queue = New-Object System.Collections.Generic.Queue[int]; $queue.Enqueue($RootPid)
$seen = @{}
while ($queue.Count) { $id = $queue.Dequeue(); if ($seen.ContainsKey($id)) { continue }; $seen[$id] = $true; $self = $all | Where-Object { $_.ProcessId -eq $id } | Select-Object -First 1; if ($self) { $tree.Add($self) }; foreach ($c in $children[$id]) { $queue.Enqueue([int]$c.ProcessId) } }
$ids = @($tree | ForEach-Object { [int]$_.ProcessId })
$perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids -contains [int]$_.IDProcess }
$types = @{}; $procs = @()
foreach ($p in $tree) { $t = 'browser'; if ($p.CommandLine -match '--type=([a-z-]+)') { $t = $Matches[1]; if ($t -eq 'utility' -and $p.CommandLine -match '--utility-sub-type=([A-Za-z0-9_.]+)') { $t = 'utility:' + ($Matches[1] -replace '^.*\.', '') } }; $mem = ($perf | Where-Object { [int]$_.IDProcess -eq [int]$p.ProcessId } | Select-Object -First 1).WorkingSetPrivate; $procs += [ordered]@{ pid = [int]$p.ProcessId; type = $t; name = $p.Name; cmd = $(if ($t -eq 'browser' -and $p.CommandLine) { $p.CommandLine.Substring(0, [Math]::Min(160, $p.CommandLine.Length)) } else { $null }); cpu = [Math]::Round(([double]$p.UserModeTime + [double]$p.KernelModeTime) / 1e7, 3); mb = [Math]::Round([double]$mem / 1MB, 1) }; if (-not $types.ContainsKey($t)) { $types[$t] = @{ n = 0; mb = 0.0 } }; $types[$t].n++; $types[$t].mb += [double]$mem / 1MB }
$cpuTicks = 0.0; foreach ($p in $tree) { $cpuTicks += [double]$p.UserModeTime + [double]$p.KernelModeTime }
$mb = 0.0; foreach ($p in $perf) { $mb += [double]$p.WorkingSetPrivate / 1MB }
$gpuAvg = $null; $gpuMax = $null
if ($Gpu -gt 0) {
  $samples = Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples $Gpu -ErrorAction SilentlyContinue
  $totals = @(); foreach ($s in $samples) { $sum = 0.0; foreach ($c in $s.CounterSamples) { if ($c.InstanceName -match '^pid_(\d+)_' -and $ids -contains [int]$Matches[1]) { $sum += $c.CookedValue } }; $totals += $sum }
  if ($totals.Count) { $gpuAvg = [Math]::Round(($totals | Measure-Object -Average).Average, 2); $gpuMax = [Math]::Round(($totals | Measure-Object -Maximum).Maximum, 2) }
}
$out = [ordered]@{ pids = $ids.Count; cpuSnapshotEpochMs = $cpuSnapshotEpochMs; cpuSeconds = [Math]::Round($cpuTicks / 1e7, 3); privateMB = [Math]::Round($mb, 1); gpuAvgPct = $gpuAvg; gpuMaxPct = $gpuMax; types = $types; procs = $procs }
$out | ConvertTo-Json -Compress -Depth 4
