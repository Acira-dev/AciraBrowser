# Watches for the Windows passkey dialog ("Windows Security" - "Choose a passkey" / "Create a passkey") by enumerating top-level windows,
# never by screen capture, and presses its Cancel button through UI Automation (no mouse). Used by qa/passkey-dialog-guard.mjs.
#   powershell -NoProfile -File qa/passkey-dialog-watch.ps1 -Seconds 60 -OwnerPid 1234 [-Site localhost] [-NoCancel]
# Prints one JSON line per event: {"event":"ready"}, {"event":"dialog",...} when a new credential window appears, {"event":"cancelled",...}.
# {"event":"gone"} when it closes. The dialog (Windows 11: class "Credential Dialog Xaml Host", process CredentialUIBroker, no owner
# window) is cancelled here only when its text names -Site or its owner belongs to -OwnerPid, so a dialog the person opened elsewhere is
# never touched. On this machine (build 26300) its UI Automation tree is not readable from a normal process, so the QA instead cancels
# its own request from the page (AbortController), which makes Chromium close the dialog; "gone" confirms it.
param([int]$Seconds = 60, [int]$OwnerPid = 0, [string]$Site = 'localhost', [switch]$NoCancel)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class AciraTopWindows {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  public static List<string[]> List() {
    var found = new List<string[]>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var title = new StringBuilder(512); GetWindowText(h, title, 512);
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      uint pid; GetWindowThreadProcessId(h, out pid);
      IntPtr owner = GetWindow(h, 4); uint ownerPid = 0; if (owner != IntPtr.Zero) GetWindowThreadProcessId(owner, out ownerPid);
      found.Add(new string[] { h.ToInt64().ToString(), title.ToString(), cls.ToString(), pid.ToString(), ownerPid.ToString() });
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
function Out-Event($data) { $data['t'] = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); [Console]::Out.WriteLine(($data | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
$processNames = @{}
function Get-ProcessName([int]$id) {
  if (-not $processNames.ContainsKey($id)) { $name = ''; try { $name = (Get-Process -Id $id -ErrorAction Stop).ProcessName } catch { }; $processNames[$id] = $name }
  return $processNames[$id]
}
function Get-Texts($element) {
  $names = New-Object System.Collections.Generic.List[string]
  try {
    $all = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($item in $all) { $name = $item.Current.Name; if ($name -and $names.Count -lt 40) { $names.Add($name) } }
  } catch { }
  return $names
}
$credentialWindow = '(?i)windows security|windows-sicherheit|s.curit. windows|passkey|credential|webauthn'
$baseline = @{}; foreach ($w in [AciraTopWindows]::List()) { $baseline[$w[0]] = $true }
$handled = @{}
Out-Event @{ event = 'ready'; windows = $baseline.Count }
$until = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $until) {
  $now = [AciraTopWindows]::List(); $present = @{}; foreach ($w in $now) { $present[$w[0]] = $true }
  foreach ($hwnd in @($handled.Keys)) { if ($handled[$hwnd] -and -not $present.ContainsKey($hwnd)) { $handled[$hwnd] = $false; Out-Event @{ event = 'gone'; hwnd = $hwnd } } }
  foreach ($w in $now) {
    $hwnd = $w[0]; if ($baseline.ContainsKey($hwnd) -or $handled.ContainsKey($hwnd)) { continue }
    $process = Get-ProcessName ([int]$w[3])
    if (-not (($w[1] -match $credentialWindow) -or ($w[2] -match $credentialWindow) -or ($process -match '(?i)credential|webauthn'))) { continue }
    $handled[$hwnd] = $true
    # The dialog's text arrives a moment after its window: read it for up to 3 s.
    $texts = @()
    for ($try = 0; $try -lt 25 -and $texts.Count -eq 0; $try++) {
      try { $texts = @(Get-Texts ([System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$hwnd))) } catch { }
      if ($texts.Count -eq 0) { Start-Sleep -Milliseconds 120 }
    }
    $ours = ($OwnerPid -gt 0 -and [int]$w[4] -eq $OwnerPid) -or (($texts -join ' ') -match [regex]::Escape($Site))
    Out-Event @{ event = 'dialog'; hwnd = $hwnd; title = $w[1]; class = $w[2]; pid = [int]$w[3]; process = $process; ownerPid = [int]$w[4]; ours = $ours; texts = @($texts) }
    if ($NoCancel -or -not $ours) { continue }
    $how = 'none'
    for ($try = 0; $try -lt 20 -and $how -eq 'none'; $try++) {
      try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$hwnd)
        $cancel = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Cancel')))
        if ($cancel) { $cancel.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); $how = 'uia-cancel' }
      } catch { }
      if ($how -eq 'none') { Start-Sleep -Milliseconds 150 }
    }
    if ($how -eq 'none') { [void][AciraTopWindows]::PostMessage([IntPtr][long]$hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); $how = 'wm-close' }
    Out-Event @{ event = 'cancelled'; hwnd = $hwnd; how = $how }
  }
  Start-Sleep -Milliseconds 120
}
Out-Event @{ event = 'done' }
