// Program.cs — mandarin-bridge, Mandarin Bridge for Linux (item 282): this computer and the USB DAC on it as a UPnP
// renderer that Mandarin plays to, played by Mandarin's own audio engine. Set up and watched from its own web page.
//
//   mandarin-bridge [--port 49494] [--data DIR] [--engine PATH] [--ffmpeg PATH]
//                   [--asound /proc/asound] [--device alsa:…|file:…] [--address IP] [--wifi [--nmcli PATH] [--setup-after 60]]
//   mandarin-bridge --version
//
// --device plays to a given device whatever DACs are found (the tests' file:…); --address is the address it says it
// is at (else its first on the home network); --wifi lets its page set the Wi-Fi, and opens a setup network where
// there is none --setup-after seconds after it starts (Wifi.cs; the Raspberry Pi image's). Logs go to stderr.
using System.Globalization;
using System.Reflection;

namespace Mandarin.Bridge;

/* How the Bridge was started. */
internal sealed record Options(int Port, string Data, string Engine, string Ffmpeg, string Asound, string Device, string? Address, string? Nmcli = null, int SetupAfter = 60);

internal static class Program
{
    // Stamped by build.sh (-p:Version): Mandarin's version, the source revision a build may add after + left off.
    public static readonly string Version =
        (typeof(Program).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "").Split('+')[0].Trim() is { Length: > 0 } v
            ? v : (typeof(Program).Assembly.GetName().Version ?? new Version(0, 0, 0)).ToString(3);

    private static int Main(string[] args)
    {
        int port = 49494;
        string? data = null, engine = null, address = null;
        string ffmpeg = "ffmpeg", asound = "/proc/asound", device = "";
        string? nmcli = null;
        var setupAfter = 60;
        for (var i = 0; i < args.Length; i++)
        {
            string Next() => i + 1 < args.Length ? args[++i] : throw new ArgumentException(args[i] + " needs a value");
            switch (args[i])
            {
                case "--version": Console.WriteLine("mandarin-bridge " + Version); return 0;
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
                default: Console.Error.WriteLine("unknown argument " + args[i]); return 2;
            }
        }
        engine ??= FindEngine();
        if (engine == null) { Console.Error.WriteLine("mandarin-audio (Mandarin's audio engine) isn't here: pass --engine"); return 3; }
        data ??= Environment.UserName == "root" ? "/var/lib/mandarin-bridge"
            : Path.Combine(Environment.GetEnvironmentVariable("XDG_CONFIG_HOME") is { Length: > 0 } x ? x : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config"), "mandarin-bridge");
        var bridge = new Bridge(new Options(port, data, engine, ffmpeg, asound, device, address, nmcli, setupAfter), Log);
        bridge.Start();
        using var done = new ManualResetEventSlim();
        AppDomain.CurrentDomain.ProcessExit += (_, _) => { bridge.Stop(); done.Set(); };
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; done.Set(); };
        done.Wait();
        bridge.Stop();
        return 0;
    }

    private static readonly object logLock = new();

    public static void Log(string line)
    {
        lock (logLock) Console.Error.WriteLine(DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + " " + line);
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
