# qa/installer-e2e: build the dummy once with  csc /target:winexe /r:System.Windows.Forms.dll /r:System.Drawing.dll /out:C:/ae/r6/polish/handoff/dummy/AciraBrowser.exe qa/installer-e2e/DummyAcira.cs
# Sequence used for R6: fresh install, seeded-profile.mjs seed, corrupt two files + seeded-profile.mjs hold, setup again -Keys Enter,Enter (Repair), verify,
# hold + newer setup -Keys Enter,Enter (Update), verify, older setup -Keys Escape (newer installed), uninstall keeping data.
# Always pass an -InstallRoot under C:/ae (the script refuses anything else): without /D= setup would use the real per-user install folder.
# r6 installer end-to-end: one visible setup run (fresh install, repair, update or "newer installed"), window-handle captures only.
# SAFETY: the installer launches Acira through Explorer at the end (Explorer's environment = the founder's REAL profile). This rig never lets
# the real app start that way: the moment the copy is done (ac-done.flag) it moves the installed AciraBrowser.exe aside and puts a dummy
# (C:\ae\r6\polish\handoff\dummy\AciraBrowser.exe: a dark window, touches no profile) in its place; the real exe is put back after the run.
# A separate guard thread (1 ms) also kills any Explorer-started AciraBrowser.exe from the install folder that is not the dummy.
# Chooser answers come from -Keys (Enter = the primary button, Escape = Cancel). Any stock Yes/No box is answered No.
param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [Parameter(Mandatory=$true)][string]$Root,
  [string]$EnvRoot = '',
  [string]$Keys = '',
  [string]$Dummy = 'C:\ae\r6\polish\handoff\dummy\AciraBrowser.exe',
  [int]$MaxSeconds = 150,
  [int]$DumpMs = 50   # how often the card writes its own composed frame to dump\ (each one is a PNG save: raise it when measuring smoothness)
)
$ErrorActionPreference = 'Stop'
if (-not $InstallRoot.StartsWith('C:\ae\', [StringComparison]::OrdinalIgnoreCase)) { throw 'installs only under C:\ae' }
$frames = Join-Path $Root 'frames'; $dump = Join-Path $Root 'dump'; $temp = Join-Path $Root 'temp'
New-Item -ItemType Directory -Force -Path $frames, $dump, $temp | Out-Null
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.IO; using System.Runtime.InteropServices; using System.Text; using System.Threading;
public static class E2E {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct PE32 { public uint dwSize, cntUsage, th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID, cntThreads, th32ParentProcessID; public int pcPriClassBase; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string szExeFile; }
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint f, uint p);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr h, ref PE32 e);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr h, ref PE32 e);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool i, uint p);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h, uint c);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int f, StringBuilder s, ref int n);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool GetLayeredWindowAttributes(IntPtr h, out uint key, out byte alpha, out uint flags);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr d, int id);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public class P { public uint Pid, Ppid; public string Name; }
  public static List<P> Procs() { var l = new List<P>(); IntPtr s = CreateToolhelp32Snapshot(2, 0); var e = new PE32(); e.dwSize = (uint)Marshal.SizeOf(typeof(PE32)); if (Process32FirstW(s, ref e)) do { l.Add(new P { Pid = e.th32ProcessID, Ppid = e.th32ParentProcessID, Name = e.szExeFile }); } while (Process32NextW(s, ref e)); CloseHandle(s); return l; }
  public static string PathOf(uint pid) { IntPtr h = OpenProcess(0x1000, false, pid); if (h == IntPtr.Zero) return ""; var sb = new StringBuilder(1024); int n = sb.Capacity; string r = QueryFullProcessImageName(h, 0, sb, ref n) ? sb.ToString() : ""; CloseHandle(h); return r; }
  public static bool Kill(uint pid) { IntPtr h = OpenProcess(0x0001, false, pid); if (h == IntPtr.Zero) return false; bool ok = TerminateProcess(h, 1); CloseHandle(h); return ok; }
  public static List<string> Log = new List<string>(); static volatile bool stop; static HashSet<uint> before = new HashSet<uint>();
  public static string AppName = "AciraBrowserQA.exe"; // the QA identity installs AciraBrowserQA.exe; set to AciraBrowser.exe only with ACIRA_QA_REAL_IDENTITY=1
  public static volatile bool Swapped; public static long SwapMs = -1, FirstOnScreenMs = -1, DummyShownMs = -1, HelperGoneMs = -1; public static int Frames, GapSamples; public static long LongestGapMs; public static string Gaps = "";
  static System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
  static void L(string s) { lock (Log) Log.Add(sw.ElapsedMilliseconds + "ms " + s); }
  static bool Ours(string n) { n = n.ToLowerInvariant(); return n == "acirabrowsersetup.exe" || n == "acirabrowserqasetup.exe" || n == "acira-progress.exe" || n == "acira-choose.exe" || n == "un_a.exe" || n == "au_.exe" || n.StartsWith("uninstall acira"); }
  public static void Start(string inst, string temp, string dummy, string frames, string keys) {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
    foreach (var p in Procs()) before.Add(p.Pid); stop = false;
    string exe = Path.Combine(inst, AppName), real = exe + ".real"; long dummyLen = new FileInfo(dummy).Length;
    // 1. guard: an Explorer-started app from the install folder that is not the dummy dies at once
    var guardSeen = new HashSet<uint>();
    var guard = new Thread(() => { while (!stop) { try { foreach (var p in Procs()) { if (before.Contains(p.Pid) || guardSeen.Contains(p.Pid) || !string.Equals(p.Name, AppName, StringComparison.OrdinalIgnoreCase)) continue; string path = PathOf(p.Pid); if (path.Length == 0) continue; guardSeen.Add(p.Pid); if (!path.StartsWith(inst + "\\", StringComparison.OrdinalIgnoreCase)) continue; string parent = PathOf(p.Ppid); bool viaExplorer = parent.EndsWith("\\explorer.exe", StringComparison.OrdinalIgnoreCase); long len = -1; try { len = new FileInfo(path).Length; } catch { } bool dummyNow = Swapped && len == dummyLen; if (viaExplorer && !dummyNow) L("GUARD killed Explorer-started real app pid=" + p.Pid + " -> " + Kill(p.Pid)); else L("GUARD allowed pid=" + p.Pid + " parent=" + parent + (dummyNow ? " (dummy)" : "")); } } catch { } Thread.Sleep(1); } });
    guard.IsBackground = true; guard.Priority = ThreadPriority.Highest; guard.Start();
    // 2. swap the dummy in the moment the copy is done (the launch comes about 2.4 s later)
    var swap = new Thread(() => { while (!stop && !Swapped) { try { foreach (var d in Directory.GetDirectories(temp, "ns*.tmp")) if (File.Exists(Path.Combine(d, "ac-done.flag"))) { if (File.Exists(real)) File.Delete(real); File.Move(exe, real); File.Copy(dummy, exe, true); Swapped = true; SwapMs = sw.ElapsedMilliseconds; L("SWAP dummy in place of " + exe); break; } } catch (Exception e) { L("swap error " + e.Message); } Thread.Sleep(1); } });
    swap.IsBackground = true; swap.Priority = ThreadPriority.Highest; swap.Start();
    // 3. sampler: window states every 5 ms, gaps, chooser keys
    var keyList = new Queue<string>(); foreach (var k in keys.Split(',')) if (k.Trim().Length > 0) keyList.Enqueue(k.Trim());
    var t = new Thread(() => {
      var names = new Dictionary<uint, string>(); var ppids = new Dictionary<uint, uint>(); var last = new Dictionary<long, string>(); long chooserSince = -1, lastKey = -1, gapStart = -1; var dialogs = new HashSet<long>();
      while (!stop) {
        try {
          long ms = sw.ElapsedMilliseconds;
          var fresh = new Dictionary<uint, string>(); foreach (var p in Procs()) { if (before.Contains(p.Pid)) continue; fresh[p.Pid] = p.Name; string was; if ((!names.TryGetValue(p.Pid, out was) || was != p.Name) && (Ours(p.Name) || p.Name.Equals(AppName, StringComparison.OrdinalIgnoreCase))) L("PROC " + p.Name + " pid=" + p.Pid + " ppid=" + p.Ppid); } names = fresh; /* pids are reused: map them afresh every pass */
          var seen = new HashSet<long>(); bool any = false, dummyOn = false, helperOn = false; IntPtr chooser = IntPtr.Zero;
          EnumWindows((h, x) => { uint pid; GetWindowThreadProcessId(h, out pid); string name; if (!names.TryGetValue(pid, out name)) return true;
            bool app = name.Equals(AppName, StringComparison.OrdinalIgnoreCase); if (!Ours(name) && !app) return true;
            bool vis = IsWindowVisible(h); int ex = GetWindowLong(h, -20); byte alpha = 255; uint key, fl; if ((ex & 0x80000) != 0 && GetLayeredWindowAttributes(h, out key, out alpha, out fl) && (fl & 2) == 0) alpha = 255;
            RECT r; GetWindowRect(h, out r); var c = new StringBuilder(128); GetClassName(h, c, 128); var tt = new StringBuilder(128); GetWindowText(h, tt, 128);
            bool big = (r.R - r.L) >= 200 && (r.B - r.T) >= 150, on = vis && alpha > 0 && big; long k2 = h.ToInt64();
            if (on) { seen.Add(k2); any = true; if (name == "acira-progress.exe") helperOn = true; if (app) dummyOn = true; if (name == "acira-choose.exe") chooser = h; }
            string state = (on ? "ON " : vis ? "visible-transparent " : "hidden ") + "alpha=" + alpha + " " + r.L + "," + r.T + " " + (r.R - r.L) + "x" + (r.B - r.T) + " " + c + " '" + tt + "'";
            string prev; if (big && (!last.TryGetValue(k2, out prev) || prev != state)) { last[k2] = state; L("WIN " + name + " h=" + k2 + " " + state); }
            if (on && c.ToString() == "#32770" && GetDlgItem(h, 7) != IntPtr.Zero && !dialogs.Contains(k2)) { dialogs.Add(k2); PostMessage(h, 0x0111, new IntPtr(7), IntPtr.Zero); L("ANSWERED No to stock dialog '" + tt + "'"); }
            return true; }, IntPtr.Zero);
          foreach (var k in new List<long>(last.Keys)) if (!seen.Contains(k) && last[k].StartsWith("ON ")) { last[k] = "gone"; L("WIN h=" + k + " OFF-SCREEN (gone or hidden)"); }
          if (any && FirstOnScreenMs < 0) FirstOnScreenMs = ms;
          if (dummyOn && DummyShownMs < 0) { DummyShownMs = ms; L("DUMMY app window on screen"); }
          if (Swapped && !helperOn && HelperGoneMs < 0 && SwapMs >= 0 && ms - SwapMs > 300) { HelperGoneMs = ms; L("helper card off screen"); }
          // a gap = nothing of ours on screen after the first window and before the app's window
          if (FirstOnScreenMs >= 0 && DummyShownMs < 0 && !any) { if (gapStart < 0) gapStart = ms; GapSamples++; }
          else if (gapStart >= 0) { long g = ms - gapStart; if (g > LongestGapMs) LongestGapMs = g; Gaps += gapStart + "-" + ms + " "; gapStart = -1; }
          if (chooser != IntPtr.Zero) { if (chooserSince < 0) chooserSince = ms; if (keyList.Count > 0 && ms - chooserSince > 1200 && ms - lastKey > 1500) { string key = keyList.Dequeue(); int vk = key == "Escape" ? 0x1B : key == "Tab" ? 0x09 : 0x0D; PostMessage(chooser, 0x100, new IntPtr(vk), IntPtr.Zero); PostMessage(chooser, 0x101, new IntPtr(vk), new IntPtr(unchecked((int)0xC0000001))); lastKey = ms; L("KEY " + key + " to chooser"); } } else chooserSince = -1;
        } catch (Exception e) { L("sampler error " + e.Message); }
        Thread.Sleep(5);
      }
    });
    t.IsBackground = true; t.Start();
    // 4. frames: every on-screen non-layered window of ours, 50 ms apart, by handle (the card itself is layered: its own dump + WGC)
    var cap = new Thread(() => { var names = new Dictionary<uint, string>(); while (!stop) { long ms = sw.ElapsedMilliseconds; try {
      names = new Dictionary<uint, string>(); foreach (var p in Procs()) if (!before.Contains(p.Pid)) names[p.Pid] = p.Name;
      EnumWindows((h, x) => { uint pid; GetWindowThreadProcessId(h, out pid); string name; if (!names.TryGetValue(pid, out name)) return true;
        bool app = name.Equals(AppName, StringComparison.OrdinalIgnoreCase); if (name.Length == 0 || name == "acira-progress.exe" || (!Ours(name) && !app)) return true;
        if (!IsWindowVisible(h)) return true; RECT r; GetWindowRect(h, out r); if ((r.R - r.L) < 200 || (r.B - r.T) < 150) return true; int ex = GetWindowLong(h, -20); byte alpha = 255; uint key, fl; if ((ex & 0x80000) != 0 && GetLayeredWindowAttributes(h, out key, out alpha, out fl) && (fl & 2) != 0 && alpha == 0) return true;
        if (Frames < 900) { string f = Path.Combine(frames, string.Format("{0:000000}ms-{1}.png", ms, System.Text.RegularExpressions.Regex.Replace(name, "[^A-Za-z0-9]", ""))); if (Print(h, r.R - r.L, r.B - r.T, f)) Frames++; }
        return true; }, IntPtr.Zero); } catch { } long wait = 50 - (sw.ElapsedMilliseconds - ms); if (wait > 0) Thread.Sleep((int)wait); } });
    cap.IsBackground = true; cap.Start();
  }
  public static void Stop() { stop = true; }
  public static bool Print(IntPtr h, int w, int hh, string file) { if (w < 2 || hh < 2) return false; using (var b = new Bitmap(w, hh)) { bool ok; using (var g = Graphics.FromImage(b)) { IntPtr dc = g.GetHdc(); try { ok = PrintWindow(h, dc, 2); } finally { g.ReleaseHdc(dc); } } if (ok) b.Save(file, ImageFormat.Png); return ok; } }
  public static bool AnyOurs() { foreach (var p in Procs()) { if (before.Contains(p.Pid)) continue; if (Ours(p.Name)) return true; } return false; }
  public static long HelperHwnd() { long found = 0; foreach (var p in Procs()) { if (p.Name != "acira-progress.exe" || before.Contains(p.Pid)) continue; uint pid = p.Pid; EnumWindows((h, x) => { uint q; GetWindowThreadProcessId(h, out q); if (q == pid && IsWindowVisible(h)) { RECT r; GetWindowRect(h, out r); if (r.R - r.L >= 200) { found = h.ToInt64(); return false; } } return true; }, IntPtr.Zero); } return found; }
  public static List<string> KillDummies(string inst) { var l = new List<string>(); foreach (var p in Procs()) { if (before.Contains(p.Pid)) continue; if (string.Equals(p.Name, AppName, StringComparison.OrdinalIgnoreCase) && PathOf(p.Pid).StartsWith(inst + "\\", StringComparison.OrdinalIgnoreCase) && PathOf(p.Ppid).EndsWith("\\explorer.exe", StringComparison.OrdinalIgnoreCase)) l.Add(p.Pid + " " + Kill(p.Pid)); } return l; }
}
'@
$setupPath = [IO.Path]::GetFullPath($Installer)
# QA identity only (qa/installer-identity.ps1): a real-identity setup would rewrite or remove the installed Acira's uninstall entry,
# registration and Start-menu shortcut. Snapshot them now; anything outside the QA identity that changes fails the run.
. (Join-Path $PSScriptRoot '..\installer-identity.ps1')
Assert-AciraQaInstaller $setupPath
Assert-AciraQaInstall $InstallRoot
$registryBefore = Get-AciraRegistrySnapshot
$report = [ordered]@{ installer=$setupPath; installRoot=$InstallRoot; keys=$Keys; startedLocal=(Get-Date).ToString('HH:mm:ss') }
if ($EnvRoot) { $env:APPDATA = Join-Path $EnvRoot 'fixture-roaming'; $env:LOCALAPPDATA = Join-Path $EnvRoot 'fixture-local'; $env:ACIRA_QA_RUN = '1'; $env:ACIRA_BROWSER_TEST_DATA = $EnvRoot }
else { $env:APPDATA = Join-Path $Root 'roaming'; $env:LOCALAPPDATA = Join-Path $Root 'local'; $env:ACIRA_QA_RUN = '1'; $env:ACIRA_BROWSER_TEST_DATA = Join-Path $Root 'data'; New-Item -ItemType Directory -Force $env:APPDATA, $env:LOCALAPPDATA, $env:ACIRA_BROWSER_TEST_DATA | Out-Null }
$env:TEMP = $temp; $env:TMP = $temp; $env:ACIRA_PROGRESS_DUMP = $dump; $env:ACIRA_PROGRESS_DUMP_MS = [string]$DumpMs
Remove-Item Env:\ACIRA_BROWSER_TEST_HIDDEN, Env:\ELECTRON_RUN_AS_NODE, Env:\ACIRA_DEV -ErrorAction SilentlyContinue
$appName = if (Test-AciraRealIdentityAllowed) { 'AciraBrowser.exe' } else { 'AciraBrowserQA.exe' }; [E2E]::AppName = $appName
[E2E]::Start($InstallRoot, $temp, $Dummy, $frames, $Keys)
$clock = [Diagnostics.Stopwatch]::StartNew(); $wgc = $null
try {
  $proc = Start-Process -FilePath $setupPath -ArgumentList @(('/D=' + $InstallRoot)) -PassThru
  $doneAt = $null
  while ($clock.Elapsed.TotalSeconds -lt $MaxSeconds) {
    Start-Sleep -Milliseconds 100
    if (-not $wgc) { $hh = [E2E]::HelperHwnd(); if ($hh -ne 0) { $wgc = Start-Process -FilePath 'ffmpeg' -ArgumentList @('-hide_banner','-loglevel','error','-y','-f','lavfi','-i',('gfxcapture=hwnd={0}:capture_cursor=0:max_framerate=20' -f $hh),'-vf','hwdownload,format=bgra','-t','30',(Join-Path $frames 'wgc-card-%04d.png')) -PassThru -WindowStyle Hidden; $report.wgcStartMs = $clock.ElapsedMilliseconds } }
    if (-not $doneAt -and $proc.HasExited -and -not [E2E]::AnyOurs()) { $doneAt = $clock.ElapsedMilliseconds }
    if ($doneAt -and ($clock.ElapsedMilliseconds - $doneAt) -gt 2500 -and ([E2E]::DummyShownMs -ge 0 -or -not [E2E]::Swapped)) { break }
  }
  $report.setupExit = if ($proc.HasExited) { $proc.ExitCode } else { 'still running' }; $report.doneMs = $doneAt
} finally {
  $ErrorActionPreference = 'Continue'
  Start-Sleep -Milliseconds 300; [E2E]::Stop(); Start-Sleep -Milliseconds 100
  if ($wgc -and -not $wgc.HasExited) { $wgc.Kill() }
  $report.dummiesClosed = @([E2E]::KillDummies($InstallRoot)); Start-Sleep -Milliseconds 300
  # the real exe back in place
  $exe = Join-Path $InstallRoot $appName; if (Test-Path -LiteralPath "$exe.real") { Remove-Item -LiteralPath $exe -Force -ErrorAction SilentlyContinue; Move-Item -LiteralPath "$exe.real" -Destination $exe; $report.realRestored = $true }
  $report.swapped = [E2E]::Swapped; $report.swapMs = [E2E]::SwapMs; $report.firstOnScreenMs = [E2E]::FirstOnScreenMs; $report.dummyShownMs = [E2E]::DummyShownMs; $report.helperGoneMs = [E2E]::HelperGoneMs
  $report.gapSamples = [E2E]::GapSamples; $report.longestGapMs = [E2E]::LongestGapMs; $report.gaps = [E2E]::Gaps; $report.frames = [E2E]::Frames
  $csv = Join-Path $dump 'frames.csv'
  if (Test-Path $csv) { $rows = @(Get-Content $csv | ForEach-Object { $c = $_.Split(','); [pscustomobject]@{ f=$c[0]; ms=[int]$c[1]; pos=[int]$c[2]; text=[int]$c[3]; phase=$c[4]; alpha=[int]$c[5] } }); $back = 0; for ($i = 1; $i -lt $rows.Count; $i++) { if ($rows[$i].pos -lt $rows[$i-1].pos) { $back++ } }; $report.cardFrames = $rows.Count; $report.cardPosBackwards = $back; $report.cardPhases = (($rows | ForEach-Object { $_.phase }) | Get-Unique) -join '>'; $report.cardTextStates = (($rows | ForEach-Object { $_.text }) | Get-Unique) -join '>'; $report.cardLastAlpha = $rows[-1].alpha }
  $report.log = @([E2E]::Log)
  try { $report.registryChangesQaOnly = @(Assert-AciraRealIdentityUnchanged $registryBefore 'this setup run'); $report.registryOk = $true } catch { $report.registryOk = $false; $report.registryError = $_.Exception.Message }
  $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Root 'report.json') -Encoding UTF8
  if (-not $report.registryOk) { throw $report.registryError }
}
'done exit=' + $report.setupExit + ' swapped=' + $report.swapped + ' firstOn=' + $report.firstOnScreenMs + ' dummy=' + $report.dummyShownMs + ' helperGone=' + $report.helperGoneMs + ' gaps=' + $report.gapSamples + ' longest=' + $report.longestGapMs + 'ms back=' + $report.cardPosBackwards + ' phases=' + $report.cardPhases + ' text=' + $report.cardTextStates
