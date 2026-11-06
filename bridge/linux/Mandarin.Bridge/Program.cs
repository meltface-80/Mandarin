// Program.cs — mandarin-bridge, Mandarin Bridge for Linux (item 282): this computer and the USB DAC on it as a
// SlimProto player that Mandarin plays to (item 316; a UPnP renderer before), played by Mandarin's own audio engine.
// Set up and watched from its own web page.
//
//   mandarin-bridge [--port 49494] [--data DIR] [--engine PATH] [--ffmpeg PATH]
//                   [--asound /proc/asound] [--device alsa:…|file:…] [--address IP] [--wifi [--nmcli PATH] [--setup-after 60]]
//                   [--update-api https://api.github.com] [--server IP[:PORT]] [--sys /sys]
//   mandarin-bridge --version
//
// Updated from Mandarin (item 291, Update.cs): the update is in DIR/app, and the program installed hands over to it as
// it starts (back to itself where it fails as it starts). --update-api is where Mandarin's releases are asked for.
//
// --device plays to a given device in place of the DAC found (the tests' file:…); --address is the address it says it
// is at (else its first on the home network); --wifi lets its page set the Wi-Fi, and opens a setup network where
// there is none --setup-after seconds after it starts (Wifi.cs; the Raspberry Pi image's); --server is the Mandarin to
// be played by (its SlimProto port, 3483 where none is given), else the one found on the network. Logs go to stderr.
using System.Globalization;
using System.Reflection;

namespace Mandarin.Bridge;

/* How the Bridge was started. */
internal sealed record Options(int Port, string Data, string Engine, string Ffmpeg, string Asound, string Device, string? Address, string? Nmcli = null, int SetupAfter = 60,
    string UpdateApi = "https://api.github.com", string? Server = null, string Sys = "/sys");

internal static class Program
{
    // Stamped by build.sh (-p:Version): Mandarin's version, the source revision a build may add after + left off.
    public static readonly string Version =
        (typeof(Program).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "").Split('+')[0].Trim() is { Length: > 0 } v
            ? v : (typeof(Program).Assembly.GetName().Version ?? new Version(0, 0, 0)).ToString(3);

    // The commit it was built from (build.sh stamps it after the version's +), "local" where it wasn't: which build this
    // is, as Mandarin's Settings → Updates compares it with the one released (item 291).
    public static readonly string Commit =
        (typeof(Program).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "").Split('+') is { Length: > 1 } parts
            && parts[1].Trim() is { Length: > 0 } c ? c[..Math.Min(7, c.Length)] : "local";

    // Set when the update is asked to start the Bridge again (Update.cs): Main returns, and systemd starts it.
    private static readonly ManualResetEventSlim done = new();

    private static int Main(string[] args)
    {
        int port = 49494;
        string? data = null, engine = null, address = null;
        string ffmpeg = "ffmpeg", asound = "/proc/asound", device = "", sys = "/sys";
        string? nmcli = null, server = null;
        var setupAfter = 60;
        var updateApi = "https://api.github.com";
        for (var i = 0; i < args.Length; i++)
        {
            string Next() => i + 1 < args.Length ? args[++i] : throw new ArgumentException(args[i] + " needs a value");
            switch (args[i])
            {
                case "--version": Console.WriteLine("mandarin-bridge " + Version + " (" + Commit + ")"); return 0;
                case "--port": port = int.Parse(Next(), CultureInfo.InvariantCulture); break;
                case "--data": data = Next(); break;
                case "--engine": engine = Next(); break;
                case "--ffmpeg": ffmpeg = Next(); break;
                case "--asound": asound = Next(); break;
                case "--device": device = Next(); break;
                case "--address": address = Next(); break;
                case "--wifi": nmcli ??= "nmcli"; break;
                case "--nmcli": nmcli = Next(); break;
                case "--setup-after": setupAfter = int.Parse(Next(), CultureInfo.InvariantCulture); break;
                case "--update-api": updateApi = Next(); break;
                case "--server": server = Next(); break;
                case "--sys": sys = Next(); break;   // where each DAC's USB descriptor is read (the tests' own, item 323)
                default: Console.Error.WriteLine("unknown argument " + args[i]); return 2;
            }
        }
        data ??= Environment.UserName == "root" ? "/var/lib/mandarin-bridge"
            : Path.Combine(Environment.GetEnvironmentVariable("XDG_CONFIG_HOME") is { Length: > 0 } x ? x : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config"), "mandarin-bridge");
        // An update put in place (Update.cs): it runs, this program's arguments its own, its engine beside it.
        if (HandOver(args, data) is { } code) return code;
        engine ??= FindEngine();
        if (engine == null) { Console.Error.WriteLine("mandarin-audio (Mandarin's audio engine) isn't here: pass --engine"); return 3; }
        var bridge = new Bridge(new Options(port, data, engine, ffmpeg, asound, device, address, nmcli, setupAfter, updateApi, server, sys), Log);
        bridge.Start();
        AppDomain.CurrentDomain.ProcessExit += (_, _) => { bridge.Stop(); done.Set(); };
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; done.Set(); };
        done.Wait();
        bridge.Stop();
        return 0;
    }

    /* The Bridge started again: this program returns, and systemd starts it (Restart=always), into the update. */
    public static void Restart() => done.Set();

    /*
     * The update in [data]/app run in this program's place, with [args] and its own engine: its exit code, or null where
     * there's none (or this is it). One that fails within 20 seconds of starting is let go, and this program runs on.
     */
    private static int? HandOver(string[] args, string data)
    {
        var app = Update.AppDir(data);
        var next = Path.Combine(app, "mandarin-bridge");
        var self = Environment.ProcessPath ?? "";
        if (Environment.GetEnvironmentVariable("MANDARIN_BRIDGE_UPDATED") == "1" || !File.Exists(next) || Path.GetFullPath(self) == Path.GetFullPath(next)) return null;
        var psi = new System.Diagnostics.ProcessStartInfo(next) { UseShellExecute = false };
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--engine" && i + 1 < args.Length) { i++; continue; }
            psi.ArgumentList.Add(args[i]);
        }
        psi.ArgumentList.Add("--engine");
        psi.ArgumentList.Add(Path.Combine(app, "mandarin-audio"));
        psi.Environment["MANDARIN_BRIDGE_UPDATED"] = "1";
        var began = DateTime.UtcNow;
        System.Diagnostics.Process? child;
        try { child = System.Diagnostics.Process.Start(psi); }
        catch (System.ComponentModel.Win32Exception e) { child = null; Log("update: couldn't start it (" + e.Message + ")"); }
        if (child != null)
        {
            Log($"update: running {next}");
            // Stopped (systemd's SIGTERM, a Ctrl-C): the update stopped with it, never left running on its own.
            void Stop(System.Runtime.InteropServices.PosixSignalContext _)
            {
                try { if (!child.HasExited) { child.Kill(true); child.WaitForExit(5000); } }
                catch (InvalidOperationException) { /* gone */ }
            }
            using var term = System.Runtime.InteropServices.PosixSignalRegistration.Create(System.Runtime.InteropServices.PosixSignal.SIGTERM, Stop);
            using var stop = System.Runtime.InteropServices.PosixSignalRegistration.Create(System.Runtime.InteropServices.PosixSignal.SIGINT, Stop);
            child.WaitForExit();
            if (child.ExitCode == 0 || DateTime.UtcNow - began > TimeSpan.FromSeconds(20)) return child.ExitCode;
            Log($"update: it stopped as it started (exit {child.ExitCode}); let go, the program installed runs on");
        }
        try { Directory.Delete(app, true); } catch (IOException) { /* left: tried again next time */ }
        return null;
    }

    private static readonly object logLock = new();

    public static void Log(string line)
    {
        lock (logLock) Console.Error.WriteLine(DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + " " + line);
        Kept.Add(line);
    }

    // The engine beside this program (as packaged), where the package puts it, or the repository's own build.
    private static string? FindEngine()
    {
        var here = AppContext.BaseDirectory;
        foreach (var p in new[] { Path.Combine(here, "mandarin-audio"), "/usr/lib/mandarin-bridge/mandarin-audio", Path.Combine(here, "..", "..", "..", "engine", "bin", "mandarin-audio") })
            if (File.Exists(p)) return Path.GetFullPath(p);
        return null;
    }
}
