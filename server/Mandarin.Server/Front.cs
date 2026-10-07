// Front.cs — the front door's plumbing: the Node server behind it (started,
// waited for, stopped), and how a request is passed to it.
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using Yarp.ReverseProxy.Forwarder;

namespace Mandarin.Server;

internal static partial class Front
{
    private static readonly object logLock = new();

    // Stamped as the Node server stamps its lines.
    public static void Log(string s)
    {
        lock (logLock) Console.WriteLine(DateTime.UtcNow.ToString("HH:mm:ss") + " " + s);
    }

    public static int FreeLoopbackPort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        int port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    // The folder with launcher.js: beside this program, or one or two up
    // (the image keeps it in /app/server/bin; a checkout builds into server/bin).
    public static string FindAppDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (int i = 0; dir != null && i < 6; i++, dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "launcher.js")) && File.Exists(Path.Combine(dir.FullName, "index.js"))) return dir.FullName;
        return Directory.GetCurrentDirectory();
    }

    /*
     * The Node server, through its launcher (which applies an in-app update
     * across a restart, as before): on 127.0.0.1 only, at this port, its own
     * output straight through to ours.
     */
    public static Process StartNode(string appDir, int internalPort, string frontKey)
    {
        var psi = new ProcessStartInfo(Environment.GetEnvironmentVariable("NODE_BIN") ?? "node")
        {
            WorkingDirectory = appDir,
            UseShellExecute = false,
        };
        psi.ArgumentList.Add(Path.Combine(appDir, "launcher.js"));
        psi.Environment["INTERNAL_PORT"] = internalPort.ToString();
        psi.Environment["MANDARIN_FRONT"] = "csharp";
        psi.Environment["MANDARIN_FRONT_KEY"] = frontKey;
        var proc = Process.Start(psi) ?? throw new InvalidOperationException("couldn't start node");
        Log($"[server] started the Node server (pid {proc.Id}) from {appDir}");
        return proc;
    }

    public static async Task<bool> WaitForUpstream(Uri upstream, Process? node, TimeSpan within)
    {
        var until = DateTime.UtcNow + within;
        while (DateTime.UtcNow < until)
        {
            if (node != null && node.HasExited) return false;
            try
            {
                using var c = new TcpClient();
                await c.ConnectAsync(upstream.Host, upstream.Port).WaitAsync(TimeSpan.FromSeconds(2));
                return true;
            }
            catch (Exception) { await Task.Delay(200); }
        }
        return false;
    }

    [LibraryImport("libc", EntryPoint = "kill", SetLastError = true)]
    private static partial int Kill(int pid, int sig);

    // Asked to stop (SIGTERM), as Docker asks; made to after ten seconds.
    public static void StopNode(Process node)
    {
        if (node.HasExited) return;
        try
        {
            if (OperatingSystem.IsWindows()) node.Kill();
            else Kill(node.Id, 15);
            if (!node.WaitForExit(10000)) node.Kill(entireProcessTree: true);
        }
        catch (Exception) { /* already gone */ }
    }

    // To the Node server: no proxy of the machine's own, nothing decoded or
    // redirected on the way, cookies passed as they are.
    public static HttpMessageInvoker Invoker() => new(new SocketsHttpHandler
    {
        UseProxy = false,
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.None,
        UseCookies = false,
        ConnectTimeout = TimeSpan.FromSeconds(15),
        PooledConnectionIdleTimeout = TimeSpan.FromMinutes(1),
        EnableMultipleHttp2Connections = false,
    });
}

/*
 * A request as it came, with who sent it. The Node server tells home from away
 * by the caller's address (lib/server/auth.js, clientIp): from this machine it
 * believes the last X-Forwarded-For, as a proxy here (the built-in Tailscale,
 * `tailscale serve`) speaks for the device behind it. So the same is done
 * here: the caller is that header's last address when the request came from
 * this machine, else the connection's own — and only that goes on, so no
 * device can claim to be at home by sending the header itself.
 */
internal sealed class ForwardTransformer : HttpTransformer
{
    public override async ValueTask TransformRequestAsync(HttpContext ctx, HttpRequestMessage proxy, string prefix, CancellationToken ct)
    {
        await base.TransformRequestAsync(ctx, proxy, prefix, ct);
        proxy.Headers.Remove("X-Forwarded-For");
        proxy.Headers.TryAddWithoutValidation("X-Forwarded-For", ClientIp(ctx));
        // The address the request was made to, so links and redirects read as before.
        proxy.Headers.Host = ctx.Request.Host.Value;
        if (!IsLoopback(ctx.Connection.RemoteIpAddress)) proxy.Headers.Remove("X-Forwarded-Proto");
    }

    public static string ClientIp(HttpContext ctx)
    {
        var remote = ctx.Connection.RemoteIpAddress;
        string bare = Bare(remote);
        if (IsLoopback(remote))
        {
            var fwd = ctx.Request.Headers["X-Forwarded-For"].ToString()
                .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
            if (fwd.Length > 0) return Bare(fwd[^1]);
        }
        return bare;
    }

    private static bool IsLoopback(IPAddress? a) => a != null && IPAddress.IsLoopback(a.IsIPv4MappedToIPv6 ? a.MapToIPv4() : a);
    private static string Bare(IPAddress? a) => a == null ? "" : (a.IsIPv4MappedToIPv6 ? a.MapToIPv4() : a).ToString();
    private static string Bare(string s) => s.StartsWith("::ffff:", StringComparison.OrdinalIgnoreCase) ? s[7..] : s;
}

// What C# answers itself, ahead of the Node server. Each part moved here
// says so in server/README.md and keeps the Node server's tests passing.
internal static class Routes
{
    public static void Map(WebApplication app, string version)
    {
        // Which server answered, for the tests and for a look from a browser.
        app.MapGet("/server-info", () => Results.Json(new ServerInfo("C#", version), ServerJson.Default.ServerInfo));
    }
}

internal sealed record ServerInfo(string server, string version);

[System.Text.Json.Serialization.JsonSerializable(typeof(ServerInfo))]
internal sealed partial class ServerJson : System.Text.Json.Serialization.JsonSerializerContext;
