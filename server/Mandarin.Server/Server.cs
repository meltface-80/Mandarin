// Server.cs — the server's own plumbing: its version and data folder, its log,
// Restart and Shut down (starting again in the same process), the app's
// folder, and who a request came from. Front.cs until v0.9.2, named for the
// front door it was while the Node server stood behind it (v0.8.1 to v0.8.50).
using System.Net;
using System.Runtime.InteropServices;

namespace Mandarin.Server;

internal static partial class Server
{
    private static readonly object logLock = new();

    /* This program's version (Program.cs). */
    public static string Version = "0.0.0";
    /* The data folder (Program.cs). */
    public static string DataDir = "";

    /* The code this program leaves with when it couldn't start again in place (Docker's restart policy starts it). */
    public const int StartAgainCode = 76;

    /*
     * Restart and Shut down asked for here (PowerRoutes.cs, v0.8.31), or an
     * update put in place (Admin/Updater.cs): this program starts again in this
     * same process (Restart) or leaves with 0 (Shut down).
     */
    public enum Leave { No, Restart, ShutDown }
    private static int leaving;
    public static Leave Leaving => (Leave)Volatile.Read(ref leaving);
    public static Action? StopApp { get; set; }
    /* The first ask wins; true if this one was it. */
    public static bool LeaveBy(Leave how)
    {
        if (Interlocked.CompareExchange(ref leaving, (int)how, (int)Leave.No) != (int)Leave.No) return false;
        Log(how == Leave.Restart ? "[power] restart asked for from Settings" : "[power] shut down asked for from Settings");
        return true;
    }

    [LibraryImport("libc", EntryPoint = "getuid")]
    private static partial uint GetUid();
    /* This user's id (launchctl's gui/<uid> domain). */
    public static uint Uid() => GetUid();

    [LibraryImport("libc", EntryPoint = "execv", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial int Execv(string path, string?[] argv);

    /*
     * This program started again in this same process, from its file as it is
     * now (a newer one put in its place), with the same arguments: nothing
     * outside (Docker, tini, launchd) has to notice. Returns only if it couldn't.
     */
    public static void StartAgain(string[] args)
    {
        if (OperatingSystem.IsWindows() || Environment.ProcessPath is not { Length: > 0 } self) return;
        Log($"[server] starting again from {self}");
        var argv = new string?[args.Length + 2];
        argv[0] = self;
        args.CopyTo(argv, 1);
        argv[^1] = null;
        // On every core it started with again, not those a split kept it to (Cpu.Restore).
        Cpu.Restore();
        Console.Out.Flush();
        Console.Error.Flush();
        Execv(self, argv);
        Log($"[server] couldn't start again (error {Marshal.GetLastPInvokeError()})");
        Cpu.Resume();
    }

    // Stamped as the Node server stamped its lines. A line made already: kept for diagnostics by its tag alone (item 121).
    public static void Log(string s)
    {
        lock (logLock) Console.WriteLine(DateTime.UtcNow.ToString("HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture) + " " + s);
        if (Diagnostics.On) Diagnostics.Record(Diagnostics.TagOnly(s));
    }

    // A line written here ($"..."): kept for diagnostics with its words, and only the values that can't be anyone's (LogLine.cs).
    public static void Log(LogLine line)
    {
        var s = line.Text();
        lock (logLock) Console.WriteLine(DateTime.UtcNow.ToString("HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture) + " " + s);
        Diagnostics.Record(line.Kept());
    }

    // The app's folder, with the page (public/index.html): beside this program,
    // or one or two up (the image keeps it in /app/server/bin; a checkout builds
    // into server/bin).
    public static string FindAppDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (int i = 0; dir != null && i < 6; i++, dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "public", "index.html"))) return dir.FullName;
        return Directory.GetCurrentDirectory();
    }
}

/*
 * Who sent a request. Home is told from away by the caller's address, as the
 * Node server told it (lib/server/auth.js, clientIp): from this machine the
 * last X-Forwarded-For is believed, as a proxy here (the built-in Tailscale,
 * `tailscale serve`) speaks for the device behind it; else the connection's
 * own address, so no device can claim to be at home by sending the header.
 * A proxy here that names the caller another way (X-Real-IP, Forwarded's
 * for=) is believed too, and one that names none but is plainly a proxy
 * (X-Forwarded-Host) leaves the caller unknown: never this machine, so never
 * home (item 172: nginx with only X-Real-IP made the internet home).
 */
internal static class Caller
{
    /* What a proxy that doesn't say who asked is given: no address, so neither home nor the tailnet. */
    public const string Unknown = "unknown";

    public static string ClientIp(HttpContext ctx)
    {
        var remote = ctx.Connection.RemoteIpAddress;
        string bare = Bare(remote);
        if (IsLoopback(remote))
        {
            var h = ctx.Request.Headers;
            var fwd = h["X-Forwarded-For"].ToString()
                .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
            if (fwd.Length > 0) return Bare(fwd[^1]);
            var real = h["X-Real-IP"].ToString().Trim();
            if (real.Length > 0) return Bare(real);
            if (ForwardedFor(h["Forwarded"].ToString()) is { } f) return f;
            if (h.ContainsKey("Forwarded") || h.ContainsKey("X-Forwarded-Host")) return Unknown;
        }
        return bare;
    }

    // The last for= of a Forwarded header (RFC 7239), the proxy nearest this
    // server: "for=1.2.3.4", for="[2001:db8::1]:4711", for="1.2.3.4:80".
    private static string? ForwardedFor(string header)
    {
        string? last = null;
        foreach (var element in header.Split(','))
            foreach (var pair in element.Split(';'))
            {
                int eq = pair.IndexOf('=');
                if (eq < 0 || !pair[..eq].Trim().Equals("for", StringComparison.OrdinalIgnoreCase)) continue;
                var v = pair[(eq + 1)..].Trim().Trim('"');
                if (v.StartsWith('[')) { int end = v.IndexOf(']'); v = end > 0 ? v[1..end] : v[1..]; }
                else if (v.Count(ch => ch == ':') == 1) v = v[..v.IndexOf(':')];
                last = v.Length > 0 ? Bare(v) : Unknown;
            }
        return last;
    }

    private static bool IsLoopback(IPAddress? a) => a != null && IPAddress.IsLoopback(a.IsIPv4MappedToIPv6 ? a.MapToIPv4() : a);
    private static string Bare(IPAddress? a) => a == null ? "" : (a.IsIPv4MappedToIPv6 ? a.MapToIPv4() : a).ToString();
    private static string Bare(string s) => s.StartsWith("::ffff:", StringComparison.OrdinalIgnoreCase) ? s[7..] : s;
}

// Which server answered (the tests', and a look from a browser).
internal static class Routes
{
    public static void Map(WebApplication app, string version)
    {
        // Which server answered, for the tests and for a look from a browser; and this run of it (v0.8.50: a test sees a restart by it).
        app.MapMethods("/server-info", Http.GetOrHead, () => Results.Json(new ServerInfo("C#", version, Library.Boot), ServerJson.Default.ServerInfo));
    }
}

internal sealed record ServerInfo(string server, string version, string boot);

[System.Text.Json.Serialization.JsonSerializable(typeof(ServerInfo))]
internal sealed partial class ServerJson : System.Text.Json.Serialization.JsonSerializerContext;
