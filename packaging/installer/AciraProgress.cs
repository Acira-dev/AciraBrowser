// Acira installer scene player. A borderless per-pixel-alpha window that plays A's "Creation" scene over the installer's still
// bitmap (which stays underneath as the fallback if this helper cannot start): frames pre-rendered from the design concept
// (scripts/installer-frames-main.cjs, embedded as resources) are blended at 60 fps, the light grows with progress, the finish
// blooms at 100%, and the 1px line with its glowing tip is drawn on top. It runs on its own thread, so it stays smooth while the
// installer thread is busy extracting. Progress is eased and monotonic. The disk is never touched from the drawing thread (a sampler thread
// measures the install, a frame thread decodes and scales the scene ahead), and the light never stands still while the installer works.
// Build: scripts/build-installer-helper.cjs (csc from the .NET Framework 4, C# 5, no SDK needed).
// Usage: AciraProgress.exe <parentHwnd> <dark|light> <scalePercent> <doneFlagPath> [installDir expectedKilobytes payloadTempFile installerExe]
//        AciraProgress.exe --preview [dark|light]     loops the whole sequence in its own window until it is closed (installs nothing)
// The line follows two real byte counts, polled while the installer works: the payload being unpacked to a temp file (first 60%,
// measured against the installer's own size) and the files written to the install directory (last 40%); eased between samples.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

static class Native {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int W, H; }
  [StructLayout(LayoutKind.Sequential, Pack = 1)] public struct BLEND { public byte Op, Flags, Alpha, Format; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool UpdateLayeredWindow(IntPtr h, IntPtr dst, ref POINT pd, ref SIZE sz, IntPtr src, ref POINT ps, int key, ref BLEND b, int flags);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr o);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr dc, int i);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr h, out uint key, out byte alpha, out uint flags);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h, int flags, System.Text.StringBuilder s, ref int n);
}

// Acira's own first window (the first-run splash or the browser): a visible, uncloaked, opaque top-level window of a process whose
// image is <installDir>\AciraBrowser.exe. The installer card stays up until one is on screen, so the hand-off never shows a gap.
static class AppWindow {
  static readonly Dictionary<uint, string> paths = new Dictionary<uint, string>();
  static string PathOf(uint pid) {
    string p; if (paths.TryGetValue(pid, out p)) return p;
    p = ""; IntPtr h = Native.OpenProcess(0x1000, false, pid);
    if (h != IntPtr.Zero) { var sb = new System.Text.StringBuilder(1024); int n = sb.Capacity; if (Native.QueryFullProcessImageName(h, 0, sb, ref n)) p = sb.ToString(); Native.CloseHandle(h); }
    paths[pid] = p; return p;
  }
  public static bool Shown(string exe) {
    if (string.IsNullOrEmpty(exe)) return false;
    bool found = false;
    Native.EnumWindows((h, l) => {
      if (!Native.IsWindowVisible(h)) return true;
      int cloaked; if (Native.DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      Native.RECT r; if (!Native.GetWindowRect(h, out r) || r.R - r.L < 200 || r.B - r.T < 150) return true;
      if ((Native.GetWindowLong(h, -20) & 0x80000) != 0) { uint key, fl; byte a; if (Native.GetLayeredWindowAttributes(h, out key, out a, out fl) && (fl & 2) != 0 && a == 0) return true; }
      uint pid; Native.GetWindowThreadProcessId(h, out pid);
      if (string.Equals(PathOf(pid), exe, StringComparison.OrdinalIgnoreCase)) { found = true; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}

// The pre-rendered frames: <theme>-<1x|2x>-p00.. (progress) and -b00.. (finish bloom), embedded JPEGs. Each is decoded and scaled to the
// card's exact size on a thread of its own, a few frames ahead of the one on screen, so the drawing thread only ever blends two bitmaps that
// are ready (a decode and a bicubic rescale cost 20-40 ms: done while drawing, every change of frame was a hitch, worst while the
// installer used the CPU). If a frame is not ready yet it is made on the spot, as before.
class Frames {
  readonly string prefix; public readonly int P, B; readonly int w, h;
  readonly Dictionary<string, Bitmap> cache = new Dictionary<string, Bitmap>(); readonly Dictionary<string, long> used = new Dictionary<string, long>(); long stamp;
  readonly object gate = new object(); readonly System.Threading.AutoResetEvent wake = new System.Threading.AutoResetEvent(false); volatile bool stop; bool wantBloom; int wantIndex = -1;
  public Frames(string theme, string scale, int w, int h) {
    this.w = w; this.h = h; prefix = theme + "-" + scale + "-";
    foreach (var n in Assembly.GetExecutingAssembly().GetManifestResourceNames()) { if (n.StartsWith(prefix + "p")) P++; else if (n.StartsWith(prefix + "b")) B++; }
    var t = new System.Threading.Thread(Prefetch); t.IsBackground = true; t.Start();
  }
  public bool Ok { get { return P > 1 && B > 1; } }
  string Key(bool bloom, int i) { return prefix + (bloom ? "b" : "p") + i.ToString("00") + ".jpg"; }
  Bitmap Load(string key) {
    using (var st = Assembly.GetExecutingAssembly().GetManifestResourceStream(key)) using (var img = Image.FromStream(st)) {
      var b = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
      using (var g = Graphics.FromImage(b)) using (var ia = new ImageAttributes()) {
        g.CompositingMode = CompositingMode.SourceCopy; g.PixelOffsetMode = PixelOffsetMode.Half; ia.SetWrapMode(WrapMode.TileFlipXY);
        g.InterpolationMode = (img.Width == w) ? InterpolationMode.NearestNeighbor : InterpolationMode.HighQualityBicubic;
        g.DrawImage(img, new Rectangle(0, 0, w, h), 0, 0, img.Width, img.Height, GraphicsUnit.Pixel, ia);
      }
      return b;
    }
  }
  public Bitmap Get(bool bloom, int i) {
    string key = Key(bloom, i); Bitmap b;
    lock (gate) { if (cache.TryGetValue(key, out b)) { used[key] = ++stamp; return b; } }
    b = Load(key);
    lock (gate) {
      Bitmap other; if (cache.TryGetValue(key, out other)) { b.Dispose(); b = other; } else cache[key] = b;
      used[key] = ++stamp;
      // keep the most recently used only; only this (the drawing) thread trims, and a frame it is about to draw was used a moment ago, so it is never the oldest
      while (cache.Count > 12) { string old = null; long best = long.MaxValue; foreach (var kv in used) if (kv.Value < best) { best = kv.Value; old = kv.Key; } cache[old].Dispose(); cache.Remove(old); used.Remove(old); }
    }
    return b;
  }
  // the frame on screen: the next few (and the first of the bloom when the end is near) are made ready
  public void Want(bool bloom, int i) { lock (gate) { wantBloom = bloom; wantIndex = i; } wake.Set(); }
  void Prefetch() {
    while (!stop) {
      wake.WaitOne(500); if (stop) return;
      bool bloom; int i; lock (gate) { bloom = wantBloom; i = wantIndex; }
      if (i < 0) continue;
      var keys = new List<string>();
      for (int j = i; j < i + 4 && j < (bloom ? B : P); j++) keys.Add(Key(bloom, j));
      if (!bloom && i >= P - 4) for (int j = 0; j < 3 && j < B; j++) keys.Add(Key(true, j));
      foreach (var key in keys) {
        if (stop) return;
        bool have; lock (gate) have = cache.ContainsKey(key); if (have) continue;
        try { var b = Load(key); lock (gate) { if (cache.ContainsKey(key)) b.Dispose(); else { cache[key] = b; used[key] = ++stamp; } } } catch { }
      }
    }
  }
  public void Dispose() { stop = true; wake.Set(); }
}

// The status text, rendered separately from the scene as transparent PNGs at exact screen scales (<theme>-t<percent>-<state>.png),
// so it is always drawn 1:1 and crisp instead of being baked into (and softened by) the JPEG frames. States: 0 Preparing, 1 Copying,
// 2 Adding to Start, 3 Finishing up, 4 ready.

// The installer follows the Windows display language: "" (English), es, fr, de, pt, it, ja or zh (Simplified). ACIRA_INSTALLER_LANG overrides it for tests.
static class Lang {
  [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern ushort GetUserDefaultUILanguage();
  public static string Detect() {
    string o = Environment.GetEnvironmentVariable("ACIRA_INSTALLER_LANG"); if (o != null) return o == "en" ? "" : o;
    int id; try { id = GetUserDefaultUILanguage(); } catch { return ""; }
    switch (id & 0x3ff) { case 0x0a: return "es"; case 0x0c: return "fr"; case 0x07: return "de"; case 0x16: return "pt"; case 0x10: return "it"; case 0x11: return "ja"; case 0x04: return (id == 0x0804 || id == 0x1004) ? "zh" : ""; default: return ""; }
  }
}

class TextLayers {
  readonly string prefix; readonly List<int> pcts = new List<int>();
  readonly Dictionary<string, Bitmap> cache = new Dictionary<string, Bitmap>();
  public TextLayers(string theme) {
    string loc = Lang.Detect();
    foreach (var candidate in loc.Length > 0 ? new[] { theme + "-" + loc + "-t", theme + "-t" } : new[] { theme + "-t" }) {
      prefix = candidate;
      foreach (var n in Assembly.GetExecutingAssembly().GetManifestResourceNames()) {
        if (!n.StartsWith(prefix) || !n.EndsWith("-0.png")) continue;
        int p; if (int.TryParse(n.Substring(prefix.Length, n.Length - prefix.Length - "-0.png".Length), out p)) pcts.Add(p);
      }
      if (pcts.Count > 0) break;
    }
  }
  public int Nearest(double scale) { int best = 100; double d = double.MaxValue; foreach (var p in pcts) { double e = Math.Abs(p - scale * 100); if (e < d) { d = e; best = p; } } return best; }
  public Bitmap Get(int state, int pct) {
    string key = prefix + pct + "-" + state + ".png"; Bitmap b; if (cache.TryGetValue(key, out b)) return b;
    using (var st = Assembly.GetExecutingAssembly().GetManifestResourceStream(key)) { if (st == null) return null; using (var img = Image.FromStream(st)) b = new Bitmap(img); }
    cache[key] = b; return b;
  }
}

// Follows the installer's real work on a thread of its own, so the drawing never waits on the disk: an antivirus scan, a slow drive or a
// folder with thousands of files used to stall every frame (the scene was drawn by the same thread that listed the install folder).
// Two byte counts, as before: the payload being unpacked to a temp file (first 60%, measured against the installer's own size) and the
// files written to the install folder (last 40%). The folder is measured against the lowest it has been since this run began, so a Repair or
// an Update over an installed copy (the folder is already full, or is emptied first and filled again) is no longer read as "all copied" at
// the first sample. Files written in place with the same sizes and times show no new bytes at all: then the share follows the time the
// unpacking takes, and the scene's own clock (Overlay.Tick) keeps the light moving meanwhile.
class ProgressSampler {
  readonly string dir, payload, flag; readonly double expected; readonly DateTime start = DateTime.UtcNow;
  readonly object gate = new object(); double value; volatile bool stop, flagSeen;
  long minBytes = long.MaxValue, lastBytes; DateTime lastScan = DateTime.MinValue, lastFraction = DateTime.MinValue; bool copied; DateTime copiedAt, payloadSeenAt = DateTime.MinValue;
  public ProgressSampler(string dir, string payload, double expected, string flag) {
    this.dir = dir; this.payload = payload; this.expected = expected; this.flag = flag;
    var t = new System.Threading.Thread(Run); t.IsBackground = true; t.Start();
  }
  public double Value { get { lock (gate) return value; } }
  public bool FlagSeen { get { return flagSeen; } }
  public void Stop() { stop = true; }
  void Run() {
    while (!stop) {
      try {
        if (!flagSeen && File.Exists(flag)) flagSeen = true;
        if ((DateTime.UtcNow - lastFraction).TotalMilliseconds >= 120) { lastFraction = DateTime.UtcNow; double v = Fraction(); lock (gate) if (v > value) value = v; }
      } catch { }
      System.Threading.Thread.Sleep(40);
    }
  }

  // NSIS preallocates the temp payload (and the big extracted files), so file sizes jump at once and say nothing about progress.
  // The real write position is the last block that is not all zeros; the data is written front to back, so binary search finds it.
  // -2: the payload is not there (yet, or any more); -1: it is there but cannot be read.
  double Written() {
    try {
      if (!File.Exists(payload)) return -2;
      using (var fs = new FileStream(payload, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
        long len = fs.Length; if (len < 8192) return 0;
        var buf = new byte[4096]; long lo = 0, hi = len / 4096;
        while (lo < hi) {
          long mid = (lo + hi + 1) / 2; fs.Seek((mid - 1) * 4096, SeekOrigin.Begin); int n = fs.Read(buf, 0, buf.Length);
          bool zero = true; for (int i = 0; i < n; i++) if (buf[i] != 0) { zero = false; break; }
          if (zero) hi = mid - 1; else lo = mid;
        }
        return Math.Min(1.0, lo * 4096.0 / len);
      }
    } catch { return -1; }
  }

  long Scan() {
    if ((DateTime.UtcNow - lastScan).TotalMilliseconds < 150) return lastBytes;
    lastScan = DateTime.UtcNow;
    try {
      if (!Directory.Exists(dir)) return lastBytes = 0;
      long t = 0; foreach (var f in new DirectoryInfo(dir).GetFiles("*", SearchOption.AllDirectories)) { try { t += f.Length; } catch { } }
      return lastBytes = t;
    } catch { return lastBytes; } // the folder is being emptied or filled under the listing: the last good count stands
  }

  double Fraction() {
    var now = DateTime.UtcNow; double ms = (now - start).TotalMilliseconds, creep = 0.03 * (1 - Math.Exp(-ms / 2000.0));
    long bytes = Scan(); if (bytes < minBytes) minBytes = bytes;
    // what this run has put into the folder, once the folder has been seen (nearly) empty; before that, or when it is written over in place, nothing can be seen
    bool observable = minBytes <= 0.5 * expected;
    double seen = observable ? Math.Min(1.0, (bytes - minBytes) / Math.Max(1.0, expected - minBytes)) : 0;
    if (payload == null) return Math.Max(creep, seen);
    double w = Written();
    if (w != -2 && payloadSeenAt == DateTime.MinValue) payloadSeenAt = now;
    // copied out of the installer: the payload is whole, or gone again (unpacked), or cannot be read but files are appearing / it has been there a while
    if (!copied && (w >= 0.999 || (w == -2 && payloadSeenAt != DateTime.MinValue) || (w == -1 && (seen > 0.02 || (now - payloadSeenAt).TotalMilliseconds > 3000)))) { copied = true; copiedAt = now; }
    // before the payload exists (the installer is still checking for a running Acira or removing the old version) an eased curve that waits below the extraction share
    if (!copied) return Math.Max(Math.Max(creep, 0.6 * Math.Max(0, w)), 0.57 * (1 - Math.Exp(-ms / 3500.0)));
    double since = (now - copiedAt).TotalMilliseconds;
    double extract = Math.Max(seen, 0.9 * (1 - Math.Exp(-since / (observable ? 2500.0 : 7000.0))));
    return 0.6 + 0.4 * extract;
  }
}

class Overlay : Form {
  const int BLOOM_MS = 2200, PREVIEW_HOLD_MS = 700, PREVIEW_FADE_MS = 350, TEXT_FADE_MS = 160;
  // After the bloom the finished picture ("Acira is ready") holds until Acira's own window is on screen, then fades out; never longer
  // than HOLD_CAP_MS (the app may fail to start). The installer itself exits as soon as it has launched the app: from the done flag on,
  // this window no longer follows it.
  const int HOLD_CAP_MS = 6000, FADE_OUT_MS = 180;
  DateTime? holdAt, fadeAt; readonly string appExe; double alpha = 1;
  readonly IntPtr parent; readonly bool dark, preview; double scale; readonly string flag;
  int trackX, trackY, trackW, trackH, width, height, radius; Rectangle closeRect;
  readonly DateTime start = DateTime.UtcNow; readonly string dir, payload; readonly double expected, payloadTotal; double pos, real;
  DateTime? doneAt, bloomAt, satAt; Timer timer = new Timer(); ProgressSampler sampler; double art; int tickFailures;
  DateTime lastTick = DateTime.UtcNow, lastPlace = DateTime.MinValue, appChecked = DateTime.MinValue; bool appUp;
  Frames frames; readonly TextLayers texts; Bitmap canvas, glow; float[] cover; bool hoverClose;
  int curState = -1, prevState = -1; DateTime switchAt = DateTime.UtcNow;

  public Overlay(IntPtr parent, bool dark, double scale, string flag, string dir, double expected, string payload, double payloadTotal, bool preview) {
    this.dir = dir; this.expected = expected; this.payload = payload; this.payloadTotal = payloadTotal; this.preview = preview;
    this.parent = parent; this.dark = dark; this.flag = flag;
    try { appExe = dir != null ? Path.Combine(dir, File.Exists(Path.Combine(dir, "AciraBrowserQA.exe")) ? "AciraBrowserQA.exe" : "AciraBrowser.exe") : null; } catch { appExe = null; }
    texts = new TextLayers(dark ? "dark" : "light");
    AutoScaleMode = AutoScaleMode.None; // never let WinForms rescale: the window is exactly the size of the card in device pixels
    ApplyScale(scale);
    FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual; KeyPreview = true;
    if (preview) { Text = "Acira Browser Setup"; ShowInTaskbar = true; } else { ShowInTaskbar = false; TopMost = true; }
    timer.Interval = 15; timer.Tick += (s, e) => { try { Tick(); tickFailures = 0; } catch (Exception ex) { LogError(ex); if (++tickFailures > 100) { timer.Stop(); Close(); } } }; Shown += (s, e) => { try { if (preview) { var a = Screen.PrimaryScreen.WorkingArea; Location = new Point(a.Left + (a.Width - width) / 2, a.Top + (a.Height - height) / 2); } else Place(); Draw(); if (!preview && dir != null && expected > 0) sampler = new ProgressSampler(dir, payload, expected, flag); timer.Start(); } catch { Close(); } };
  }
  // Everything that depends on the screen scale; called again if the card changes size (another monitor, a DPI change).
  void ApplyScale(double s) {
    scale = s;
    width = (int)Math.Round(560 * s); height = (int)Math.Round(340 * s); radius = (int)Math.Round(8 * s);
    trackX = (int)Math.Round(28 * s); trackY = (int)Math.Round(314 * s); trackW = (int)Math.Round(504 * s); trackH = Math.Max(1, (int)Math.Round(s));
    closeRect = new Rectangle((int)Math.Round(522 * s), (int)Math.Round(10 * s), (int)Math.Round(28 * s), (int)Math.Round(28 * s));
    if (frames != null) frames.Dispose();
    frames = new Frames(dark ? "dark" : "light", s <= 1.01 ? "1x" : "2x", width, height);
    if (canvas != null) canvas.Dispose(); if (glow != null) glow.Dispose();
    canvas = new Bitmap(width, height, PixelFormat.Format32bppPArgb); glow = MakeGlow(); cover = MakeCorner();
    Size = new Size(width, height);
  }
  public bool FramesOk { get { return frames.Ok; } }
  protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= preview ? 0x80000 : (0x80000 | 0x20 | 0x80 | 0x8000000); return p; } }
  protected override bool ShowWithoutActivation { get { return !preview; } }

  // The card is exactly as large as the installer's own window: scale and frame set follow its real size (so a DPI-virtualised or
  // moved window can never leave this one larger or smaller than the card, whatever the system or monitor DPI is).
  void Place() {
    Native.RECT r; if (!Native.GetWindowRect(parent, out r)) return;
    double ps = (r.R - r.L) / 560.0; if (ps > 0.5 && ps < 6 && Math.Abs(ps - scale) > 0.004) ApplyScale(ps);
    Location = new Point(r.L, r.T); Native.SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0040); }

  // preview: drag by the background, close with the x, Esc or Alt+F4
  protected override void WndProc(ref Message m) {
    if (preview && m.Msg == 0x84) { var p = PointToClient(new Point((short)(m.LParam.ToInt64() & 0xFFFF), (short)((m.LParam.ToInt64() >> 16) & 0xFFFF))); m.Result = (IntPtr)(closeRect.Contains(p) ? 1 : 2); return; }
    base.WndProc(ref m);
  }
  protected override void OnMouseMove(MouseEventArgs e) { base.OnMouseMove(e); if (preview) hoverClose = closeRect.Contains(e.Location); }
  protected override void OnMouseUp(MouseEventArgs e) { base.OnMouseUp(e); if (preview && e.Button == MouseButtons.Left && closeRect.Contains(e.Location)) Close(); }
  protected override void OnKeyDown(KeyEventArgs e) { base.OnKeyDown(e); if (preview && e.KeyCode == Keys.Escape) Close(); }

  // mix: 0..1 blend of frame b over frame a
  Bitmap fa, fb; double mix;
  void PickFrames() {
    fb = null; mix = 0; int P = frames.P, B = frames.B;
    if (bloomAt != null || (preview && phase >= progressMs)) {
      double bt = preview ? Math.Min(BLOOM_MS, phase - progressMs) : (DateTime.UtcNow - bloomAt.Value).TotalMilliseconds, f = Math.Min(1.0, Math.Max(0, bt) / BLOOM_MS) * (B - 1);
      int i = Math.Min(B - 1, (int)Math.Floor(f)); fa = frames.Get(true, i); frames.Want(true, i); mix = f - i; if (i + 1 < B && mix > 0.01) fb = frames.Get(true, i + 1); else mix = 0;
      if (preview && phase >= progressMs + BLOOM_MS + PREVIEW_HOLD_MS) { fa = frames.Get(true, B - 1); fb = frames.Get(false, 0); mix = Math.Min(1.0, (phase - (progressMs + BLOOM_MS + PREVIEW_HOLD_MS)) / (double)PREVIEW_FADE_MS); }
      return;
    }
    double fp = Math.Min(1.0, Math.Max(0, (preview ? pos : art) / 1000.0)) * (P - 1); int k = Math.Min(P - 1, (int)Math.Floor(fp)); fa = frames.Get(false, k); frames.Want(false, k); mix = fp - k;
    if (k + 1 < P && mix > 0.01) fb = frames.Get(false, k + 1); else mix = 0;
  }
  // which status text is shown (thresholds as in the concept: .08, .58, .86); 4 = "Acira is ready" for the finish
  int TextState() {
    if (preview) { if (phase >= progressMs + BLOOM_MS + PREVIEW_HOLD_MS) return 0; if (phase >= progressMs) return 4; }
    else if (bloomAt != null) return 4;
    double p = Math.Min(1.0, Math.Max(0, pos / 1000.0)); return p >= .86 ? 3 : p >= .58 ? 2 : p >= .08 ? 1 : 0;
  }
  // the text layer for one state, drawn 1:1 at the nearest rendered scale (scaled only when the screen scale is not one of them)
  void DrawText(Graphics g, int state, double alpha) {
    if (state < 0 || alpha < 0.01) return;
    int pct = texts.Nearest(scale); var layer = texts.Get(state, pct); if (layer == null) return;
    int y0 = (int)Math.Round(220 * scale), hh = (int)Math.Round(100 * scale);
    g.InterpolationMode = (layer.Width == width) ? InterpolationMode.NearestNeighbor : InterpolationMode.HighQualityBicubic;
    using (var ia = new ImageAttributes()) { var cm = new ColorMatrix(); cm.Matrix33 = (float)alpha; ia.SetColorMatrix(cm); ia.SetWrapMode(WrapMode.TileFlipXY);
      g.DrawImage(layer, new Rectangle(0, y0, width, hh), 0, 0, layer.Width, layer.Height, GraphicsUnit.Pixel, ia); }
  }

  double phase;
  // --demo <seconds>: one pass through the production sequence (progress paced over the given time, finish, then the same hand-off: the window closes and the app is launched); closing early cancels.
  int progressMs = 9000; public int DemoMs; public string DemoCmd; public bool DemoDone;
  void Tick() {
    if (preview && DemoMs > 0) {
      progressMs = DemoMs; phase = (DateTime.UtcNow - start).TotalMilliseconds;
      double x = Math.Min(1.0, phase / progressMs); x = Math.Min(1.0, x + .035 * Math.Sin(x * Math.PI * 3) * (1 - x)); pos = phase >= progressMs ? 1000 : x * 1000;
      if (phase >= progressMs + BLOOM_MS + 400) { DemoDone = true; timer.Stop(); Close(); return; }
      Draw(); return;
    }
    if (preview) {
      double cycle = progressMs + BLOOM_MS + PREVIEW_HOLD_MS + PREVIEW_FADE_MS; phase = (DateTime.UtcNow - start).TotalMilliseconds % cycle;
      double x = Math.Min(1.0, phase / progressMs); x = Math.Min(1.0, x + .035 * Math.Sin(x * Math.PI * 3) * (1 - x)); pos = phase >= progressMs ? 1000 : x * 1000;
      if (phase >= progressMs + BLOOM_MS + PREVIEW_HOLD_MS) pos = 0;
      Draw(); return;
    }
    var now = DateTime.UtcNow; double dt = Math.Min(0.25, Math.Max(0.001, (now - lastTick).TotalSeconds)); lastTick = now;
    if (doneAt == null && (sampler != null ? sampler.FlagSeen : File.Exists(flag))) doneAt = now;
    // Before the copy is done, the card lives with the installer (closed or cancelled: gone). After it, the installer launches the app
    // and exits while this window finishes on its own.
    // (the card goes when the installer's window does; the long cap is only for a window left behind, never a reason to let a slow install fall back to the still picture)
    if (doneAt == null && (!Native.IsWindow(parent) || (now - start).TotalSeconds > 1800)) { Close(); return; }
    if (doneAt != null && (now - doneAt.Value).TotalMilliseconds > 30000) { Close(); return; }
    double ms = (now - start).TotalMilliseconds;
    double target = 920.0 * ms / (ms + 3000.0);
    // the disk is read by the sampler's own thread; here its measurement is only picked up and eased
    if (sampler != null) {
      real = Math.Max(real, Math.Min(0.96, sampler.Value) * 1000.0);
      target = Math.Min(real, pos + (660.0 + (real - pos) * 3.6) * dt);
    }
    // The scene never stands still while the installer works: a copy that shows no new bytes (a Repair over the same files, an antivirus holding a
    // file, a slow disk) still moves the light on, quickly at first and ever more slowly, and never past 96% until the installer says it is done.
    if (doneAt == null && pos < 960) target = Math.Max(target, pos + (60.0 * Math.Exp(-ms / 20000.0) + 4.0) * Math.Min(1.0, (960.0 - pos) / 120.0) * dt);
    if (doneAt != null) {
      target = Math.Max(pos, target);
      target = Math.Min(1000, Math.Max(target, pos + 850.0 * dt));
      if (pos >= 1000 && art >= 1000 && bloomAt == null) bloomAt = now;
      if (bloomAt != null && (now - bloomAt.Value).TotalMilliseconds >= BLOOM_MS) {
        if (holdAt == null) holdAt = now;
        if (fadeAt == null && (AppUp() || (now - holdAt.Value).TotalMilliseconds > HOLD_CAP_MS)) fadeAt = now;
      }
      if (fadeAt != null) {
        double f = (now - fadeAt.Value).TotalMilliseconds / FADE_OUT_MS;
        if (f >= 1) { Close(); return; }
        alpha = 1 - f * f; // ease-in: the card lets go quickly once Acira is there
      }
    }
    if (target > pos) pos = Math.Min(1000, target); // never backwards
    // The light is what the progress has shown so far. If the installer is still busy when the bar is nearly full (a very slow copy), the light
    // breathes between 81% and 95% (one breath in 30 s) instead of standing still; at the end it takes the finish from wherever it is.
    double want = pos;
    if (doneAt == null && pos >= 935) { if (satAt == null) satAt = now; want = 880 + 70 * Math.Cos((now - satAt.Value).TotalSeconds * 2 * Math.PI / 30.0); } else satAt = null;
    art = doneAt != null ? art + Math.Max(-900 * dt, Math.Min(900 * dt, want - art)) : want;
    if ((now - lastPlace).TotalMilliseconds >= 50 && Native.IsWindow(parent)) { lastPlace = now; Place(); }
    Draw();
  }
  // Acira's own window is looked for a few times a second, not on every frame
  bool AppUp() { var t = DateTime.UtcNow; if ((t - appChecked).TotalMilliseconds >= 100) { appChecked = t; appUp = AppWindow.Shown(appExe); } return appUp; }

  // Soft glowing tip, 84 x 15 at 100%: a radial falloff centred on the end of the line, long behind it and a short rounded taper ahead of it (never cut flat). Light theme: tinted with the mark's blue
  // (dark ink on a light ground reads as a smudge); dark theme: white light. Straight alpha, blended properly by DrawImage.
  Bitmap MakeGlow() {
    int tail = (int)Math.Round(70 * scale), ahead = (int)Math.Round(14 * scale), tw = tail + ahead, th = (int)Math.Max(5, Math.Round(15 * scale)); if (((th - trackH) & 1) != 0) th++; // same parity as the track, so the glow centre is exactly the track centre
    var b = new Bitmap(tw, th, PixelFormat.Format32bppArgb);
    Color c = dark ? Color.FromArgb(237, 237, 239) : Color.FromArgb(87, 139, 251);
    for (int y = 0; y < th; y++) for (int x = 0; x < tw; x++) {
      double cxp = tail - 1, dx = x <= cxp ? (x - cxp) / (double)tail : (x - cxp) / (double)ahead, dy = (y - (th - 1) / 2.0) / ((th - 1) / 2.0), d = Math.Sqrt(dx * dx + dy * dy);
      if (d < 0.72) b.SetPixel(x, y, Color.FromArgb((int)Math.Round(Math.Min(1.0, Math.Pow(1 - d / 0.72, 1.3) * (dark ? 0.7 : 0.5)) * 255), c));
    }
    return b;
  }

  // anti-aliased coverage of one rounded corner (top-left quadrant, radius x radius)
  float[] MakeCorner() {
    var c = new float[radius * radius];
    for (int y = 0; y < radius; y++) for (int x = 0; x < radius; x++) { double d = Math.Sqrt((radius - x - .5) * (radius - x - .5) + (radius - y - .5) * (radius - y - .5)); c[y * radius + x] = (float)Math.Max(0, Math.Min(1, radius - d + .5)); }
    return c;
  }

  void Round() {
    var r = new Rectangle(0, 0, width, height); var d = canvas.LockBits(r, ImageLockMode.ReadWrite, PixelFormat.Format32bppPArgb);
    try {
      int stride = d.Stride; var row = new byte[stride];
      for (int y = 0; y < radius; y++) foreach (int yy in new[] { y, height - 1 - y }) {
        Marshal.Copy(IntPtr.Add(d.Scan0, yy * stride), row, 0, stride);
        for (int x = 0; x < radius; x++) { float k = cover[y * radius + x]; foreach (int xx in new[] { x, width - 1 - x }) for (int ch = 0; ch < 4; ch++) row[xx * 4 + ch] = (byte)Math.Round(row[xx * 4 + ch] * k); }
        Marshal.Copy(row, 0, IntPtr.Add(d.Scan0, yy * stride), stride);
      }
    } finally { canvas.UnlockBits(d); }
  }

  // test only: ACIRA_PROGRESS_DUMP=<dir> writes the composed window to PNGs (every ACIRA_PROGRESS_DUMP_MS, default 500), so no screen capture is needed
  readonly string dumpDir = Environment.GetEnvironmentVariable("ACIRA_PROGRESS_DUMP"); readonly double dumpEvery = ParseMs(Environment.GetEnvironmentVariable("ACIRA_PROGRESS_DUMP_MS")); DateTime lastDump = DateTime.MinValue; int dumpN;
  static double ParseMs(string v) { double d; return double.TryParse(v, out d) && d > 0 ? d : 500; }

  // A frame that fails once (memory pressure while the installer unpacks) is skipped; only a card that fails again and again goes. Test only: the error is kept.
  void LogError(Exception ex) { if (dumpDir != null) try { File.AppendAllText(Path.Combine(dumpDir, "tick-error.txt"), DateTime.Now.ToString("HH:mm:ss.fff") + " " + ex + "\r\n"); } catch { } }
  // test only (with ACIRA_PROGRESS_DUMP): the time between draws, written to stats.txt when the card closes
  readonly List<float> drawGaps = new List<float>(); DateTime? lastDrawAt;
  protected override void OnFormClosed(FormClosedEventArgs e) {
    base.OnFormClosed(e);
    if (sampler != null) sampler.Stop(); if (frames != null) frames.Dispose();
    if (dumpDir != null && drawGaps.Count > 2) try {
      var g = new List<float>(drawGaps); g.Sort(); double sum = 0; foreach (var x in g) sum += x;
      File.WriteAllText(Path.Combine(dumpDir, "stats.txt"), "draws=" + (g.Count + 1) + " mean=" + (sum / g.Count).ToString("0.0") + " p50=" + g[g.Count / 2].ToString("0.0") + " p95=" + g[(int)(g.Count * 0.95)].ToString("0.0") + " max=" + g[g.Count - 1].ToString("0.0") + " (ms between draws)\n");
    } catch { }
  }

  void Draw() {
    if (dumpDir != null) { var t0 = DateTime.UtcNow; if (lastDrawAt != null) drawGaps.Add((float)(t0 - lastDrawAt.Value).TotalMilliseconds); lastDrawAt = t0; }
    PickFrames();
    using (var g = Graphics.FromImage(canvas)) {
      g.CompositingMode = CompositingMode.SourceCopy; g.PixelOffsetMode = PixelOffsetMode.Half;
      g.InterpolationMode = (fa.Width == width) ? InterpolationMode.NearestNeighbor : InterpolationMode.HighQualityBicubic;
      g.DrawImage(fa, new Rectangle(0, 0, width, height), 0, 0, fa.Width, fa.Height, GraphicsUnit.Pixel);
      if (fb != null && mix > 0.01) {
        g.CompositingMode = CompositingMode.SourceOver;
        using (var ia = new ImageAttributes()) {
          var cm = new ColorMatrix(); cm.Matrix33 = (float)mix; ia.SetColorMatrix(cm); ia.SetWrapMode(WrapMode.TileFlipXY);
          g.DrawImage(fb, new Rectangle(0, 0, width, height), 0, 0, fb.Width, fb.Height, GraphicsUnit.Pixel, ia);
        }
      }
    }
    Round();
    using (var g = Graphics.FromImage(canvas)) {
      g.SmoothingMode = SmoothingMode.AntiAlias; g.CompositingMode = CompositingMode.SourceOver;
      g.PixelOffsetMode = PixelOffsetMode.Half; g.InterpolationMode = InterpolationMode.NearestNeighbor; // pixel centres on the grid: a 1px line stays on its row (the default smears it over two) and the glow is a 1:1 copy
      Color ink = dark ? Color.FromArgb(255, 237, 237, 239) : Color.FromArgb(255, 26, 26, 28);
      int ts = TextState(); if (ts != curState) { prevState = curState; curState = ts; switchAt = DateTime.UtcNow; }
      double tm = prevState < 0 ? 1 : Math.Min(1.0, (DateTime.UtcNow - switchAt).TotalMilliseconds / TEXT_FADE_MS);
      if (prevState >= 0 && tm < 1) DrawText(g, prevState, 1 - tm);
      DrawText(g, curState, tm);
      g.InterpolationMode = InterpolationMode.NearestNeighbor;
      bool showLine = !(preview && phase >= progressMs + BLOOM_MS + PREVIEW_HOLD_MS);
      if (showLine && bloomAt == null && !(preview && phase >= progressMs)) {
        using (var b = new SolidBrush(Color.FromArgb(dark ? 26 : 38, ink))) g.FillRectangle(b, trackX, trackY, trackW, trackH);
        int fillW = (int)Math.Round(trackW * pos / 1000.0);
        if (fillW > 0) {
          var clip = g.Clip; g.SetClip(new Rectangle(trackX, 0, trackW, height)); // the glow never leaves the track
          if (Environment.GetEnvironmentVariable("ACIRA_NO_GLOW") == null) g.DrawImage(glow, trackX + fillW - (glow.Width - (int)Math.Round(14 * scale)), trackY + (trackH - glow.Height) / 2, glow.Width, glow.Height);
          g.Clip = clip;
          using (var b = new LinearGradientBrush(new Rectangle(trackX, trackY, Math.Max(2, fillW), trackH), Color.FromArgb(46, ink), Color.FromArgb(235, ink), 0f)) g.FillRectangle(b, trackX, trackY, fillW, trackH);
        }
      }
      if (preview) DrawClose(g, ink);
    }
    byte a255 = (byte)Math.Max(0, Math.Min(255, Math.Round(255 * alpha)));
    if (dumpDir != null && (DateTime.UtcNow - lastDump).TotalMilliseconds >= dumpEvery) {
      lastDump = DateTime.UtcNow;
      try {
        string name = "f" + (dumpN++).ToString("0000") + ".png"; canvas.Save(Path.Combine(dumpDir, name), ImageFormat.Png);
        string phase = fadeAt != null ? "fade" : holdAt != null ? "hold" : bloomAt != null ? "bloom" : doneAt != null ? "done" : "copy";
        File.AppendAllText(Path.Combine(dumpDir, "frames.csv"), name + "," + Math.Round((DateTime.UtcNow - start).TotalMilliseconds) + "," + Math.Round(pos) + "," + TextState() + "," + phase + "," + a255 + "," + (Native.IsWindow(parent) ? 1 : 0) + "\n");
      } catch { }
    }
    IntPtr screen = Native.GetDC(IntPtr.Zero), mem = Native.CreateCompatibleDC(screen), hbmp = canvas.GetHbitmap(Color.FromArgb(0)), old = Native.SelectObject(mem, hbmp);
    var size = new Native.SIZE { W = width, H = height }; var src = new Native.POINT(); var dst = new Native.POINT { X = Left, Y = Top };
    var blend = new Native.BLEND { Op = 0, Flags = 0, Alpha = a255, Format = 1 };
    bool shown = Native.UpdateLayeredWindow(Handle, screen, ref dst, ref size, mem, ref src, 0, ref blend, 2);
    if (!shown && dumpDir != null) try { File.WriteAllText(Path.Combine(dumpDir, "ulw-failed-" + Marshal.GetLastWin32Error() + ".txt"), "UpdateLayeredWindow failed"); } catch { }
    Native.SelectObject(mem, old); Native.DeleteObject(hbmp); Native.DeleteDC(mem); Native.ReleaseDC(IntPtr.Zero, screen);
  }

  void DrawClose(Graphics g, Color ink) {
    if (hoverClose) using (var b = new SolidBrush(Color.FromArgb(22, ink))) g.FillRectangle(b, closeRect);
    float s = (float)scale, cx = closeRect.X + closeRect.Width / 2f, cy = closeRect.Y + closeRect.Height / 2f, h = 3.5f * s;
    using (var pen = new Pen(Color.FromArgb(hoverClose ? 230 : 150, ink), Math.Max(1f, 1.4f * s))) { g.DrawLine(pen, cx - h, cy - h, cx + h, cy + h); g.DrawLine(pen, cx + h, cy - h, cx - h, cy + h); }
  }
}

static class Program {
  [STAThread] static void Main(string[] a) {
    Native.SetProcessDPIAware();
    if (a.Length >= 1 && (a[0] == "--preview" || a[0] == "--demo")) {
      bool dark = true; // always dark, whatever the Windows theme or the argument says
      IntPtr dc = Native.GetDC(IntPtr.Zero); int dpi = Native.GetDeviceCaps(dc, 88); Native.ReleaseDC(IntPtr.Zero, dc);
      double pct; double sc = double.TryParse(Environment.GetEnvironmentVariable("ACIRA_PROGRESS_SCALE"), out pct) && pct >= 100 ? pct / 100.0 : Math.Max(96, dpi) / 96.0; // test only: preview at another screen scale
      var pv = new Overlay(IntPtr.Zero, dark, sc, null, null, 0, null, 0, true);
      if (a[0] == "--demo") {
        double secs; pv.DemoMs = (int)(1000 * (a.Length > 1 && double.TryParse(a[1], out secs) && secs >= 3 ? secs : 40));
        for (int i = 1; i + 1 < a.Length; i++) if (a[i] == "--demo-launch") pv.DemoCmd = a[i + 1];
      }
      if (!pv.FramesOk) { MessageBox.Show("The installer scene frames are missing from this build.", "Acira Browser Setup"); return; }
      Application.Run(pv);
      if (a[0] == "--demo") {
        if (!pv.DemoDone) return; // closed early: nothing is launched
        if (!string.IsNullOrEmpty(pv.DemoCmd)) { try { Process.Start(new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe", "/d /s /c \"" + pv.DemoCmd + "\"") { UseShellExecute = false, CreateNoWindow = true }); } catch { } }
      }
      return;
    }
    if (a.Length < 4) return;
    long h; if (!long.TryParse(a[0], out h)) return;
    double scale; if (!double.TryParse(a[2], out scale)) scale = 100; scale /= 100.0;
    string dir = a.Length > 5 ? a[4] : null; double kb; double expected = a.Length > 5 && double.TryParse(a[5], out kb) ? kb * 1024.0 : 0;
    string payload = a.Length > 7 ? a[6] : null; double total = 0;
    if (a.Length > 7) { try { total = new FileInfo(a[7]).Length * 0.985; } catch { payload = null; } }
    var ov = new Overlay(new IntPtr(h), true, scale, a[3], dir, expected, payload, total, false);
    if (!ov.FramesOk) return; // no frames: the installer's still bitmap stays as it is (no line either: keep the fallback honest)
    Application.Run(ov);
  }
}
