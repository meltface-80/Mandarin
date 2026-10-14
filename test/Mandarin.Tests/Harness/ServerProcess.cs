using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;

namespace Mandarin.Tests;

/// <summary>
/// The C# server alone, as the image runs it (test/server.js's start, in C#): started on a port of
/// the test's own with the suite's environment (nothing off this machine, no identification scan, no
/// sound devices, no update checks) and the test's own over it, waited for, stopped.
/// </summary>
public sealed class ServerProcess
{
    /// <summary>The repository's root (where public/ is).</summary>
    public static readonly string Root = FindRoot();

    /// <summary>The program the tests start: MANDARIN_SERVER_BIN, or the one server/build.sh made.</summary>
    public static readonly string Bin = Environment.GetEnvironmentVariable("MANDARIN_SERVER_BIN") is { Length: > 0 } b ? b : Path.Combine(Root, "server", "bin", "mandarin-server");

    /// <summary>Why a test can't run the server (it isn't built), or null.</summary>
    public static string? NotBuilt => File.Exists(Bin) ? null : "the C# server isn't built (server/build.sh): " + Bin;

    // The servers this process started, by port: one a timed-out test left running is ended by the
    // next start on its port, and none outlives the test process.
    private static readonly ConcurrentDictionary<int, Process> Live = new();

    static ServerProcess()
    {
        AppDomain.CurrentDomain.ProcessExit += (_, _) => { foreach (var p in Live.Values) { try { p.Kill(true); } catch (InvalidOperationException) { } } };
    }

    /// <summary>"http://127.0.0.1:port".</summary>
    public string Base { get; }

    /// <summary>The key its private addresses are asked with (X-Mandarin-Front-Key).</summary>
    public string Key { get; }

    /// <summary>The program's process.</summary>
    public Process Proc { get; }

    /// <summary>Every line the program has printed, kept as well as passed to the test's output.</summary>
    public IReadOnlyList<string> Logs { get { lock (logs) return [.. logs]; } }

    private readonly List<string> logs = [];

    /// <summary>How it ended (its exit code), once it has; null while it runs.</summary>
    public int? Exited => Proc.HasExited ? Proc.ExitCode : null;

    private ServerProcess(string @base, string key, Process proc) { Base = @base; Key = key; Proc = proc; }

    /// <summary>The server started and answering on <paramref name="port"/>; <paramref name="env"/> over the suite's.</summary>
    public static async Task<ServerProcess> Start(int port, string musicDir, string dataDir, IDictionary<string, string>? env = null, string? bin = null, int timeoutMs = 60000)
    {
        var key = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(24));
        var psi = new ProcessStartInfo(bin ?? Bin) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        var e = new Dictionary<string, string>
        {
            ["PORT"] = port.ToString(System.Globalization.CultureInfo.InvariantCulture), ["MUSIC_DIR"] = musicDir, ["DATA_DIR"] = dataDir,
            ["SERVER_IP"] = "127.0.0.1", ["MANDARIN_APP_DIR"] = Root, ["MANDARIN_FRONT_KEY"] = key, ["IDENTIFY"] = "0", ["LOCAL_AUDIO"] = "0",
            ["UPDATE_CHECK"] = "false", ["UPNP_DISCOVERY"] = "0", ["ITUNES_URL"] = "http://127.0.0.1:9", ["TAGCHECK"] = "0"
        };
        if (Environment.GetEnvironmentVariable("ALLOW_NETWORK") is not { Length: > 0 }) e["MANDARIN_LOOPBACK_ONLY"] = "1";
        foreach (var (k, v) in env ?? new Dictionary<string, string>()) e[k] = v;
        foreach (var (k, v) in e) psi.Environment[k] = v;
        // The program is its own file (Updater.cs BinPath): never the suite's, told by the environment.
        psi.Environment.Remove("MANDARIN_SERVER_BIN");
        Directory.CreateDirectory(dataDir);
        var @base = "http://127.0.0.1:" + port;
        if (Live.TryRemove(port, out var left) && !left.HasExited)
        {
            try { left.Kill(true); } catch (InvalidOperationException) { }
            await left.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)).ContinueWith(_ => { });
        }
        // Whatever answers on the port must be the server started here.
        if (await Answers(@base)) throw new InvalidOperationException("port " + port + " is taken: another server answers there");
        var proc = Process.Start(psi) ?? throw new InvalidOperationException("couldn't start " + psi.FileName);
        Live[port] = proc;
        var srv = new ServerProcess(@base, key, proc);
        var output = TestContext.Current.TestOutputHelper;
        void Line(string? l)
        {
            if (l == null) return;
            lock (srv.logs) srv.logs.Add(l);
            try { output?.WriteLine(l); } catch (InvalidOperationException) { /* the test has ended: the line is kept, not shown */ }
        }
        proc.OutputDataReceived += (_, a) => Line(a.Data);
        proc.ErrorDataReceived += (_, a) => Line(a.Data);
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
        var t0 = Stopwatch.StartNew();
        for (; ; )
        {
            if (proc.HasExited) throw new InvalidOperationException($"the C# server exited before it listened (code {proc.ExitCode})");
            try
            {
                var r = await Http.Get(@base + "/server-info");
                if (r.Status == 200 && (string?)r.Json?["server"] == "C#") break;
            }
            catch (HttpRequestException) { /* not yet */ }
            catch (TimeoutException) { /* not yet */ }
            if (t0.ElapsedMilliseconds > timeoutMs) { proc.Kill(true); throw new TimeoutException("the C# server didn't answer on " + port + " within " + timeoutMs + " ms"); }
            await Task.Delay(100);
        }
        return srv;
    }

    /// <summary>Stopped: asked to (SIGTERM), then killed if it hasn't gone in eight seconds.</summary>
    public async Task Stop()
    {
        if (Proc.HasExited) return;
        try { Process.Start("kill", ["-TERM", Proc.Id.ToString(System.Globalization.CultureInfo.InvariantCulture)])?.WaitForExit(2000); } catch (System.ComponentModel.Win32Exception) { }
        try { await Proc.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8)); }
        catch (TimeoutException) { try { Proc.Kill(true); } catch (InvalidOperationException) { } await Proc.WaitForExitAsync(); }
    }

    private static async Task<bool> Answers(string @base)
    {
        using var cts = new CancellationTokenSource(1000);
        try { await Http.Client.GetAsync(@base + "/server-info", cts.Token); return true; }
        catch (HttpRequestException) { return false; }
        catch (OperationCanceledException) { return false; }
    }

    private static string FindRoot()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d != null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, "public", "index.html")) && Directory.Exists(Path.Combine(d.FullName, "server"))) return d.FullName;
        throw new InvalidOperationException("the repository's root isn't above " + AppContext.BaseDirectory);
    }
}
