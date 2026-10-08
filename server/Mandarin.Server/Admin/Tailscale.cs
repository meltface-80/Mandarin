// Tailscale.cs — Tailscale built into the server (v0.8.22), from
// lib/server/tsnode.js rule for rule, run here once the Node server has handed
// it over (Jobs.cs), so the server stays on your tailnet while the Node server
// starts again (an update, Restart, a restore).
//
// The image carries MusicD's own Tailscale engine (android/musicdnet, started
// with -server). Signed in once, from Settings → Away from home or with
// TS_AUTHKEY, it makes this server a machine on your tailnet by itself: it
// takes the tailnet's port (the server's own) and passes each request to the
// server on 127.0.0.1, naming the caller's tailnet address in X-Forwarded-For.
// The engine is driven over HTTP on 127.0.0.1 with a secret only the two know
// (MUSICDNET_SECRET); it stops when its stdin closes. Its state lives in the
// data folder, so a new container is the same machine. TAILSCALE=off leaves it
// out. An install updated in place, with no engine in its image, downloads one
// (checked against the release's SHA256SUMS) into the data folder, again
// whenever the server is updated. A node that says Running but isn't online
// is asked to rebind, then started afresh.
using System.Diagnostics;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Admin;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Tailscale(string imageBin, string dir, int port, string version, Action<string> log, int rebindMs = 60000, int restartMs = 240000)
{
    private const string EngineUrl = "https://github.com/meltface-80/Mandarin/releases/download/engine";
    private const int PollMs = 5000;
    private static readonly string? Arch = RuntimeInformation.ProcessArchitecture switch
    {
        Architecture.X64 => "amd64",
        Architecture.Arm64 => "arm64",
        _ => null
    };

    public readonly string Dir = dir;
    private readonly object gate = new();
    private Process? proc;
    private int? ctl;
    private string? secret;
    private JsObj? last;
    private string? error, downloadError;
    private Task<bool>? downloading;
    private bool stopping;
    private CancellationTokenSource? timer;
    private int restarts;
    private long? badSince;
    private long rebound;          // when the rebind was asked for; 0 none (or done with)

    private static readonly HttpClient Http = new(new SocketsHttpHandler { UseProxy = false });

    private static string Env(string k) => Environment.GetEnvironmentVariable(k) ?? "";

    /* The engine the image carries, else the one downloaded into the data folder. */
    private string Bin => Executable(imageBin) ? imageBin : DownloadedBin;
    private string DownloadedBin => Path.Combine(Path.GetDirectoryName(Dir) ?? Dir, "bin", "musicdnet");

    private static bool Executable(string p)
    {
        try
        {
            if (!File.Exists(p)) return false;
            if (OperatingSystem.IsWindows()) return true;
            return (File.GetUnixFileMode(p) & (UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute)) != 0;
        }
        catch (Exception) { return false; }
    }

    /* It can run here: in the image, or downloadable for this platform (Docker, or TS_ENGINE_URL set; Linux, x64 or arm64). */
    public bool Available
    {
        get
        {
            if (Env("TAILSCALE").ToLowerInvariant() == "off") return false;
            if (Executable(imageBin)) return true;
            var may = Env("DOCKER") == "1" || Env("TS_ENGINE_URL").Length > 0;
            return may && OperatingSystem.IsLinux() && Arch != null;
        }
    }

    public bool Enabled
    {
        get
        {
            var s = Extras.Labels.Setting("tailscale");
            return !Js.Truthy(s) || !(s is JsObj o && Js.StrictEq(o["enabled"], false));
        }
    }

    private static string Hostname() => Js.Trim(Env("TS_HOSTNAME").Length > 0 ? Env("TS_HOSTNAME") : "musicd") is { Length: > 0 } h ? h : "musicd";

    /* "http://100.x.y.z:3500" once it's joined and serving, else null. */
    public string? Address()
    {
        lock (gate)
        {
            if (proc == null || last == null || !Js.StrictEq(last["state"], "Running") || !Js.Truthy(last["serving"])) return null;
            var ip = (last["ips"] as List<object?> ?? []).OfType<string>().FirstOrDefault(a => Ipv4().IsMatch(a));
            return ip != null ? $"http://{ip}:{port}" : null;
        }
    }
    [GeneratedRegex(@"^\d+\.\d+\.\d+\.\d+\z")] private static partial Regex Ipv4();

    /* For the page: what it's doing, and the sign-in link while one is needed. */
    public JsObj Status()
    {
        JsObj st;
        bool running, isDownloading;
        string? err;
        lock (gate) { st = last ?? new JsObj(); running = proc != null; isDownloading = downloading != null; err = error; }
        var o = new JsObj();
        o["available"] = Available;
        o["enabled"] = Enabled;
        o["running"] = running;
        o["state"] = running ? (Js.Truthy(st["state"]) ? st["state"] : "Starting") : isDownloading ? "Downloading" : "Stopped";
        o["auth_url"] = Js.Truthy(st["auth_url"]) ? st["auth_url"] : null;
        o["ips"] = st["ips"] is List<object?> ips ? ips : new List<object?>();
        o["dns_name"] = Js.Truthy(st["dns_name"]) ? TrailingDot().Replace(Js.Str(st["dns_name"]), "", 1) : null;
        o["serving"] = Js.Truthy(st["serving"]);
        o["online"] = st["online"] is Undef ? null : Js.Truthy(st["online"]);
        o["health"] = st["health"] is List<object?> h ? h : new List<object?>();
        o["address"] = Address();
        o["error"] = Js.Truthy(err) ? err : Js.Truthy(st["error"]) ? st["error"] : Js.Truthy(downloadError) ? downloadError : null;
        o["version"] = Js.Truthy(st["version"]) ? st["version"] : null;
        o["hostname"] = Hostname();
        return o;
    }
    [GeneratedRegex(@"\.\z")] private static partial Regex TrailingDot();

    /*
     * No engine in the image: the downloaded one, fetched if it isn't there yet
     * or was fetched for an older version of the server. True when there's one to run.
     */
    private async Task<bool> EnsureEngine()
    {
        if (Executable(imageBin)) return true;
        var bin = DownloadedBin;
        var marker = bin + ".version";
        string? have = null;
        try { have = File.ReadAllText(marker).Trim(); } catch (Exception) { /* none yet */ }
        if (Executable(bin) && have == version) return true;
        Task<bool> d;
        lock (gate) d = downloading ??= Download(bin, marker);
        try
        {
            await d;
            downloadError = null;
        }
        catch (Exception e)
        {
            downloadError = "Couldn't download Tailscale: " + e.Message;
            log($"[tailscale] {downloadError}");
            return Executable(bin);   // an older one still runs
        }
        finally { lock (gate) if (downloading == d) downloading = null; }
        return true;
    }

    private async Task<bool> Download(string bin, string marker)
    {
        await Task.Yield();
        var b = (Env("TS_ENGINE_URL").Length > 0 ? Env("TS_ENGINE_URL") : EngineUrl).TrimEnd('/');
        var name = $"musicdnet-linux-{Arch}.gz";
        log($"[tailscale] downloading the Tailscale engine ({name})…");
        async Task<byte[]> Get(string u)
        {
            using var r = await Http.GetAsync(u);
            if (!r.IsSuccessStatusCode) throw new InvalidOperationException($"{u.Split('/')[^1]}: HTTP {(int)r.StatusCode}");
            return await r.Content.ReadAsByteArrayAsync();
        }
        var sums = Encoding.UTF8.GetString(await Get($"{b}/SHA256SUMS"));
        var want = sums.Split('\n').Select(l => Regex.Split(l.Trim(), @"\s+")).FirstOrDefault(p => p.Length > 1 && p[1] == name)?[0];
        if (want == null) throw new InvalidOperationException($"no checksum for {name}");
        var gz = await Get($"{b}/{name}");
        if (Convert.ToHexString(SHA256.HashData(gz)).ToLowerInvariant() != want) throw new InvalidOperationException("the download was damaged (checksum mismatch)");
        Directory.CreateDirectory(Path.GetDirectoryName(bin)!);
        var tmp = bin + ".tmp";
        using (var src = new GZipStream(new MemoryStream(gz), CompressionMode.Decompress))
        using (var dst = File.Create(tmp)) src.CopyTo(dst);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(tmp, (UnixFileMode)0b111_101_101);
        File.Move(tmp, bin, overwrite: true);
        File.WriteAllText(marker, version);
        log($"[tailscale] engine ready ({Math.Round(gz.Length / 1048576.0)} MB download)");
        return true;
    }

    public async Task Start()
    {
        lock (gate) { if (proc != null) return; }
        if (!Available || !Enabled) return;
        stopping = false;
        if (!await EnsureEngine()) return;
        Process p;
        var first = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var tail = new List<string>();
        lock (gate)
        {
            if (proc != null || stopping) return;
            Directory.CreateDirectory(Dir);
            if (!OperatingSystem.IsWindows()) try { File.SetUnixFileMode(Dir, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute); } catch (Exception) { /* not ours to change */ }
            secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
            var psi = new ProcessStartInfo(Bin) { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
            psi.ArgumentList.Add("-server");
            psi.ArgumentList.Add("-dir");
            psi.ArgumentList.Add(Dir);
            psi.Environment["MUSICDNET_SECRET"] = secret;
            psi.Environment["HOME"] = Dir;
            // Given to the engine through its API, not inherited.
            psi.Environment.Remove("TS_AUTHKEY");
            try { p = Process.Start(psi) ?? throw new InvalidOperationException("couldn't start the engine"); }
            catch (Exception e) { error = e.Message; return; }
            proc = p;
        }
        p.EnableRaisingEvents = true;
        // Kept flowing (a full pipe would stall it); the first line says where its control API is.
        _ = Task.Run(async () =>
        {
            try
            {
                var buf = new StringBuilder();
                var chunk = new char[4096];
                int n;
                while ((n = await p.StandardOutput.ReadAsync(chunk, 0, chunk.Length)) > 0)
                {
                    if (first.Task.IsCompleted) continue;
                    buf.Append(chunk, 0, n);
                    var s = buf.ToString();
                    var i = s.IndexOf('\n');
                    if (i >= 0) first.TrySetResult(s[..i].Trim());
                }
            }
            catch (Exception) { /* closed */ }
            first.TrySetException(new InvalidOperationException("the engine didn't start"));
        });
        _ = Task.Run(async () =>
        {
            try
            {
                var chunk = new char[4096];
                int n;
                while ((n = await p.StandardError.ReadAsync(chunk, 0, chunk.Length)) > 0)
                    lock (tail) { tail.Add(new string(chunk, 0, n)); if (tail.Count > 20) tail.RemoveAt(0); }
            }
            catch (Exception) { /* closed */ }
        });
        p.Exited += (_, _) =>
        {
            lock (gate)
            {
                if (proc == p) { proc = null; ctl = null; }
                timer?.Cancel();
                if (stopping) return;
                string said;
                lock (tail) said = string.Join("", tail).Trim();
                if (said.Length > 300) said = said[^300..];
                int code;
                try { code = p.ExitCode; } catch (Exception) { code = -1; }
                error = $"stopped ({code}){(said.Length > 0 ? ": " + said : "")}";
                log($"[tailscale] {error}");
                // Started again, more slowly each time it fails.
                var wait = Math.Min(60000, 2000 * (1 << Math.Min(restarts++, 5)));
                var cts = timer = new CancellationTokenSource();
                _ = Task.Delay(wait, cts.Token).ContinueWith(t => { if (!t.IsCanceled) _ = Start(); }, TaskScheduler.Default);
            }
        };
        try
        {
            var line = await first.Task.WaitAsync(TimeSpan.FromSeconds(10)).ContinueWith(t => t.IsCompletedSuccessfully ? t.Result
                : throw new InvalidOperationException("the engine didn't start"), TaskScheduler.Default);
            var m = Regex.Match(line, @"^CONTROL (\d+)");
            if (!m.Success) throw new InvalidOperationException("unexpected first line: " + line);
            lock (gate) { if (proc == p) ctl = int.Parse(m.Groups[1].Value); }
            error = null;
            var body = new JsObj();
            body["Hostname"] = Hostname();
            body["AuthKey"] = Env("TS_AUTHKEY");
            body["ControlURL"] = Env("TS_CONTROL_URL");
            await Call("POST", "/start", body, 30000);
            log($"[tailscale] built-in Tailscale started as \"{Hostname()}\"");
        }
        catch (Exception e)
        {
            error = e.Message;
            log($"[tailscale] couldn't start: {e.Message}");
        }
        _ = Poll();
    }

    /* Every few seconds: how it is, and once joined, serving the server's port. */
    private async Task Poll()
    {
        CancellationTokenSource cts;
        lock (gate)
        {
            timer?.Cancel();
            if (proc == null || stopping) return;
            cts = timer = new CancellationTokenSource();
        }
        try
        {
            var st = await Call("GET", "/status", null, 4000);
            object? was;
            lock (gate) { was = last?["state"]; last = st; }
            if (Js.StrictEq(st["state"], "Running") && !Js.Truthy(st["serving"]))
            {
                await Call("POST", $"/serve?port={port}&upstream={Uri.EscapeDataString("http://127.0.0.1:" + port)}", null, 10000);
                var now = await Call("GET", "/status", null, 4000);
                lock (gate) last = now;
                restarts = 0;
                log($"[tailscale] on your tailnet: {Address() ?? "(no address yet)"}{(Js.Truthy(now["dns_name"]) ? " — " + TrailingDot().Replace(Js.Str(now["dns_name"]), "", 1) : "")}");
            }
            else if (!Js.StrictEq(st["state"], was) && Js.StrictEq(st["state"], "NeedsLogin"))
                log("[tailscale] waiting to be signed in: Settings → Setup → Away from home");
            if (await Watch(st)) return;
        }
        catch (Exception) { /* asked again shortly */ }
        if (cts.IsCancellationRequested) return;
        _ = Task.Delay(PollMs, cts.Token).ContinueWith(t => { if (!t.IsCanceled) _ = Poll(); }, TaskScheduler.Default);
    }

    /* The watchdog: true when the engine was started afresh (the poll is Start()'s then). */
    private async Task<bool> Watch(JsObj st)
    {
        var health = st["health"] as List<object?>;
        var bad = Js.StrictEq(st["state"], "Running") && (Js.StrictEq(st["online"], false) || (health != null && health.Count > 0));
        if (!bad) { badSince = null; rebound = 0; return false; }
        var now = Environment.TickCount64;
        if (badSince == null) { badSince = now; return false; }
        var since = now - badSince.Value;
        var why = Js.StrictEq(st["online"], false) ? "not online on the tailnet" : "Tailscale warns: " + string.Join("; ", health!.Select(x => Js.Str(x)));
        // A rebind first; the fresh start only once that has had its time.
        if (rebound > 0 && now - rebound >= restartMs)
        {
            log($"[tailscale] {why} for {Math.Round(since / 1000.0)} s after a rebind: starting the engine afresh");
            badSince = null;
            rebound = 0;
            await Restart();
            return true;
        }
        if (rebound == 0 && since >= rebindMs)
        {
            rebound = now;
            log($"[tailscale] {why} for {Math.Round(since / 1000.0)} s: asking Tailscale to rebind");
            try { await Call("POST", "/rebind", null, 12000); } catch (Exception e) { log($"[tailscale] rebind: {e.Message}"); }
        }
        return false;
    }

    /* A sign-in link (a new one: after signing out, or an expired key). */
    public async Task<JsObj> Login()
    {
        if (proc == null) await Start();
        if (proc == null) throw new Backup.Refused(Available ? "Tailscale is switched off" : "Tailscale isn't in this install", 500);
        var st = await Call("POST", "/login", null, 20000);
        lock (gate)
        {
            var merged = new JsObj();
            if (last != null) foreach (var k in last.Keys) merged[k] = last[k];
            foreach (var k in st.Keys) merged[k] = st[k];
            last = merged;
        }
        return Status();
    }

    public async Task<JsObj> Logout()
    {
        if (proc == null) return Status();
        await Call("POST", "/logout", null, 15000);
        // The port it served goes with it: started afresh, it asks to be signed in again.
        await Restart();
        return Status();
    }

    public async Task<JsObj> SetEnabled(bool on)
    {
        var v = new JsObj();
        v["enabled"] = on;
        Extras.Labels.SetSetting("tailscale", v);
        if (on) await Start(); else Stop();
        return Status();
    }

    public async Task Restart()
    {
        Stop();
        await Task.Delay(300);
        await Start();
    }

    public void Stop()
    {
        Process? p;
        lock (gate)
        {
            stopping = true;
            timer?.Cancel();
            p = proc;
            proc = null; ctl = null; last = null;
        }
        if (p == null) return;
        try { p.StandardInput.Close(); } catch (Exception) { /* gone */ }
        _ = Task.Delay(1500).ContinueWith(_ => { try { if (!p.HasExited) p.Kill(); } catch (Exception) { /* gone */ } }, TaskScheduler.Default);
    }

    /* The engine's control API: JSON in and out, the secret in X-Secret; its error, or HTTP <n>. */
    private async Task<JsObj> Call(string method, string pathQ, JsObj? body, int timeoutMs)
    {
        int? port0;
        string? key;
        lock (gate) { port0 = ctl; key = secret; }
        if (port0 == null) throw new InvalidOperationException("not running");
        using var cts = new CancellationTokenSource(timeoutMs);
        using var req = new HttpRequestMessage(new HttpMethod(method), $"http://127.0.0.1:{port0}{pathQ}");
        req.Headers.TryAddWithoutValidation("X-Secret", key);
        if (body != null) req.Content = new StringContent(Js.Json(body) ?? "{}", Encoding.UTF8, "application/json");
        HttpResponseMessage r;
        try { r = await Http.SendAsync(req, cts.Token); }
        catch (OperationCanceledException) { throw new InvalidOperationException("This operation was aborted"); }
        catch (HttpRequestException) { throw new InvalidOperationException("fetch failed"); }
        using (r)
        {
            JsObj j;
            try { j = JsJson.Parse(await r.Content.ReadAsStringAsync(cts.Token)) as JsObj ?? new JsObj(); }
            catch (Exception) { j = new JsObj(); }
            if (!r.IsSuccessStatusCode) throw new InvalidOperationException(Js.Truthy(j["error"]) ? Js.Str(j["error"]) : $"HTTP {(int)r.StatusCode}");
            return j;
        }
    }
}
