// Acira uninstall launcher: one branded question (Remove, keep my data / Remove and delete my data / Cancel), then the real
// NSIS uninstaller runs silently. Registered as the UninstallString (Settings > Apps); QuietUninstallString stays the real one.
// - Silent runs (/S, e.g. the updater removing the previous version) are passed straight to the real uninstaller with the
//   same command line and exit code; no window.
// - The window runs from a copy in %TEMP% so the install folder (and this file) can be removed.
// - Nothing is deleted by this program except the user data folders, and only after the uninstaller finished and the browser
//   files are gone. If anything fails, nothing else is touched and the user is told.
// Build: scripts/build-installer-helper.cjs (csc from the .NET Framework 4, C# 5). Scenes: scripts/uninstall-art-main.cjs.
// Usage (by Windows): acira-uninstall.exe /currentuser            (no window arguments needed)
//   internal: acira-uninstall.exe --from <installDir> [original arguments]
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Native {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int v, int size);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int a, int b, int c, int d, int e, int f);
  [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
  [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr dc, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h, int flags, System.Text.StringBuilder s, ref int n);
}

static class Program {
  const string Marker = "--from";

  static string Rest(string commandLine) {
    // everything after the program name, exactly as Windows received it (an unquoted _?=path may hold spaces)
    string s = commandLine.TrimStart();
    if (s.StartsWith("\"")) { int e = s.IndexOf('"', 1); s = e < 0 ? "" : s.Substring(e + 1); }
    else { int e = s.IndexOf(' '); s = e < 0 ? "" : s.Substring(e); }
    return s.Trim();
  }

  static string FindUninstaller(string dir) {
    try { foreach (var f in Directory.GetFiles(dir, "Uninstall*.exe")) return f; } catch { }
    return null;
  }

  static string OptionValue(string rest, string key) {
    int i = rest.IndexOf(key, StringComparison.OrdinalIgnoreCase); if (i < 0) return null;
    string v = rest.Substring(i + key.Length).TrimStart();
    if (v.StartsWith("\"")) { int e = v.IndexOf('"', 1); return e < 0 ? v.Substring(1) : v.Substring(1, e - 1); }
    // _?=path runs to the end of the command line
    return key == "_?=" ? v.Trim() : (v.IndexOf(' ') < 0 ? v : v.Substring(0, v.IndexOf(' ')));
  }

  [STAThread] static int Main() {
    var argv = Environment.GetCommandLineArgs();
    if (argv.Length >= 5 && argv[1] == "--choose") return ChooseForm.Run(argv[2], argv[3], argv[4]);
    string rest = Rest(Environment.CommandLine);
    string self = Assembly.GetExecutingAssembly().Location, selfDir = Path.GetDirectoryName(self);
    bool silent = (" " + rest + " ").IndexOf(" /S ", StringComparison.OrdinalIgnoreCase) >= 0;
    string from = rest.StartsWith(Marker) ? OptionValue(rest, Marker) : null;
    string pinned = OptionValue(rest, "_?=");
    string dir = from ?? pinned ?? selfDir;
    string real = FindUninstaller(dir);

    if (silent) {
      // transparent pass-through: same arguments, same wait behaviour, same exit code
      if (real == null) return 2;
      string run = real, temp = null;
      try {
        // with _?=<dir> the NSIS uninstaller only works as a copy outside that folder (this is what the installer itself does for the old version)
        if (pinned != null) { temp = Path.Combine(Path.GetTempPath(), "acira-old-uninstaller-" + Process.GetCurrentProcess().Id + ".exe"); File.Copy(real, temp, true); run = temp; }
        var p = Process.Start(new ProcessStartInfo(run, rest) { UseShellExecute = false, WorkingDirectory = Path.GetTempPath() });
        p.WaitForExit(); return p.ExitCode;
      } catch { return 2; }
      finally { try { if (temp != null) File.Delete(temp); } catch { } }
    }

    if (real == null) { MessageBox.Show(RemoveForm.MISSING[RemoveForm.Li], RemoveForm.TITLE[RemoveForm.Li], MessageBoxButtons.OK, MessageBoxIcon.Information); return 0; }

    // run from a copy in %TEMP% so this file in the install folder is not locked while it is removed
    if (from == null) {
      try {
        string copy = Path.Combine(Path.GetTempPath(), "acira-remove-" + Process.GetCurrentProcess().Id + ".exe");
        File.Copy(self, copy, true);
        Process.Start(new ProcessStartInfo(copy, Marker + " \"" + dir + "\"") { UseShellExecute = false });
        return 0;
      } catch { /* fall through and run in place; the file may stay behind */ }
    }

    bool created; var mutex = new Mutex(true, "Local\\AciraBrowserRemove", out created); if (!created) return 0;
    Native.SetProcessDPIAware();
    Application.EnableVisualStyles();
    var form = new RemoveForm(dir, real);
    Application.Run(form);
    if (from != null) CleanUpSelf(self);
    GC.KeepAlive(mutex);
    return form.ExitCodeValue;
  }

  static void CleanUpSelf(string self) {
    try {
      var psi = new ProcessStartInfo("cmd.exe", "/c ping -n 4 127.0.0.1 >nul & del /f /q \"" + self + "\"") { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden };
      Process.Start(psi);
    } catch { }
  }
}

class RemoveForm : Form {
  enum Stage { Question, Removing, Done }
  const int W = 560, H = 340;
  readonly string dir, real; readonly bool dark; double s;
  Stage stage = Stage.Question; int hover = -1, focus = 2; bool keyboard, keepData = true;
  readonly Image qScene, rScene, kScene, dScene; readonly Image[] hoverImg = new Image[3]; readonly Rectangle[] rect = new Rectangle[3], lrect = new Rectangle[3];
  Bitmap tip; readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
  // worker state
  volatile bool finished, ok; double initial, pos, real01; DateTime t0 = DateTime.UtcNow, doneAt; bool dataDeleted;
  public int ExitCodeValue;

  // The installer follows the Windows display language: "" (English), es, fr, de, pt, it, ja or zh (Simplified). ACIRA_INSTALLER_LANG overrides it for tests.
  static class Lang {
    [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern ushort GetUserDefaultUILanguage();
    public static string Detect() {
      string o = Environment.GetEnvironmentVariable("ACIRA_INSTALLER_LANG"); if (o != null) return o == "en" ? "" : o;
      int id; try { id = GetUserDefaultUILanguage(); } catch { return ""; }
      switch (id & 0x3ff) { case 0x0a: return "es"; case 0x0c: return "fr"; case 0x07: return "de"; case 0x16: return "pt"; case 0x10: return "it"; case 0x11: return "ja"; case 0x04: return (id == 0x0804 || id == 0x1004) ? "zh" : ""; default: return ""; }
    }
  }
  static string loc = Lang.Detect();
  // user-facing sentences of the message boxes, per language (index = Lang code order below)
  static readonly string[] CODES = { "", "es", "fr", "de", "pt", "it", "ja", "zh" };
  internal static readonly string[] TITLE = { "Remove Acira", "Quitar Acira", "Supprimer Acira", "Acira entfernen", "Remover o Acira", "Rimuovi Acira", "Acira を削除", "卸载 Acira" };
  internal static readonly string[] MISSING = { "Acira Browser does not seem to be installed here any more.", "Acira Browser ya no parece estar instalado aquí.", "Acira Browser ne semble plus être installé ici.", "Acira Browser scheint hier nicht mehr installiert zu sein.", "O Acira Browser não parece mais estar instalado aqui.", "Acira Browser non sembra più installato qui.", "Acira Browser はこの場所にインストールされていないようです。", "此处似乎已不再安装 Acira Browser。" };
  internal static readonly string[] FAILED = { "Acira could not be fully removed. Close it and try again from Settings > Apps. Your data was not touched.", "No se pudo quitar Acira por completo. Ciérralo e inténtalo de nuevo desde Configuración > Aplicaciones. Tus datos no se han tocado.", "Acira n’a pas pu être entièrement supprimé. Fermez-le et réessayez depuis Paramètres > Applications. Vos données n’ont pas été touchées.", "Acira konnte nicht vollständig entfernt werden. Schließe es und versuche es erneut unter Einstellungen > Apps. Deine Daten wurden nicht angetastet.", "Não foi possível remover o Acira por completo. Feche-o e tente de novo em Configurações > Aplicativos. Seus dados não foram alterados.", "Non è stato possibile rimuovere Acira del tutto. Chiudilo e riprova da Impostazioni > App. I tuoi dati non sono stati toccati.", "Acira を完全には削除できませんでした。Acira を閉じてから、設定 > アプリ でもう一度お試しください。データには手を付けていません。", "无法完全卸载 Acira。请关闭它，然后在“设置”>“应用”中重试。你的数据未受影响。" };
  internal static int Li { get { int i = Array.IndexOf(CODES, loc); return i < 0 ? 0 : i; } }
  static string LocTag() { return loc.Length > 0 && Li > 0 ? loc + "-" : ""; }
  static bool Has(string name) { return Array.IndexOf(Assembly.GetExecutingAssembly().GetManifestResourceNames(), name) >= 0; }

  const int TEXT_Y0 = 380; // row of the text layers in the 1120 x 680 scene (scripts/uninstall-art-main.cjs)
  Image Compose(Image bg, string textRes, string buttonPrefix) {
    var bmp = new Bitmap(bg.Width, bg.Height, PixelFormat.Format32bppPArgb);
    using (var g = Graphics.FromImage(bmp)) {
      g.DrawImage(bg, 0, 0, bg.Width, bg.Height);
      using (var layer = Res(textRes)) g.DrawImage(layer, 0, TEXT_Y0, layer.Width, layer.Height);
      if (buttonPrefix != null) for (int i = 0; i < 3; i++) using (var n = Res(buttonPrefix + i + ".jpg")) g.DrawImage(n, lrect[i].X * 2, lrect[i].Y * 2, n.Width, n.Height);
    }
    return bmp;
  }

  static Image Res(string name) {
    using (var st = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) { var ms = new MemoryStream(); st.CopyTo(ms); ms.Position = 0; return Image.FromStream(ms); }
  }

  readonly string dataName;
  public RemoveForm(string dir, string real) {
    this.dir = dir; this.real = real; dataName = DataFolder(dir);
    dark = true; // always dark, whatever the Windows theme is
    IntPtr dc = Native.GetDC(IntPtr.Zero); int dpi = Native.GetDeviceCaps(dc, 88); Native.ReleaseDC(IntPtr.Zero, dc); s = Math.Max(96, dpi) / 96.0; double pct; if (double.TryParse(Environment.GetEnvironmentVariable("ACIRA_UNINSTALL_SCALE"), out pct) && pct >= 100) s = pct / 100.0; // test only: preview at another screen scale
    string t = dark ? "dark" : "light"; if (LocTag().Length > 0 && Has(t + "-" + LocTag() + "tq.png")) t += "-" + loc; else loc = "";
    for (int i = 0; i < 3; i++) hoverImg[i] = Res(t + "-hover-" + i + ".jpg");
    using (var r = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream(loc.Length > 0 ? "layout-" + loc + ".txt" : "layout.txt")))
      for (string line; (line = r.ReadLine()) != null; ) { var p = line.Split(' '); if (p.Length < 5) continue; int i = int.Parse(p[0]); lrect[i] = new Rectangle(int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]), int.Parse(p[4])); }
    for (int i = 0; i < 3; i++) rect[i] = ScaledRect(lrect[i]);
    // the four scenes: one shared text-free picture per light level, with this language's title/status layer (and, for the question, the buttons) drawn over it
    using (var b5 = Res("dark-base5.jpg")) using (var b9 = Res("dark-base9.jpg")) {
      qScene = Compose(b5, t + "-tq.png", t + "-n-"); rScene = Compose(b5, t + "-tr.png", null); kScene = Compose(b9, t + "-tk.png", null); dScene = Compose(b9, t + "-td.png", null);
    }
    tip = MakeTip();
    string sceneDump = Environment.GetEnvironmentVariable("ACIRA_UNINSTALL_SCENES"); // test only: write the four composed scenes there and quit
    if (sceneDump != null) { qScene.Save(Path.Combine(sceneDump, "q.png"), ImageFormat.Png); rScene.Save(Path.Combine(sceneDump, "r.png"), ImageFormat.Png); kScene.Save(Path.Combine(sceneDump, "k.png"), ImageFormat.Png); dScene.Save(Path.Combine(sceneDump, "d.png"), ImageFormat.Png); Environment.Exit(0); }
    Text = TITLE[Li]; FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.CenterScreen; ShowInTaskbar = true; KeyPreview = true;
    ClientSize = new Size((int)Math.Round(W * s), (int)Math.Round(H * s)); DoubleBuffered = true; BackColor = dark ? Color.Black : Color.FromArgb(243, 240, 234);
    try { Icon = Icon.ExtractAssociatedIcon(Path.Combine(dir, File.Exists(Path.Combine(dir, "AciraBrowserQA.exe")) ? "AciraBrowserQA.exe" : "AciraBrowser.exe")); } catch { }
    AutoScaleMode = AutoScaleMode.None; // the window is exactly the card in device pixels; a monitor/DPI change resizes it and the layout follows
    ClientSizeChanged += (a, b) => { double ns = ClientSize.Width / (double)W; if (ns > 0.5 && Math.Abs(ns - s) > 0.004) { s = ns; for (int i = 0; i < 3; i++) rect[i] = ScaledRect(lrect[i]); if (tip != null) tip.Dispose(); tip = MakeTip(); Invalidate(); } };
    HandleCreated += (a, b) => Round();
    timer.Interval = 16; timer.Tick += (a, b) => Tick();
  }

  Rectangle ScaledRect(Rectangle l) { return new Rectangle((int)Math.Round(l.X * s), (int)Math.Round(l.Y * s), (int)Math.Round(l.Width * s), (int)Math.Round(l.Height * s)); }

  void Round() {
    int v = 2; if (Native.DwmSetWindowAttribute(Handle, 33, ref v, 4) != 0) { int r = (int)Math.Round(16 * s); Native.SetWindowRgn(Handle, Native.CreateRoundRectRgn(0, 0, Width + 1, Height + 1, r, r), true); }
  }

  Bitmap MakeTip() {
    int tw = (int)Math.Round(84 * s), th = (int)Math.Max(5, Math.Round(15 * s)); if (((th - Math.Max(1, (int)Math.Round(s))) & 1) != 0) th++; // same parity as the track: glow centre = track centre
    var b = new Bitmap(tw, th, dark ? PixelFormat.Format32bppPArgb : PixelFormat.Format32bppArgb);
    Color c = dark ? Color.FromArgb(237, 237, 239) : Color.FromArgb(87, 139, 251); // light theme: soft glow tinted with the mark's blue
    for (int y = 0; y < th; y++) for (int x = 0; x < tw; x++) {
      double dx = (x - (tw - 1)) / (double)tw, dy = (y - (th - 1) / 2.0) / ((th - 1) / 2.0), d = Math.Sqrt(dx * dx + dy * dy); if (d >= 0.72) continue;
      double al = Math.Min(1.0, Math.Pow(1 - d / 0.72, 1.3) * (dark ? 0.7 : 0.5)); b.SetPixel(x, y, Color.FromArgb((int)Math.Round(al * 255), c));
    }
    return b;
  }

  // drag the window by its background
  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x84 && stage != Stage.Done) { // WM_NCHITTEST
      var p = PointToClient(new Point((short)(m.LParam.ToInt64() & 0xFFFF), (short)((m.LParam.ToInt64() >> 16) & 0xFFFF)));
      if (stage != Stage.Question || HitButton(p) < 0) { m.Result = (IntPtr)2; return; } // HTCAPTION
    }
    base.WndProc(ref m);
  }

  int HitButton(Point p) { for (int i = 0; i < 3; i++) if (rect[i].Contains(p)) return i; return -1; }

  protected override void OnMouseMove(MouseEventArgs e) { base.OnMouseMove(e); if (stage != Stage.Question) return; int h = HitButton(e.Location); if (h != hover) { hover = h; Cursor = h >= 0 ? Cursors.Hand : Cursors.Default; Invalidate(); } }
  protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); if (hover != -1) { hover = -1; Invalidate(); } }
  protected override void OnMouseUp(MouseEventArgs e) { base.OnMouseUp(e); if (stage == Stage.Question && e.Button == MouseButtons.Left) { int h = HitButton(e.Location); if (h >= 0) Act(h); } }
  protected override bool ProcessCmdKey(ref Message msg, Keys k) {
    if (stage != Stage.Question) return base.ProcessCmdKey(ref msg, k);
    if (k == Keys.Escape) { Act(0); return true; }
    if (k == Keys.Tab || k == Keys.Right || k == (Keys.Tab | Keys.Shift) || k == Keys.Left) { keyboard = true; int d = (k == Keys.Left || k == (Keys.Tab | Keys.Shift)) ? -1 : 1; focus = focus < 0 ? (d > 0 ? 0 : 2) : (focus + d + 3) % 3; Invalidate(); return true; }
    if (k == Keys.Enter || k == Keys.Space) { keyboard = true; Act(focus < 0 ? 2 : focus); return true; }
    return base.ProcessCmdKey(ref msg, k);
  }

  void Act(int i) {
    if (i == 0) { ExitCodeValue = 0; Close(); return; }
    keepData = i == 2; stage = Stage.Removing; hover = -1; Cursor = Cursors.Default; initial = Scan(); t0 = DateTime.UtcNow;
    var th = new Thread(Work); th.IsBackground = true; th.Start(); timer.Start(); Invalidate();
  }

  double Scan() { try { long t = 0; foreach (var f in new DirectoryInfo(dir).GetFiles("*", SearchOption.AllDirectories)) t += f.Length; return t; } catch { return 0; } }

  bool Gone() { return !File.Exists(real) && !File.Exists(Path.Combine(dir, File.Exists(Path.Combine(dir, "AciraBrowserQA.exe")) ? "AciraBrowserQA.exe" : "AciraBrowser.exe")); }

  // test only: ACIRA_UNINSTALL_DEMO=<dir> plays the removing screen without removing anything and writes PNGs of the window there
  readonly string demoDir = Environment.GetEnvironmentVariable("ACIRA_UNINSTALL_DEMO"); int demoN;
  void Work() {
    if (demoDir != null) { Thread.Sleep(6000); ok = true; finished = true; return; }
    try {
      var p = Process.Start(new ProcessStartInfo(real, "/currentuser /S") { UseShellExecute = false, WorkingDirectory = Path.GetTempPath() });
      p.WaitForExit();
      if (p.ExitCode != 0 && !Gone()) { ok = false; finished = true; return; }
      // the uninstaller hands over to a copy of itself and exits: wait for the files to disappear
      for (int i = 0; i < 600 && !Gone(); i++) Thread.Sleep(200);
      ok = Gone();
      if (ok && !keepData) dataDeleted = DeleteUserData();
    } catch { ok = false; }
    finished = true;
  }

  // The data folder of the build installed here: "AciraBrowserQA" for a QA build (its own identity, desktop/build-identity.cjs), else "AciraBrowser".
  internal static string DataFolder(string dir) {
    if (File.Exists(Path.Combine(dir, "AciraBrowserQA.exe"))) return "AciraBrowserQA";
    try { var v = FileVersionInfo.GetVersionInfo(Path.Combine(dir, File.Exists(Path.Combine(dir, "AciraBrowserQA.exe")) ? "AciraBrowserQA.exe" : "AciraBrowser.exe")); if ((v.ProductName ?? "").Trim() == "Acira Browser QA") return "AciraBrowserQA"; } catch { }
    return "AciraBrowser";
  }
  bool DeleteUserData() {
    bool all = true; string name = dataName; // read before the uninstall removed the exe
    foreach (var root in new[] { Environment.GetEnvironmentVariable("APPDATA"), Environment.GetEnvironmentVariable("LOCALAPPDATA") }) {
      if (string.IsNullOrEmpty(root)) continue;
      string d = Path.Combine(root, name);
      for (int i = 0; i < 5 && Directory.Exists(d); i++) { try { Directory.Delete(d, true); } catch { Thread.Sleep(400); } }
      if (Directory.Exists(d)) all = false;
    }
    return all;
  }

  void Tick() {
    double ms = (DateTime.UtcNow - t0).TotalMilliseconds, creep = 0.03 * (1 - Math.Exp(-ms / 2000.0));
    double now = Scan(); if (initial > 0) real01 = Math.Max(real01, Math.Min(0.96, 1 - now / initial));
    double target = Math.Max(creep, real01);
    if (finished) {
      if (!ok) { timer.Stop(); Fail(); return; }
      target = 1;
    }
    pos = Math.Max(pos, Math.Min(target, pos + 0.022 + (target - pos) * 0.1));
    if (finished && pos >= 0.999 && stage == Stage.Removing) { stage = Stage.Done; doneAt = DateTime.UtcNow; }
    if (stage == Stage.Done && (DateTime.UtcNow - doneAt).TotalMilliseconds > 1800) { timer.Stop(); ExitCodeValue = 0; Close(); return; }
    Invalidate();
    if (demoDir != null && stage == Stage.Removing && demoN < 4 && pos > 0.15 + 0.2 * demoN) { try { using (var b = new Bitmap(ClientSize.Width, ClientSize.Height)) { DrawToBitmap(b, new Rectangle(0, 0, b.Width, b.Height)); b.Save(Path.Combine(demoDir, "r" + (demoN++) + ".png"), ImageFormat.Png); } } catch { } }
  }

  void Fail() {
    MessageBox.Show(FAILED[Li], TITLE[Li], MessageBoxButtons.OK, MessageBoxIcon.Warning);
    ExitCodeValue = 1; Close();
  }

  protected override void OnPaint(PaintEventArgs e) {
    var g = e.Graphics; g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.PixelOffsetMode = PixelOffsetMode.HighQuality; g.SmoothingMode = SmoothingMode.AntiAlias;
    var dst = new Rectangle(0, 0, ClientSize.Width, ClientSize.Height);
    Image scene = stage == Stage.Question ? qScene : stage == Stage.Removing ? rScene : (keepData || !dataDeleted ? kScene : dScene);
    g.DrawImage(scene, dst, 0, 0, scene.Width, scene.Height, GraphicsUnit.Pixel);
    if (stage == Stage.Question) {
      if (hover >= 0) g.DrawImage(hoverImg[hover], rect[hover]);
      int f = keyboard ? focus : -1;
      if (f >= 0) using (var pen = new Pen(dark ? Color.FromArgb(237, 237, 239) : Color.FromArgb(22, 24, 28), (float)Math.Max(2, Math.Round(2 * s)))) { var r = rect[f]; r.Inflate(2, 2); g.DrawRectangle(pen, r); }
    } else if (stage == Stage.Removing) DrawLine(g);
  }

  void DrawLine(Graphics g) {
    int x = (int)Math.Round(28 * s), y = (int)Math.Round(314 * s), w = (int)Math.Round(504 * s), h = Math.Max(1, (int)Math.Round(s));
    Color ink = dark ? Color.FromArgb(237, 237, 239) : Color.FromArgb(26, 26, 28);
    using (var b = new SolidBrush(Color.FromArgb(dark ? 26 : 38, ink))) g.FillRectangle(b, x, y, w, h);
    int fill = (int)Math.Round(w * Math.Min(1.0, pos)); if (fill < 1) return;
    var saved = g.Clip; var saveOffset = g.PixelOffsetMode; var saveInterp = g.InterpolationMode; g.SetClip(new Rectangle(x, 0, w, ClientSize.Height)); // never past the track ends
    g.PixelOffsetMode = PixelOffsetMode.Half; g.InterpolationMode = InterpolationMode.NearestNeighbor; // a 1:1 copy on the same pixel grid as the line
    if (Environment.GetEnvironmentVariable("ACIRA_NO_GLOW") == null) g.DrawImage(tip, x + fill - tip.Width, y + (h - tip.Height) / 2, tip.Width, tip.Height);
    g.Clip = saved; g.PixelOffsetMode = saveOffset; g.InterpolationMode = saveInterp;
    using (var b = new LinearGradientBrush(new Rectangle(x, y, Math.Max(2, fill), h), Color.FromArgb(46, ink), Color.FromArgb(235, ink), 0f)) g.FillRectangle(b, x, y, fill, h);
  }
}
