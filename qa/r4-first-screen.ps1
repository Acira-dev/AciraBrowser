# R4-01 on real pixels: on a first run, setup is the first thing on screen (no browser chrome, page or empty window first).
# Launches the INSTALLED (or any) exe on a brand-new disposable profile WITHOUT ACIRA_BROWSER_TEST_HIDDEN (so the window really shows),
# watches every visible top-level window of that exe at ~10 ms, and photographs the screen where the first sizeable window appears
# (+0, +150, +400, +1000, +2500 ms), plus the window itself through PrintWindow. Look at the PNGs: the very first one must already be setup.
#   node qa\native-slot.mjs r4-first-screen -- powershell -NoProfile -File qa\r4-first-screen.ps1 -Exe C:\ae\inst-r4\AciraBrowser.exe -Out qa\artifacts\r4-final\first-screen
# -WindowOnly: every frame comes from the window's own handle (PrintWindow, full content), never from the screen. Use it when someone
# else is using the machine (a screen region can hold their windows) or when Windows refuses screen copies ("Exception calling Screen").
param(
  [Parameter(Mandatory=$true)][string]$Exe,
  [Parameter(Mandatory=$true)][string]$Out,
  [string]$Work = 'C:\ae\r4\first-screen',
  [int]$TimeoutSeconds = 40,
  [switch]$WindowOnly
)
$ErrorActionPreference = 'Stop'
$Exe = [IO.Path]::GetFullPath($Exe); $Out = [IO.Path]::GetFullPath($Out)
$dir = Split-Path -Parent $Exe
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$root = Join-Path $Work ('p-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $root, (Join-Path $root 'roaming'), (Join-Path $root 'local') | Out-Null

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Collections.Generic; using System.Diagnostics; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices; using System.Text;
public static class FirstScreen {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder s, ref int n);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  static readonly Dictionary<uint,string> paths = new Dictionary<uint,string>();
  static string PathOf(uint pid) {
    string p; if (paths.TryGetValue(pid, out p)) return p;
    p = "";
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h != IntPtr.Zero) { var sb = new StringBuilder(1024); int n = sb.Capacity; if (QueryFullProcessImageName(h, 0, sb, ref n)) p = sb.ToString(); CloseHandle(h); }
    paths[pid] = p; return p;
  }
  public class Win { public long Handle; public int W, H, X, Y; public string Cls, Title; public string Seen; }
  /// Visible top-level windows whose process image sits under `dir`.
  public static List<Win> Visible(string dir) {
    SetProcessDPIAware();
    var list = new List<Win>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string p = PathOf(pid); if (p.Length == 0 || !p.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) return true;
      RECT r; GetWindowRect(h, out r);
      var c = new StringBuilder(256); GetClassName(h, c, 256); var t = new StringBuilder(256); GetWindowText(h, t, 256);
      list.Add(new Win { Handle = h.ToInt64(), X = r.L, Y = r.T, W = r.R - r.L, H = r.B - r.T, Cls = c.ToString(), Title = t.ToString() });
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static void Screen(int x, int y, int w, int h, string file) {
    using (var bmp = new Bitmap(w, h)) { using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(x, y, 0, 0, new Size(w, h)); bmp.Save(file, ImageFormat.Png); }
  }
  public static bool Print(long handle, int w, int h, string file) {
    using (var bmp = new Bitmap(w, h)) { bool ok; using (var g = Graphics.FromImage(bmp)) { IntPtr dc = g.GetHdc(); try { ok = PrintWindow(new IntPtr(handle), dc, 2); } finally { g.ReleaseHdc(dc); } } if (ok) bmp.Save(file, ImageFormat.Png); return ok; }
  }
}
'@

$env:ACIRA_QA_RUN = '1'; $env:ACIRA_BROWSER_TEST_DATA = $root; $env:APPDATA = Join-Path $root 'roaming'; $env:LOCALAPPDATA = Join-Path $root 'local'
$env:ACIRA_PASSWORDS_TEST_GATE = 'allow'; $env:ACIRA_PREVIEW_RECORD = '1'
Remove-Item Env:\ACIRA_BROWSER_TEST_HIDDEN, Env:\ELECTRON_RUN_AS_NODE, Env:\ACIRA_DEV -ErrorAction SilentlyContinue
$report = [ordered]@{ exe=$Exe; profile=$root; hiddenFlag=$false; firstRun=$true; events=@(); shots=@() }
$clock = [Diagnostics.Stopwatch]::StartNew()
# A window behind someone else's keeps painting under -WindowOnly (Chromium otherwise stops drawing an occluded window).
$launchArgs = @('--acira-qa-owner=r4-first-screen'); if ($WindowOnly) { $launchArgs += @('--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding') }
$proc = Start-Process -FilePath $Exe -ArgumentList $launchArgs -PassThru
$seen = @{}; $sizeable = $null
try {
  while ($clock.Elapsed.TotalSeconds -lt $TimeoutSeconds -and -not $sizeable) {
    foreach ($w in [FirstScreen]::Visible($dir)) {
      $key = [string]$w.Handle
      if (-not $seen.ContainsKey($key)) {
        $seen[$key] = $true
        $report.events += [ordered]@{ ms=[int]$clock.ElapsedMilliseconds; event='window visible'; cls=$w.Cls; title=$w.Title; w=$w.W; h=$w.H; x=$w.X; y=$w.Y }
      }
      if ($w.W -ge 600 -and $w.H -ge 400 -and -not $sizeable) { $sizeable = $w; break }
    }
    Start-Sleep -Milliseconds 8
  }
  if ($sizeable) {
    $t0 = $clock.ElapsedMilliseconds
    # PrintWindow returns the frame only (Chromium draws through DirectComposition), so -WindowOnly also records the window's real
    # composited pixels through Windows Graphics Capture on its handle (ffmpeg gfxcapture: occlusion-proof, never the screen), 30 fps for 6 s.
    if ($WindowOnly) {
      $ffArgs = @('-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', ('gfxcapture=hwnd={0}:capture_cursor=0:max_framerate=30' -f $sizeable.Handle), '-vf', 'hwdownload,format=bgra', '-t', '6', (Join-Path $Out 'wgc-%03d.png'))
      $wgc = Start-Process -FilePath 'ffmpeg' -ArgumentList $ffArgs -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $Out 'wgc-ffmpeg.log')
      $report.wgcStartedMs = [int]$clock.ElapsedMilliseconds
    }
    foreach ($offset in @(0, 150, 400, 1000, 2500)) {
      while (($clock.ElapsedMilliseconds - $t0) -lt $offset) { Start-Sleep -Milliseconds 5 }
      $now = [int]$clock.ElapsedMilliseconds
      $name = 'screen-plus{0:0000}ms.png' -f $offset
      $cur = @([FirstScreen]::Visible($dir) | Where-Object { $_.Handle -eq $sizeable.Handle })
      $w = if ($cur.Count) { $cur[0] } else { $sizeable }
      if ($WindowOnly) { $name = 'window-plus{0:0000}ms.png' -f $offset; $printed = [FirstScreen]::Print($w.Handle, $w.W, $w.H, (Join-Path $Out $name)) }
      else { [FirstScreen]::Screen($w.X, $w.Y, $w.W, $w.H, (Join-Path $Out $name)) }
      $row = [ordered]@{ ms=$now; offsetAfterFirstShow=$offset; file=$name; w=$w.W; h=$w.H }
      if ($WindowOnly) { $row.printWindow = $printed }
      elseif ($offset -eq 0 -or $offset -eq 1000) { $pn = 'window-plus{0:0000}ms.png' -f $offset; $row.printWindow = [FirstScreen]::Print($w.Handle, $w.W, $w.H, (Join-Path $Out $pn)); $row.printFile = $pn }
      $report.shots += $row
    }
    # WGC only delivers a frame when the window changes, and the first-run window can be replaced (secure-startup relaunch), so the
    # recording can stall: stop it, then photograph every sizeable window of the exe by handle at +9 s to show what follows the mark.
    if ($wgc) { if (-not $wgc.WaitForExit(9000)) { Stop-Process -Id $wgc.Id -Force -ErrorAction SilentlyContinue }; $report.wgcFrames = @(Get-ChildItem -LiteralPath $Out -Filter 'wgc-*.png').Count }
    if ($WindowOnly) {
      while (($clock.ElapsedMilliseconds - $t0) -lt 9000) { Start-Sleep -Milliseconds 50 }
      $report.later = @(); $i = 0
      foreach ($lw in @([FirstScreen]::Visible($dir) | Where-Object { $_.W -ge 600 -and $_.H -ge 400 })) {
        $i++; $file = 'later-plus9000ms-{0}.png' -f $i
        $grab = Start-Process -FilePath 'ffmpeg' -ArgumentList @('-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', ('gfxcapture=hwnd={0}:capture_cursor=0:max_framerate=30' -f $lw.Handle), '-vf', 'hwdownload,format=bgra', '-frames:v', '1', (Join-Path $Out $file)) -PassThru -WindowStyle Hidden
        if (-not $grab.WaitForExit(10000)) { Stop-Process -Id $grab.Id -Force -ErrorAction SilentlyContinue }
        $report.later += [ordered]@{ file=$file; handle=$lw.Handle; sameAsFirst=($lw.Handle -eq $sizeable.Handle); w=$lw.W; h=$lw.H; title=$lw.Title; saved=(Test-Path -LiteralPath (Join-Path $Out $file)) }
      }
    }
    $report.firstSizeableWindowMs = [int]$t0
  } else { $report.error = 'no window of at least 600x400 became visible' }
  $report.allWindowsAtEnd = @([FirstScreen]::Visible($dir) | ForEach-Object { [ordered]@{ cls=$_.Cls; title=$_.Title; w=$_.W; h=$_.H } })
  $report.visibleWindowsBeforeFirstSizeable = @($report.events | Where-Object { $_.w -lt 600 -or $_.h -lt 400 }).Count
  $build = Join-Path $root 'preview-build.json'
  if (Test-Path -LiteralPath $build) { try { $report.startupEvents = (Get-Content -LiteralPath $build -Raw | ConvertFrom-Json).events | ForEach-Object { $_.event } } catch {} }
} finally {
  $ErrorActionPreference = 'Continue'   # a taskkill complaint on stderr must not skip the cleanup or the report below
  Get-CimInstance Win32_Process -Filter "Name='$(Split-Path -Leaf $Exe)'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -like '*acira-qa-owner=r4-first-screen*' } | ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F 2>&1 | Out-Null }
  if ($proc -and -not $proc.HasExited) { & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null }
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Out 'first-screen.json') -Encoding UTF8
}
$report | ConvertTo-Json -Depth 6
if ($report.error) { exit 1 }
