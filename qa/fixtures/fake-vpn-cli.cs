// A stand-in for a VPN provider's command-line client (mullvad.exe / ivpn.exe), used only by tests/r3-network-proxy.test.cjs.
// It keeps its "tunnel" in a text file, so no real network, VPN or account is involved. Compiled on demand with the .NET Framework compiler that ships with Windows.
//   FAKE_VPN_STATE    path of the file holding connected|disconnected
//   FAKE_VPN_FLAVOR   mullvad (JSON status) or ivpn ("VPN : STATE" lines)
//   FAKE_VPN_LOG      optional file: every argument list is appended, so a test sees exactly what was run
//   FAKE_VPN_MISBEHAVE  hang | stdin | flood | fail
using System;
using System.IO;
using System.Threading;

class FakeVpn
{
    static int Main(string[] args)
    {
        string state = Environment.GetEnvironmentVariable("FAKE_VPN_STATE") ?? "fake-state.txt";
        string flavor = Environment.GetEnvironmentVariable("FAKE_VPN_FLAVOR") ?? "mullvad";
        string misbehave = Environment.GetEnvironmentVariable("FAKE_VPN_MISBEHAVE") ?? "";
        string log = Environment.GetEnvironmentVariable("FAKE_VPN_LOG");
        if (log != null) { try { File.AppendAllText(log, string.Join(" ", args) + "\n"); } catch (IOException) { } }
        if (misbehave == "hang") { Thread.Sleep(60000); return 0; }
        if (misbehave == "stdin") { Console.In.ReadToEnd(); }
        if (misbehave == "flood") { string chunk = new string('x', 1024); for (int i = 0; i < 400; i++) Console.Out.Write(chunk); return 0; }
        if (misbehave == "fail") { Console.Error.WriteLine("not logged in: account 1234567890123456"); Console.Out.WriteLine("account 1234567890123456"); return 3; }
        string current = File.Exists(state) ? File.ReadAllText(state).Trim() : "disconnected";
        string command = args.Length > 0 ? args[0] : "";
        if (command == "connect") { File.WriteAllText(state, "connected"); return 0; }
        if (command == "disconnect") { File.WriteAllText(state, "disconnected"); return 0; }
        if (command == "status")
        {
            if (flavor == "ivpn") Console.Out.WriteLine("Account : ivpn-private-account\nVPN : " + current.ToUpperInvariant() + "\nFirewall : Disabled");
            else Console.Out.WriteLine("{\"state\":\"" + current + "\",\"details\":{\"location\":{\"ipv4\":\"203.0.113.9\"}}}");
            return 0;
        }
        return 2;
    }
}
