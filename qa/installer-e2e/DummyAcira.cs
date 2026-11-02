// Test stand-in for AciraBrowser.exe at the end of a visible install: the installer launches the app through Explorer (so with the
// founder's REAL profile); the test swaps this in before the launch. It touches no profile: waits like a cold start, shows a dark
// window with a white mark (like the first-run splash), logs to C:\ae\r6\polish\handoff\dummy.log and closes itself.
using System; using System.Drawing; using System.IO; using System.Threading; using System.Windows.Forms;
static class P {
  static void Log(string s) { try { File.AppendAllText(@"C:\ae\r6\polish\handoff\dummy.log", DateTime.Now.ToString("HH:mm:ss.fff") + " " + s + "\r\n"); } catch { } }
  [STAThread] static void Main() {
    Log("started pid=" + System.Diagnostics.Process.GetCurrentProcess().Id);
    Thread.Sleep(1200); // cold start before the splash is drawn
    var f = new Form { Text = "Acira (test stand-in)", BackColor = Color.FromArgb(3, 5, 9), StartPosition = FormStartPosition.CenterScreen, ClientSize = new Size(1200, 780) };
    f.Paint += (s, e) => { using (var b = new SolidBrush(Color.FromArgb(237, 237, 239))) e.Graphics.FillRectangle(b, f.ClientSize.Width / 2 - 28, f.ClientSize.Height / 2 - 28, 56, 56); };
    f.Shown += (s, e) => { Log("window shown"); var t = new System.Windows.Forms.Timer { Interval = 5000 }; t.Tick += (a, b) => { Log("closing"); f.Close(); }; t.Start(); };
    Application.Run(f);
  }
}
