// The installer found an Acira already installed here (acira-installer.nsh, customInit):  acira-uninstall.exe --choose <installDir> <setupVersion> <answerFile>
// One branded question in the installer's own card (always dark, the installer's language), instead of the stock flow:
//   same version   -> "Acira is already installed": Repair (puts every app file back, registers it again; data and settings stay) / Open Acira / Cancel
//   older version  -> "Update Acira to <version>": Update to <version> / Open Acira / Cancel
//   newer version  -> "A newer Acira is installed": Open Acira / Cancel (no downgrade)
// A running Acira from that folder is asked to quit the ordinary way first (it is started with --acira-installer-quit: the session is kept
// and unsaved-work questions are asked); it is never killed. If it does not close, the person is told and can try again.
// The answer file gets "proceed", "opened" or "cancel". After "proceed" this window holds until the installer's own card covers it,
// so there is never a gap between the two.
// Built into acira-uninstall.exe with AciraUninstall.cs (scripts/build-installer-helper.cjs); scene: the uninstall question's picture.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

class ChooseForm : Form {
  enum Kind { Same, Older, Newer }
  enum Stage { Ask, NeedsClose, Closing, CloseFailed, Handoff }
  class Btn { public string Id, Text; public int Style; public Rectangle L, R; } // Style 0 primary pill, 1 light text, 2 quiet text
  const int W = 560, H = 340;
  readonly string dir, exe, answer, oldV, newV; readonly Kind kind; Stage stage = Stage.Ask;
  double s; readonly Image scene; int hover = -1, focus = -1; bool keyboard; bool answered;
  readonly List<Btn> buttons = new List<Btn>();
  readonly Timer timer = new Timer(); DateTime stageAt = DateTime.UtcNow;
  Font titleFont, textFont, buttonFont;

  // ---- words, in the installer's languages ("" English, es, fr, de, pt, it, ja, zh; ACIRA_INSTALLER_LANG overrides for tests)
  static readonly string[] CODES = { "", "es", "fr", "de", "pt", "it", "ja", "zh" };
  static readonly Dictionary<string, string[]> T = new Dictionary<string, string[]> {
    { "sameT", new[] { "Acira is already installed", "Acira ya está instalado", "Acira est déjà installé", "Acira ist bereits installiert", "O Acira já está instalado", "Acira è già installato", "Acira はすでにインストールされています", "Acira 已安装" } },
    { "sameS", new[] { "Version {0}. Repair puts back every app file; your data and settings stay.", "Versión {0}. Reparar vuelve a poner todos los archivos de la aplicación; tus datos y ajustes se mantienen.", "Version {0}. Réparer remet en place tous les fichiers de l’application ; vos données et réglages sont conservés.", "Version {0}. Reparieren legt alle App-Dateien neu an; deine Daten und Einstellungen bleiben.", "Versão {0}. Reparar recoloca todos os arquivos do app; seus dados e configurações ficam.", "Versione {0}. Ripara rimette al loro posto tutti i file dell’app; i tuoi dati e le impostazioni restano.", "バージョン {0}。修復するとアプリのファイルをすべて入れ直します。データと設定はそのまま残ります。", "版本 {0}。修复会重新放回所有应用文件；你的数据和设置都会保留。" } },
    { "olderT", new[] { "Update Acira to {1}", "Actualizar Acira a {1}", "Mettre Acira à jour vers {1}", "Acira auf {1} aktualisieren", "Atualizar o Acira para {1}", "Aggiorna Acira alla {1}", "Acira を {1} に更新", "将 Acira 更新到 {1}" } },
    { "olderS", new[] { "You have version {0}. Your data, settings and tabs stay.", "Tienes la versión {0}. Tus datos, ajustes y pestañas se mantienen.", "Vous avez la version {0}. Vos données, réglages et onglets sont conservés.", "Du hast Version {0}. Deine Daten, Einstellungen und Tabs bleiben.", "Você tem a versão {0}. Seus dados, configurações e abas ficam.", "Hai la versione {0}. I tuoi dati, le impostazioni e le schede restano.", "現在のバージョンは {0} です。データ、設定、タブはそのまま残ります。", "你当前的版本是 {0}。你的数据、设置和标签页都会保留。" } },
    { "newerT", new[] { "A newer Acira is installed", "Hay un Acira más reciente instalado", "Une version plus récente d’Acira est installée", "Eine neuere Acira-Version ist installiert", "Há um Acira mais novo instalado", "È installata una versione più recente di Acira", "新しいバージョンの Acira がインストールされています", "已安装更新版本的 Acira" } },
    { "newerS", new[] { "This PC has version {0}; this installer has {1}. Nothing was changed.", "Este equipo tiene la versión {0}; este instalador trae la {1}. No se ha cambiado nada.", "Ce PC a la version {0} ; ce programme d’installation contient la {1}. Rien n’a été modifié.", "Auf diesem PC ist Version {0}; dieses Installationsprogramm enthält {1}. Es wurde nichts geändert.", "Este computador tem a versão {0}; este instalador tem a {1}. Nada foi alterado.", "Questo PC ha la versione {0}; questo programma di installazione contiene la {1}. Non è stato modificato nulla.", "このパソコンにはバージョン {0}、このインストーラーには {1} が入っています。何も変更していません。", "这台电脑上是版本 {0}；此安装程序是 {1}。未做任何更改。" } },
    { "closeT", new[] { "Acira needs to close", "Acira tiene que cerrarse", "Acira doit se fermer", "Acira muss geschlossen werden", "O Acira precisa fechar", "Acira deve chiudersi", "Acira を閉じる必要があります", "需要关闭 Acira" } },
    { "closeRepairS", new[] { "To repair it, Acira closes for a moment. Your tabs come back.", "Para repararlo, Acira se cierra un momento. Tus pestañas vuelven.", "Pour le réparer, Acira se ferme un instant. Vos onglets reviennent.", "Zum Reparieren schließt Acira kurz. Deine Tabs kommen zurück.", "Para repará-lo, o Acira fecha por um momento. Suas abas voltam.", "Per ripararlo, Acira si chiude per un momento. Le tue schede tornano.", "修復のため、Acira をいったん閉じます。タブは元に戻ります。", "为了修复，Acira 会暂时关闭。你的标签页会恢复。" } },
    { "closeUpdateS", new[] { "To update it, Acira closes for a moment. Your tabs come back.", "Para actualizarlo, Acira se cierra un momento. Tus pestañas vuelven.", "Pour le mettre à jour, Acira se ferme un instant. Vos onglets reviennent.", "Zum Aktualisieren schließt Acira kurz. Deine Tabs kommen zurück.", "Para atualizá-lo, o Acira fecha por um momento. Suas abas voltam.", "Per aggiornarlo, Acira si chiude per un momento. Le tue schede tornano.", "更新のため、Acira をいったん閉じます。タブは元に戻ります。", "为了更新，Acira 会暂时关闭。你的标签页会恢复。" } },
    { "closingS", new[] { "Closing Acira…", "Cerrando Acira…", "Fermeture d’Acira…", "Acira wird geschlossen…", "Fechando o Acira…", "Chiusura di Acira…", "Acira を閉じています…", "正在关闭 Acira…" } },
    { "failT", new[] { "Acira is still open", "Acira sigue abierto", "Acira est toujours ouvert", "Acira ist noch geöffnet", "O Acira ainda está aberto", "Acira è ancora aperto", "Acira がまだ開いています", "Acira 仍处于打开状态" } },
    { "failS", new[] { "Save anything you’re working on, close Acira, then try again.", "Guarda lo que tengas a medias, cierra Acira y vuelve a intentarlo.", "Enregistrez ce qui est en cours, fermez Acira, puis réessayez.", "Speichere, woran du arbeitest, schließe Acira und versuche es erneut.", "Salve o que estiver fazendo, feche o Acira e tente de novo.", "Salva quello che stai facendo, chiudi Acira e riprova.", "作業中の内容を保存して Acira を閉じてから、もう一度お試しください。", "请保存正在进行的工作，关闭 Acira，然后重试。" } },
    { "repair", new[] { "Repair", "Reparar", "Réparer", "Reparieren", "Reparar", "Ripara", "修復", "修复" } },
    { "update", new[] { "Update to {1}", "Actualizar a {1}", "Mettre à jour vers {1}", "Auf {1} aktualisieren", "Atualizar para {1}", "Aggiorna alla {1}", "{1} に更新", "更新到 {1}" } },
    { "open", new[] { "Open Acira", "Abrir Acira", "Ouvrir Acira", "Acira öffnen", "Abrir o Acira", "Apri Acira", "Acira を開く", "打开 Acira" } },
    { "cancel", new[] { "Cancel", "Cancelar", "Annuler", "Abbrechen", "Cancelar", "Annulla", "キャンセル", "取消" } },
    { "closeRepair", new[] { "Close Acira and repair", "Cerrar Acira y reparar", "Fermer Acira et réparer", "Acira schließen und reparieren", "Fechar o Acira e reparar", "Chiudi Acira e ripara", "Acira を閉じて修復", "关闭 Acira 并修复" } },
    { "closeUpdate", new[] { "Close Acira and update", "Cerrar Acira y actualizar", "Fermer Acira et mettre à jour", "Acira schließen und aktualisieren", "Fechar o Acira e atualizar", "Chiudi Acira e aggiorna", "Acira を閉じて更新", "关闭 Acira 并更新" } },
    { "retry", new[] { "Try again", "Reintentar", "Réessayer", "Erneut versuchen", "Tentar de novo", "Riprova", "再試行", "重试" } },
    { "repairing", new[] { "Repairing Acira", "Reparando Acira", "Réparation d’Acira", "Acira wird repariert", "Reparando o Acira", "Riparazione di Acira", "Acira を修復しています", "正在修复 Acira" } },
    { "updating", new[] { "Updating Acira", "Actualizando Acira", "Mise à jour d’Acira", "Acira wird aktualisiert", "Atualizando o Acira", "Aggiornamento di Acira", "Acira を更新しています", "正在更新 Acira" } },
    { "starting", new[] { "Starting…", "Empezando…", "Démarrage…", "Wird gestartet…", "Iniciando…", "Avvio…", "開始しています…", "正在启动…" } },
  };
  static int li = -1;
  static int Li { get { if (li < 0) { string o = Environment.GetEnvironmentVariable("ACIRA_INSTALLER_LANG"); string code = o != null ? (o == "en" ? "" : o) : Detect(); li = Math.Max(0, Array.IndexOf(CODES, code)); } return li; } }
  [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern ushort GetUserDefaultUILanguage();
  static string Detect() { int id; try { id = GetUserDefaultUILanguage(); } catch { return ""; } switch (id & 0x3ff) { case 0x0a: return "es"; case 0x0c: return "fr"; case 0x07: return "de"; case 0x16: return "pt"; case 0x10: return "it"; case 0x11: return "ja"; case 0x04: return (id == 0x0804 || id == 0x1004) ? "zh" : ""; default: return ""; } }
  string S(string key) { return string.Format(T[key][Li], oldV, newV); }

  // ---- versions: semantic versions, a pre-release sorts before its release
  internal static int Compare(string a, string b) {
    Func<string, Tuple<int[], string>> parse = v => {
      v = (v ?? "").Trim(); int plus = v.IndexOf('+'); if (plus >= 0) v = v.Substring(0, plus);
      string pre = ""; int dash = v.IndexOf('-'); if (dash >= 0) { pre = v.Substring(dash + 1); v = v.Substring(0, dash); }
      var parts = v.Split('.'); var n = new int[3]; for (int i = 0; i < 3 && i < parts.Length; i++) int.TryParse(parts[i], out n[i]);
      return Tuple.Create(n, pre);
    };
    var x = parse(a); var y = parse(b);
    for (int i = 0; i < 3; i++) if (x.Item1[i] != y.Item1[i]) return x.Item1[i].CompareTo(y.Item1[i]);
    if (x.Item2 == y.Item2) return 0; if (x.Item2.Length == 0) return 1; if (y.Item2.Length == 0) return -1;
    var p = x.Item2.Split('.'); var q = y.Item2.Split('.');
    for (int i = 0; i < Math.Min(p.Length, q.Length); i++) {
      int m, k; bool pm = int.TryParse(p[i], out m), qk = int.TryParse(q[i], out k);
      int c = pm && qk ? m.CompareTo(k) : pm ? -1 : qk ? 1 : string.CompareOrdinal(p[i], q[i]); if (c != 0) return Math.Sign(c);
    }
    return p.Length.CompareTo(q.Length);
  }
  static string InstalledVersion(string exe) {
    try { var v = FileVersionInfo.GetVersionInfo(exe); string f = (v.FileVersion ?? "").Trim(); return f.Length > 0 ? f : (v.ProductVersion ?? "").Trim(); } catch { return ""; }
  }

  // ---- the running Acira from this folder (every process whose image is in it)
  static List<int> Running(string dir) {
    var l = new List<int>(); string prefix = dir.TrimEnd('\\') + "\\";
    foreach (var p in Process.GetProcessesByName("AciraBrowser")) {
      try { IntPtr h = Native.OpenProcess(0x1000, false, p.Id); if (h == IntPtr.Zero) continue; var sb = new System.Text.StringBuilder(1024); int n = sb.Capacity; bool ok = Native.QueryFullProcessImageName(h, 0, sb, ref n); Native.CloseHandle(h); if (ok && sb.ToString().StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) l.Add(p.Id); }
      catch { } finally { p.Dispose(); }
    }
    return l;
  }
  // the installer's own card (acira-installer.nsh AcStyleBanner): a visible Static window titled "Acira Browser Setup"
  static bool InstallerCardShown() {
    bool found = false;
    Native.EnumWindows((h, x) => { if (!Native.IsWindowVisible(h)) return true; var c = new System.Text.StringBuilder(64); Native.GetClassName(h, c, 64); if (c.ToString() != "Static") return true; var t = new System.Text.StringBuilder(64); Native.GetWindowText(h, t, 64); if (t.ToString() == "Acira Browser Setup") { found = true; return false; } return true; }, IntPtr.Zero);
    return found;
  }

  public static int Run(string dir, string version, string answerFile) {
    ChooseForm form = null;
    try {
      Native.SetProcessDPIAware(); Application.EnableVisualStyles();
      form = new ChooseForm(dir, version, answerFile);
      Application.Run(form);
      if (!form.answered) form.Answer("cancel");
    } catch {
      // anything unexpected: the ordinary install goes on (the old behaviour), never a stuck installer
      try { if (form == null || !form.answered) File.WriteAllText(answerFile, "proceed"); } catch { }
    }
    return 0;
  }

  ChooseForm(string dir, string version, string answerFile) {
    this.dir = dir.TrimEnd('\\'); exe = Path.Combine(this.dir, File.Exists(Path.Combine(this.dir, "AciraBrowserQA.exe")) ? "AciraBrowserQA.exe" : "AciraBrowser.exe"); answer = answerFile; newV = version;
    oldV = InstalledVersion(exe);
    int c = oldV.Length == 0 ? 0 : Compare(oldV, newV); kind = c == 0 ? Kind.Same : c < 0 ? Kind.Older : Kind.Newer;
    if (oldV.Length == 0) oldV = newV;
    IntPtr dc = Native.GetDC(IntPtr.Zero); int dpi = Native.GetDeviceCaps(dc, 88); Native.ReleaseDC(IntPtr.Zero, dc); s = Math.Max(96, dpi) / 96.0;
    double pct; if (double.TryParse(Environment.GetEnvironmentVariable("ACIRA_UNINSTALL_SCALE"), out pct) && pct >= 100) s = pct / 100.0;
    using (var st = Assembly.GetExecutingAssembly().GetManifestResourceStream("dark-base5.jpg")) { var ms = new MemoryStream(); st.CopyTo(ms); ms.Position = 0; scene = Image.FromStream(ms); }
    MakeFonts();
    Text = "Acira Browser Setup"; FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual; ShowInTaskbar = true; KeyPreview = true; TopMost = true;
    AutoScaleMode = AutoScaleMode.None; DoubleBuffered = true; BackColor = Color.Black;
    ClientSize = new Size((int)Math.Round(W * s), (int)Math.Round(H * s));
    // the same place as the installer's card (centre of the primary screen), so the hand-off is in place
    Location = new Point((Native.GetSystemMetrics(0) - ClientSize.Width) / 2, (Native.GetSystemMetrics(1) - ClientSize.Height) / 2);
    try { Icon = Icon.ExtractAssociatedIcon(exe); } catch { }
    HandleCreated += (a, b) => { int v = 2; if (Native.DwmSetWindowAttribute(Handle, 33, ref v, 4) != 0) { int r = (int)Math.Round(16 * s); Native.SetWindowRgn(Handle, Native.CreateRoundRectRgn(0, 0, Width + 1, Height + 1, r, r), true); } };
    timer.Interval = 50; timer.Tick += (a, b) => Tick(); timer.Start();
    Relayout();
  }

  void MakeFonts() {
    string face = Li == 6 ? "Yu Gothic UI" : Li == 7 ? "Microsoft YaHei UI" : "Segoe UI";
    titleFont = new Font(face + " Semibold", (float)(17 * s), GraphicsUnit.Pixel);
    if (titleFont.Name != face + " Semibold") titleFont = new Font(face, (float)(17 * s), FontStyle.Bold, GraphicsUnit.Pixel);
    textFont = new Font(face, (float)(12.5 * s), GraphicsUnit.Pixel);
    buttonFont = new Font(titleFont.FontFamily, (float)(13 * s), titleFont.Style, GraphicsUnit.Pixel);
  }

  // ---- what is shown
  void Texts(out string title, out string sub) {
    switch (stage) {
      case Stage.NeedsClose: title = S("closeT"); sub = S(kind == Kind.Same ? "closeRepairS" : "closeUpdateS"); return;
      case Stage.Closing: title = S("closeT"); sub = S("closingS"); return;
      case Stage.CloseFailed: title = S("failT"); sub = S("failS"); return;
      case Stage.Handoff: title = S(kind == Kind.Same ? "repairing" : "updating"); sub = S("starting"); return;
    }
    title = S(kind == Kind.Same ? "sameT" : kind == Kind.Older ? "olderT" : "newerT"); sub = S(kind == Kind.Same ? "sameS" : kind == Kind.Older ? "olderS" : "newerS");
  }
  void Relayout() {
    buttons.Clear();
    if (stage == Stage.Ask) {
      if (kind == Kind.Newer) { Add("cancel", S("cancel"), 2); Add("open", S("open"), 0); }
      else { Add("cancel", S("cancel"), 2); Add("open", S("open"), 1); Add("go", S(kind == Kind.Same ? "repair" : "update"), 0); }
    } else if (stage == Stage.NeedsClose) { Add("cancel", S("cancel"), 2); Add("close", S(kind == Kind.Same ? "closeRepair" : "closeUpdate"), 0); }
    else if (stage == Stage.CloseFailed) { Add("cancel", S("cancel"), 2); Add("retry", S("retry"), 0); }
    // 1x layout: Cancel at the left edge of the text column, the others from the right, the primary last
    int x = 532, y = 283, h = 31;
    for (int i = buttons.Count - 1; i >= 0; i--) {
      var b = buttons[i]; int tw = (int)Math.Ceiling(TextRenderer.MeasureText(b.Text, buttonFont, Size.Empty, TextFormatFlags.NoPadding).Width / s);
      int w = tw + (b.Style == 0 ? 32 : 24);
      if (b.Style == 2) b.L = new Rectangle(16, y, w, h); else { b.L = new Rectangle(x - w, y, w, h); x -= w + 8; }
      b.R = new Rectangle((int)Math.Round(b.L.X * s), (int)Math.Round(b.L.Y * s), (int)Math.Round(b.L.Width * s), (int)Math.Round(b.L.Height * s));
    }
    focus = buttons.FindIndex(b => b.Style == 0); hover = -1;
    Invalidate();
  }
  void Add(string id, string text, int style) { buttons.Add(new Btn { Id = id, Text = text, Style = style }); }

  protected override void OnPaint(PaintEventArgs e) {
    var g = e.Graphics; g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.PixelOffsetMode = PixelOffsetMode.HighQuality; g.SmoothingMode = SmoothingMode.AntiAlias;
    g.DrawImage(scene, new Rectangle(0, 0, ClientSize.Width, ClientSize.Height), 0, 0, scene.Width, scene.Height, GraphicsUnit.Pixel);
    string title, sub; Texts(out title, out sub);
    var flags = TextFormatFlags.Left | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix;
    TextRenderer.DrawText(g, title, titleFont, new Rectangle(Px(28), Px(206), Px(504), Px(26)), Color.FromArgb(237, 237, 239), flags | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
    TextRenderer.DrawText(g, sub, textFont, new Rectangle(Px(28), Px(236), Px(504), Px(40)), Color.FromArgb(158, 160, 166), flags | TextFormatFlags.WordBreak);
    for (int i = 0; i < buttons.Count; i++) {
      var b = buttons[i]; bool hot = i == hover;
      using (var path = Rounded(b.R, Px(6))) {
        if (b.Style == 0) using (var br = new SolidBrush(hot ? Color.FromArgb(255, 255, 255) : Color.FromArgb(237, 237, 239))) g.FillPath(br, path);
        else if (hot) using (var br = new SolidBrush(Color.FromArgb(22, 237, 237, 239))) g.FillPath(br, path);
        if (keyboard && i == focus) { var f = b.R; f.Inflate(Px(2), Px(2)); using (var fp = Rounded(f, Px(8))) using (var pen = new Pen(Color.FromArgb(237, 237, 239), (float)Math.Max(2, Math.Round(2 * s)))) g.DrawPath(pen, fp); }
      }
      Color ink = b.Style == 0 ? Color.FromArgb(22, 24, 28) : b.Style == 1 ? Color.FromArgb(237, 237, 239) : (hot ? Color.FromArgb(237, 237, 239) : Color.FromArgb(158, 160, 166));
      TextRenderer.DrawText(g, b.Text, buttonFont, b.R, ink, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix);
    }
  }
  int Px(double v) { return (int)Math.Round(v * s); }
  static GraphicsPath Rounded(Rectangle r, int rad) { var p = new GraphicsPath(); int d = Math.Max(1, rad * 2); p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90); p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90); p.CloseFigure(); return p; }

  // ---- input: pointer, Tab / arrows / Enter / Space / Escape; drag by the background
  int Hit(Point p) { for (int i = 0; i < buttons.Count; i++) if (buttons[i].R.Contains(p)) return i; return -1; }
  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x84) { var p = PointToClient(new Point((short)(m.LParam.ToInt64() & 0xFFFF), (short)((m.LParam.ToInt64() >> 16) & 0xFFFF))); if (Hit(p) < 0) { m.Result = (IntPtr)2; return; } }
    base.WndProc(ref m);
  }
  protected override void OnMouseMove(MouseEventArgs e) { base.OnMouseMove(e); int h = Hit(e.Location); if (h != hover) { hover = h; Cursor = h >= 0 ? Cursors.Hand : Cursors.Default; Invalidate(); } }
  protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); if (hover != -1) { hover = -1; Invalidate(); } }
  protected override void OnMouseUp(MouseEventArgs e) { base.OnMouseUp(e); if (e.Button == MouseButtons.Left) { int h = Hit(e.Location); if (h >= 0) Act(buttons[h].Id); } }
  protected override bool ProcessCmdKey(ref Message msg, Keys k) {
    if (k == Keys.Escape) { if (stage != Stage.Closing && stage != Stage.Handoff) Act("cancel"); return true; }
    if (buttons.Count == 0) return base.ProcessCmdKey(ref msg, k);
    if (k == Keys.Tab || k == Keys.Right || k == (Keys.Tab | Keys.Shift) || k == Keys.Left) { keyboard = true; int d = (k == Keys.Left || k == (Keys.Tab | Keys.Shift)) ? -1 : 1; focus = ((focus < 0 ? 0 : focus) + d + buttons.Count) % buttons.Count; Invalidate(); return true; }
    if (k == Keys.Enter || k == Keys.Space) { if (focus >= 0) Act(buttons[focus].Id); return true; }
    return base.ProcessCmdKey(ref msg, k);
  }

  void Go(Stage next) { stage = next; stageAt = DateTime.UtcNow; Relayout(); }
  internal void Answer(string word) {
    if (answered) return; answered = true;
    try { string tmp = answer + ".tmp"; File.WriteAllText(tmp, word); if (File.Exists(answer)) File.Delete(answer); File.Move(tmp, answer); } catch { try { File.WriteAllText(answer, word); } catch { } }
  }
  void Act(string id) {
    switch (id) {
      case "cancel": Answer("cancel"); Close(); return;
      case "open":
        try { Process.Start(new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = dir }); } catch { }
        Answer("opened"); Close(); return;
      case "go": case "retry":
        if (Running(dir).Count > 0) { Go(id == "retry" ? Stage.Closing : Stage.NeedsClose); if (id == "retry") AskToQuit(); return; }
        Proceed(); return;
      case "close": Go(Stage.Closing); AskToQuit(); return;
    }
  }
  void AskToQuit() {
    // the running Acira quits the ordinary way (desktop/main.cjs: --acira-installer-quit); never killed from here
    try { Process.Start(new ProcessStartInfo(exe, "--acira-installer-quit") { UseShellExecute = false, WorkingDirectory = dir }); } catch { }
  }
  void Proceed() { Answer("proceed"); Go(Stage.Handoff); }

  void Tick() {
    double ms = (DateTime.UtcNow - stageAt).TotalMilliseconds;
    if (stage == Stage.Closing && ms > 400) {
      if (Running(dir).Count == 0) { Proceed(); return; }
      if (ms > 20000) Go(Stage.CloseFailed);
    }
    // hold until the installer's own card is on screen (it goes on top of this one), then leave; never longer than 8 s
    if (stage == Stage.Handoff && (InstallerCardShown() || ms > 8000)) { timer.Stop(); Close(); }
  }
}
