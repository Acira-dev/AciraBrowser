// [never compiled] Written on a Mac without a C# compiler for csc 4.0 (C# 5, .NET Framework 4): read it the way that compiler would.
// acira-verify.exe: the Windows jobs Electron has no API for, in one small program built and signed with Acira and shipped in its
// resources (scripts/build-installer-helper.cjs), so Acira itself never starts a script host. Chrome keeps the same check in its own
// signed binary. One job per run; the input arrives on standard input (UTF-8), the answer is one or two plain lines on standard output.
//   acira-verify.exe hello <hwnd>      the message to show on stdin. Windows Hello (face, fingerprint, PIN), in front of the Acira window.
//                                     unavailable:<Availability>   result:<UserConsentVerificationResult>   timeout   error
//   acira-verify.exe password <hwnd>   the message to show on stdin. The Windows account password prompt (CredUI, current user only);
//                                     LogonUser checks it and the account must be this Windows user.
//                                     result:Verified|Failed|Canceled   unavailable:NoPassword   error
//   acira-verify.exe icon               an executable's path on stdin. Its own icon as a base64 PNG (the shell's ExtractAssociatedIcon).
//   acira-verify.exe signature          a file's path on stdin. "valid" or "invalid" (WinVerifyTrust), then the signer's simple name, then
//                                     its full subject (VPN apps; Acira's own updates once Acira is signed).
// The typed password exists only inside this process and is wiped from memory after the check; it is never written anywhere.
// Hello goes through IUserConsentVerifierInterop::RequestVerificationForWindowAsync with Acira's window, as Chrome does, so the prompt
// is parented to Acira and appears in front of it. Windows 10 builds without that interface use UserConsentVerifier.RequestVerificationAsync
// (the call Acira's earlier check used). WinRT is reached through its ABI (combase.dll, vtable slots, interface ids from the Windows SDK
// headers) instead of the WinRT projection, which a .NET Framework 4 compiler cannot reference without SDK metadata files.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text;
using System.Threading;

static class Io {
  /** All of standard input as UTF-8 text (an empty string when there is none), trimmed and cut to `max` characters. */
  public static string ReadInput(int max) {
    try {
      Stream input = Console.OpenStandardInput();
      MemoryStream bytes = new MemoryStream();
      byte[] chunk = new byte[4096];
      int read;
      while ((read = input.Read(chunk, 0, chunk.Length)) > 0) {
        bytes.Write(chunk, 0, read);
        if (bytes.Length > max * 4) break;
      }
      string text = new UTF8Encoding(false).GetString(bytes.ToArray()).Trim();
      return text.Length > max ? text.Substring(0, max) : text;
    } catch { return ""; }
  }
  /** One line on standard output as UTF-8 bytes (Console.OutputEncoding cannot be set in a program without a console). */
  public static void WriteLine(string line) {
    try {
      byte[] bytes = new UTF8Encoding(false).GetBytes(line + "\n");
      Stream output = Console.OpenStandardOutput();
      output.Write(bytes, 0, bytes.Length);
      output.Flush();
    } catch { }
  }
}

static class Win32 {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("ole32.dll")] public static extern void CoTaskMemFree(IntPtr memory);

  /** The window a prompt belongs to: the HWND Acira passed (as a decimal number) when it is a window, else the foreground window. */
  public static IntPtr Window(string[] args) {
    ulong value = 0;
    if (args.Length > 1) ulong.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out value);
    // Window handles are 32-bit values, sign-extended in a 64-bit process.
    IntPtr window = new IntPtr(unchecked((int)(uint)(value & 0xFFFFFFFFUL)));
    if (window != IntPtr.Zero && IsWindow(window)) return window;
    return GetForegroundWindow();
  }

  /** Zeroes `bytes` bytes at `memory`. */
  public static void Wipe(IntPtr memory, int bytes) {
    if (memory == IntPtr.Zero) return;
    for (int i = 0; i < bytes; i++) Marshal.WriteByte(memory, i, 0);
  }
}

// Windows Hello through the WinRT ABI. Interface ids: windows.security.credentials.ui.h, userconsentverifierinterop.h, asyncinfo.h.
static class Hello {
  const string ClassName = "Windows.Security.Credentials.UI.UserConsentVerifier";
  static readonly Guid IID_IUserConsentVerifierStatics = new Guid("AF4F3F91-564C-4DDC-B8B5-973447627C65");
  static readonly Guid IID_IUserConsentVerifierInterop = new Guid("39E050C3-4E74-441A-8DC0-B81104DF949C");
  static readonly Guid IID_IAsyncInfo = new Guid("00000036-0000-0000-C000-000000000046");
  // IAsyncOperation<UserConsentVerifierAvailability> and IAsyncOperation<UserConsentVerificationResult> (parameterized ids,
  // checked against the WinRT signature algorithm in tests/windows-helper.test.cjs).
  static readonly Guid IID_AvailabilityOperation = new Guid("DDD384F3-D818-5D83-AB4B-32119C28587C");
  static readonly Guid IID_ResultOperation = new Guid("FD596FFD-2318-558F-9DBE-D21DF43764A5");
  // The longest the whole check (availability, then the prompt) takes before the prompt is cancelled here; Acira stops waiting a little
  // later (desktop/passwords/gate.cjs).
  const int LimitMs = 85000;

  [DllImport("combase.dll", ExactSpelling = true)] static extern int RoInitialize(int type);
  [DllImport("combase.dll", ExactSpelling = true, CharSet = CharSet.Unicode)] static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string source, uint length, out IntPtr text);
  [DllImport("combase.dll", ExactSpelling = true)] static extern int WindowsDeleteString(IntPtr text);
  [DllImport("combase.dll", ExactSpelling = true)] static extern int RoGetActivationFactory(IntPtr className, ref Guid iid, out IntPtr factory);

  // Vtable slots: IUnknown 0-2, IInspectable 3-5, then each interface's own methods in header order.
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int QueryInterfaceFn(IntPtr self, ref Guid iid, out IntPtr result);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint ReleaseFn(IntPtr self);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CheckAvailabilityFn(IntPtr self, out IntPtr operation);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int RequestVerificationFn(IntPtr self, IntPtr message, out IntPtr operation);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int RequestForWindowFn(IntPtr self, IntPtr window, IntPtr message, ref Guid iid, out IntPtr operation);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetIntFn(IntPtr self, out int value);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int NoArgumentFn(IntPtr self);
  const int SlotQueryInterface = 0, SlotRelease = 2;
  const int SlotCheckAvailability = 6, SlotRequestVerification = 7; // IUserConsentVerifierStatics
  const int SlotRequestForWindow = 6;                               // IUserConsentVerifierInterop
  const int SlotStatus = 7, SlotCancel = 9;                         // IAsyncInfo: Id, Status, ErrorCode, Cancel, Close
  const int SlotGetResults = 8;                                     // IAsyncOperation<T>: put_Completed, get_Completed, GetResults
  const int Started = 0, Completed = 1;                             // AsyncStatus

  static T Method<T>(IntPtr instance, int slot) where T : class {
    IntPtr table = Marshal.ReadIntPtr(instance);
    return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table, slot * IntPtr.Size), typeof(T));
  }
  static IntPtr Query(IntPtr instance, Guid iid) {
    IntPtr result = IntPtr.Zero;
    int hr = Method<QueryInterfaceFn>(instance, SlotQueryInterface)(instance, ref iid, out result);
    return hr < 0 ? IntPtr.Zero : result;
  }
  static void Release(IntPtr instance) {
    if (instance != IntPtr.Zero) Method<ReleaseFn>(instance, SlotRelease)(instance);
  }

  /** The finished operation's enum result; -1 when it failed or was cancelled, -2 when it ran past `end` (it is cancelled then). */
  static int Wait(IntPtr operation, Guid operationIid, DateTime end) {
    IntPtr info = Query(operation, IID_IAsyncInfo);
    if (info == IntPtr.Zero) return -1;
    try {
      GetIntFn status = Method<GetIntFn>(info, SlotStatus);
      int state = Started;
      while (true) {
        if (status(info, out state) < 0) return -1;
        if (state != Started) break;
        if (DateTime.UtcNow > end) { Method<NoArgumentFn>(info, SlotCancel)(info); return -2; }
        Thread.Sleep(50);
      }
      if (state != Completed) return -1;
      IntPtr typed = Query(operation, operationIid);
      if (typed == IntPtr.Zero) return -1;
      try {
        // A result counts only when GetResults says S_OK and wrote it: -1 stays when nothing was written.
        int value = -1;
        return Method<GetIntFn>(typed, SlotGetResults)(typed, out value) != 0 ? -1 : value;
      } finally { Release(typed); }
    } finally { Release(info); }
  }

  static string AvailabilityName(int value) {
    switch (value) {
      case 0: return "Available";
      case 1: return "DeviceNotPresent";
      case 2: return "NotConfiguredForUser";
      case 3: return "DisabledByPolicy";
      case 4: return "DeviceBusy";
      default: return "Unknown";
    }
  }
  static string ResultName(int value) {
    switch (value) {
      case 0: return "Verified";
      case 1: return "DeviceNotPresent";
      case 2: return "NotConfiguredForUser";
      case 3: return "DisabledByPolicy";
      case 4: return "DeviceBusy";
      case 5: return "RetriesExhausted";
      case 6: return "Canceled";
      default: return "Unknown";
    }
  }

  /** "unavailable:NoApi" when Hello cannot be reached at all (no prompt was shown), so Acira can offer the password prompt instead. */
  public static string Verify(IntPtr window, string message) {
    RoInitialize(1); // RO_INIT_MULTITHREADED; already initialised by [MTAThread] is fine
    DateTime end = DateTime.UtcNow.AddMilliseconds(LimitMs);
    IntPtr className = IntPtr.Zero, statics = IntPtr.Zero, interop = IntPtr.Zero, text = IntPtr.Zero, check = IntPtr.Zero, operation = IntPtr.Zero;
    try {
      if (WindowsCreateString(ClassName, (uint)ClassName.Length, out className) < 0) return "unavailable:NoApi";
      Guid staticsIid = IID_IUserConsentVerifierStatics;
      if (RoGetActivationFactory(className, ref staticsIid, out statics) < 0 || statics == IntPtr.Zero) { statics = IntPtr.Zero; return "unavailable:NoApi"; }
      if (Method<CheckAvailabilityFn>(statics, SlotCheckAvailability)(statics, out check) < 0 || check == IntPtr.Zero) { check = IntPtr.Zero; return "unavailable:NoApi"; }
      int availability = Wait(check, IID_AvailabilityOperation, end);
      if (availability == -2) return "timeout";
      if (availability < 0) return "unavailable:NoApi";
      if (availability != 0) return "unavailable:" + AvailabilityName(availability);
      if (WindowsCreateString(message, (uint)message.Length, out text) < 0) return "unavailable:NoApi";
      int hr = -1;
      interop = Query(statics, IID_IUserConsentVerifierInterop);
      if (interop != IntPtr.Zero && window != IntPtr.Zero) {
        Guid resultIid = IID_ResultOperation;
        hr = Method<RequestForWindowFn>(interop, SlotRequestForWindow)(interop, window, text, ref resultIid, out operation);
      }
      if (hr < 0 || operation == IntPtr.Zero) {
        operation = IntPtr.Zero;
        hr = Method<RequestVerificationFn>(statics, SlotRequestVerification)(statics, text, out operation);
      }
      if (hr < 0 || operation == IntPtr.Zero) { operation = IntPtr.Zero; return "unavailable:NoApi"; }
      int result = Wait(operation, IID_ResultOperation, end);
      if (result == -2) return "timeout";
      if (result < 0) return "error";
      return "result:" + ResultName(result);
    } finally {
      Release(operation); Release(check); Release(interop); Release(statics);
      if (text != IntPtr.Zero) WindowsDeleteString(text);
      if (className != IntPtr.Zero) WindowsDeleteString(className);
    }
  }
}

// The Windows account password prompt, as Chrome's fallback: CredUIPromptForWindowsCredentials lists only the signed-in account,
// LogonUser checks what was typed, and the signed-in token must be this same Windows user (compared by SID, which also holds for
// Microsoft accounts, whose sign-in name differs from the local account name).
static class Password {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDUI_INFO { public int cbSize; public IntPtr hwndParent; public string pszMessageText; public string pszCaptionText; public IntPtr hbmBanner; }
  [DllImport("credui.dll", CharSet = CharSet.Unicode)]
  static extern int CredUIPromptForWindowsCredentials(ref CREDUI_INFO info, int authError, ref uint authPackage, IntPtr inBuffer, uint inSize, out IntPtr outBuffer, out uint outSize, ref bool save, int flags);
  [DllImport("credui.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredUnPackAuthenticationBuffer(int flags, IntPtr buffer, uint size, StringBuilder user, ref int userLength, StringBuilder domain, ref int domainLength, IntPtr password, ref int passwordLength);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool LogonUser(string user, string domain, IntPtr password, int logonType, int provider, out IntPtr token);
  const int CREDUIWIN_ENUMERATE_CURRENT_USER = 0x200, CRED_PACK_PROTECTED_CREDENTIALS = 0x1, ERROR_CANCELLED = 1223;
  const int LOGON32_LOGON_INTERACTIVE = 2, LOGON32_PROVIDER_DEFAULT = 0, ERROR_LOGON_FAILURE = 1326, ERROR_ACCOUNT_RESTRICTION = 1327;
  const int PasswordChars = 1024;

  static bool IsCurrentUser(IntPtr token) {
    using (WindowsIdentity signedIn = new WindowsIdentity(token))
    using (WindowsIdentity current = WindowsIdentity.GetCurrent()) {
      return signedIn.User != null && current.User != null && signedIn.User.Equals(current.User);
    }
  }
  /** 0 only when LogonUser signed in and the token is this Windows user's; otherwise the Win32 error (ERROR_LOGON_FAILURE for a wrong
   *  password), or -1 for another user or a failure without an error code (never read as success). */
  static int Logon(string user, string domain, IntPtr password) {
    IntPtr token;
    if (!LogonUser(user, domain, password, LOGON32_LOGON_INTERACTIVE, LOGON32_PROVIDER_DEFAULT, out token)) {
      int error = Marshal.GetLastWin32Error();
      return error != 0 ? error : -1;
    }
    try { return IsCurrentUser(token) ? 0 : -1; } finally { Win32.CloseHandle(token); }
  }

  public static string Verify(IntPtr window, string message) {
    CREDUI_INFO info = new CREDUI_INFO();
    info.cbSize = Marshal.SizeOf(typeof(CREDUI_INFO));
    info.hwndParent = window;
    info.pszCaptionText = "Acira";
    info.pszMessageText = message;
    uint package = 0, outSize = 0;
    IntPtr outBuffer = IntPtr.Zero;
    bool save = false;
    int rc = CredUIPromptForWindowsCredentials(ref info, 0, ref package, IntPtr.Zero, 0, out outBuffer, out outSize, ref save, CREDUIWIN_ENUMERATE_CURRENT_USER);
    if (rc == ERROR_CANCELLED) return "result:Canceled";
    if (rc != 0 || outBuffer == IntPtr.Zero) return "error";
    IntPtr password = Marshal.AllocHGlobal(PasswordChars * 2);
    try {
      StringBuilder user = new StringBuilder(513), domain = new StringBuilder(337);
      int userLength = 513, domainLength = 337, passwordLength = PasswordChars;
      bool unpacked = CredUnPackAuthenticationBuffer(CRED_PACK_PROTECTED_CREDENTIALS, outBuffer, outSize, user, ref userLength, domain, ref domainLength, password, ref passwordLength);
      if (!unpacked) {
        Win32.Wipe(password, PasswordChars * 2);
        user.Length = 0; domain.Length = 0; userLength = 513; domainLength = 337; passwordLength = PasswordChars;
        unpacked = CredUnPackAuthenticationBuffer(0, outBuffer, outSize, user, ref userLength, domain, ref domainLength, password, ref passwordLength);
      }
      if (!unpacked) return "result:Failed";
      string name = user.ToString(), domainName = domain.ToString();
      int slash = name.IndexOf('\\');
      if (domainName.Length == 0 && slash > 0) { domainName = name.Substring(0, slash); name = name.Substring(slash + 1); }
      // LogonUser wants a null domain for a user@domain name, and "." for a local account.
      string first = domainName.Length > 0 ? domainName : (name.IndexOf('@') >= 0 ? null : ".");
      int answer = Logon(name, first, password);
      // The user@domain form once more without the domain, unless Windows already said the password is wrong (each try counts toward lockout).
      if (answer > 0 && answer != ERROR_LOGON_FAILURE && first != null && name.IndexOf('@') >= 0) answer = Logon(name, null, password);
      if (answer == 0) return "result:Verified";
      // An account without a password cannot sign in this way: Acira asks for Windows Hello or a password to be set up.
      if (answer == ERROR_ACCOUNT_RESTRICTION && Marshal.ReadInt16(password) == 0) return "unavailable:NoPassword";
      return "result:Failed";
    } finally {
      Win32.Wipe(password, PasswordChars * 2);
      Marshal.FreeHGlobal(password);
      Win32.Wipe(outBuffer, (int)outSize);
      Win32.CoTaskMemFree(outBuffer);
    }
  }
}

// Authenticode: the same answer as PowerShell's Get-AuthenticodeSignature (Status Valid, the signer's simple name and subject).
static class Signature {
  [StructLayout(LayoutKind.Sequential)]
  struct WINTRUST_FILE_INFO { public uint cbStruct; public IntPtr pcwszFilePath; public IntPtr hFile; public IntPtr pgKnownSubject; }
  [StructLayout(LayoutKind.Sequential)]
  struct WINTRUST_DATA {
    public uint cbStruct; public IntPtr pPolicyCallbackData; public IntPtr pSIPClientData; public uint dwUIChoice; public uint fdwRevocationChecks;
    public uint dwUnionChoice; public IntPtr pFile; public uint dwStateAction; public IntPtr hWVTStateData; public IntPtr pwszURLReference;
    public uint dwProvFlags; public uint dwUIContext; public IntPtr pSignatureSettings;
  }
  [DllImport("wintrust.dll", ExactSpelling = true)] static extern int WinVerifyTrust(IntPtr window, ref Guid action, ref WINTRUST_DATA data);
  static readonly Guid WINTRUST_ACTION_GENERIC_VERIFY_V2 = new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");
  // Microsoft's "Verifying the Signature of a PE File" sample: no UI, no extra revocation checks, a file, verify then close.
  const uint WTD_UI_NONE = 2, WTD_REVOKE_NONE = 0, WTD_CHOICE_FILE = 1, WTD_STATEACTION_VERIFY = 1, WTD_STATEACTION_CLOSE = 2, WTD_SAFER_FLAG = 0x100;

  static bool Trusted(string file) {
    IntPtr path = Marshal.StringToHGlobalUni(file), fileInfo = IntPtr.Zero;
    try {
      WINTRUST_FILE_INFO subject = new WINTRUST_FILE_INFO();
      subject.cbStruct = (uint)Marshal.SizeOf(typeof(WINTRUST_FILE_INFO));
      subject.pcwszFilePath = path;
      fileInfo = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WINTRUST_FILE_INFO)));
      Marshal.StructureToPtr(subject, fileInfo, false);
      WINTRUST_DATA data = new WINTRUST_DATA();
      data.cbStruct = (uint)Marshal.SizeOf(typeof(WINTRUST_DATA));
      data.dwUIChoice = WTD_UI_NONE; data.fdwRevocationChecks = WTD_REVOKE_NONE; data.dwUnionChoice = WTD_CHOICE_FILE;
      data.pFile = fileInfo; data.dwStateAction = WTD_STATEACTION_VERIFY; data.dwProvFlags = WTD_SAFER_FLAG;
      Guid action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
      int status = WinVerifyTrust(IntPtr.Zero, ref action, ref data);
      data.dwStateAction = WTD_STATEACTION_CLOSE;
      WinVerifyTrust(IntPtr.Zero, ref action, ref data);
      return status == 0;
    } finally {
      if (fileInfo != IntPtr.Zero) Marshal.FreeHGlobal(fileInfo);
      Marshal.FreeHGlobal(path);
    }
  }

  public static void Write(string file) {
    bool valid = false;
    string publisher = "", subject = "";
    if (file.Length > 0 && File.Exists(file)) {
      valid = Trusted(file);
      try {
        X509Certificate2 signer = new X509Certificate2(X509Certificate.CreateFromSignedFile(file));
        publisher = signer.GetNameInfo(X509NameType.SimpleName, false) ?? "";
        subject = signer.Subject ?? "";
      } catch { publisher = ""; subject = ""; }
    }
    Io.WriteLine(valid ? "valid" : "invalid");
    Io.WriteLine(publisher.Replace('\r', ' ').Replace('\n', ' '));
    Io.WriteLine(subject.Replace('\r', ' ').Replace('\n', ' '));
  }
}

static class FileIcon {
  public static int Write(string file) {
    if (file.Length == 0 || !File.Exists(file)) return 1;
    using (Icon icon = Icon.ExtractAssociatedIcon(file)) {
      if (icon == null) return 1;
      using (Bitmap bitmap = icon.ToBitmap())
      using (MemoryStream png = new MemoryStream()) {
        bitmap.Save(png, ImageFormat.Png);
        Io.WriteLine(Convert.ToBase64String(png.ToArray()));
      }
    }
    return 0;
  }
}

static class AciraVerify {
  // MTA for the WinRT calls (completion arrives on a pool thread; nothing here pumps messages). The password prompt gets its own STA
  // thread, the apartment Windows' dialogs expect.
  [MTAThread]
  static int Main(string[] args) {
    try {
      string command = args.Length > 0 ? args[0] : "";
      if (command == "hello") {
        IntPtr window = Win32.Window(args);
        Io.WriteLine(Hello.Verify(window, Io.ReadInput(1024)));
        return 0;
      }
      if (command == "password") {
        IntPtr window = Win32.Window(args);
        string message = Io.ReadInput(1024), answer = "error";
        Thread prompt = new Thread(() => { try { answer = Password.Verify(window, message); } catch { answer = "error"; } });
        prompt.SetApartmentState(ApartmentState.STA);
        prompt.Start();
        prompt.Join();
        Io.WriteLine(answer);
        return 0;
      }
      if (command == "icon") return FileIcon.Write(Io.ReadInput(2048));
      if (command == "signature") { Signature.Write(Io.ReadInput(2048)); return 0; }
      return 2;
    } catch {
      Io.WriteLine("error");
      return 1;
    }
  }
}
