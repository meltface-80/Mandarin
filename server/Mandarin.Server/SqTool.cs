// SqTool.cs — SQ-tool, inside Mandarin (item 288): the recorder and comparer that proves a player bit-perfect, its
// own page and analysis exactly as it is standalone (sq-tool/, Python with numpy), at /sq-tool/ behind Mandarin's
// sign-in. Mandarin starts it the first time it is opened, on a port of this computer only (127.0.0.1), with
// Mandarin's music folder and its own data folder (<data>/sq-tool), and hands every request under /sq-tool/ to it,
// streamed both ways (a recording's WAV, a spectrogram, an upload). Where it can't start (no Python 3 with numpy),
// its page says why and what to install.
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace Mandarin.Server;

internal static class SqTool
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false }) { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly SemaphoreSlim starting = new(1, 1);
    private static Process? proc;
    private static int port;
    private static string appDir = "", dataDir = "";
    private static string why = "";

    /* The Python that runs it (SQTOOL_PYTHON, else python3 on the PATH). */
    private static string Python => Environment.GetEnvironmentVariable("SQTOOL_PYTHON") is { Length: > 0 } p ? p : "python3";

    // The request headers handed on, and the answer's handed back: what a page, a download and a byte range need.
    private static readonly string[] Asked = ["Content-Type", "Range", "Accept", "If-None-Match", "If-Modified-Since"];
    private static readonly string[] Answered = ["Content-Type", "Content-Disposition", "Content-Range", "Accept-Ranges", "Cache-Control", "ETag", "Last-Modified", "Location"];

    /* /sq-tool/ served from SQ-tool's own server, started from [app]'s sq-tool folder with its data under [data]. */
    public static void Use(WebApplication app, string app0, string data)
    {
        appDir = app0; dataDir = data;
        app.Lifetime.ApplicationStopping.Register(Stop);
        app.Use(async (ctx, next) =>
        {
            if (!ctx.Request.Path.StartsWithSegments("/sq-tool", out var rest)) { await next(); return; }
            // Its page reads its files and API relative to /sq-tool/: the bare address is sent there.
            if (!rest.HasValue) { ctx.Response.Redirect("/sq-tool/" + ctx.Request.QueryString); return; }
            if (!await Started())
            {
                ctx.Response.StatusCode = 503;
                ctx.Response.ContentType = "text/html; charset=utf-8";
                await ctx.Response.WriteAsync(Unavailable(why));
                return;
            }
            await Hand(ctx, rest.Value!);
        });
    }

    /* SQ-tool's own address on this computer, started if it isn't (SqToolRecord.cs hands it recordings); null where it can't be. */
    public static async Task<Uri?> Local() => await Started() ? new Uri($"http://127.0.0.1:{port}/") : null;

    /* Why SQ-tool couldn't start, where it couldn't. */
    public static string Why => why;

    // Running, or started now: false (and [why] says) where it can't be.
    private static async Task<bool> Started()
    {
        if (proc is { HasExited: false }) return true;
        await starting.WaitAsync();
        try
        {
            if (proc is { HasExited: false }) return true;
            var dir = Path.Combine(appDir, "sq-tool");
            if (!Directory.Exists(Path.Combine(dir, "sqtool"))) { why = "SQ-tool isn't in this install (its sq-tool folder is missing)"; return false; }
            port = FreePort();
            var data = Path.Combine(dataDir, "sq-tool");
            Directory.CreateDirectory(data);
            var psi = new ProcessStartInfo(Python) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = dir };
            foreach (var a in new[] { "-m", "sqtool", "serve", "--host", "127.0.0.1", "--port", port.ToString(System.Globalization.CultureInfo.InvariantCulture), "--data", data, "--music", Scans.MusicDir })
                psi.ArgumentList.Add(a);
            psi.Environment["PYTHONPATH"] = dir;
            psi.Environment["PYTHONUNBUFFERED"] = "1";
            psi.Environment["PYTHONDONTWRITEBYTECODE"] = "1"; // nothing written into the install
            Process p;
            try { p = Process.Start(psi)!; }
            catch (System.ComponentModel.Win32Exception) { why = $"Python 3 isn't installed here ({Python} couldn't be run)"; return false; }
            var said = new System.Collections.Concurrent.ConcurrentQueue<string>();
            void Line(string? l) { if (l == null) return; said.Enqueue(l); while (said.Count > 20) said.TryDequeue(out _); Server.Log("[sq-tool] " + l); }
            p.OutputDataReceived += (_, e) => Line(e.Data);
            p.ErrorDataReceived += (_, e) => Line(e.Data);
            p.BeginOutputReadLine(); p.BeginErrorReadLine();
            proc = p;
            // Up once its page answers; gone before that, its last words say why (numpy missing, say).
            for (var i = 0; i < 100; i++)
            {
                if (p.HasExited)
                {
                    p.WaitForExit(); // its last lines read in before they are looked at
                    // Its own word for a missing numpy ("sq-tool needs numpy…"), or Python's ("No module named 'numpy'").
                    var last = string.Join(" ", said.Where(l => l.Contains("Error", StringComparison.Ordinal) || l.Contains("No module", StringComparison.Ordinal)).TakeLast(2));
                    why = said.Any(l => l.Contains("numpy", StringComparison.Ordinal)) ? "Python 3 has no numpy" : $"it stopped as it started{(last.Length > 0 ? ": " + last : "")}";
                    proc = null;
                    return false;
                }
                try
                {
                    using var r = await Http.GetAsync($"http://127.0.0.1:{port}/");
                    if (r.IsSuccessStatusCode) { Server.Log($"[sq-tool] started on 127.0.0.1:{port}"); return true; }
                }
                catch (HttpRequestException) { /* not yet listening */ }
                await Task.Delay(100);
            }
            why = "it didn't answer within ten seconds";
            Stop();
            return false;
        }
        finally { starting.Release(); }
    }

    // [ctx]'s request handed to SQ-tool as [path], its answer handed back as it comes.
    private static async Task Hand(HttpContext ctx, string path)
    {
        var req = ctx.Request;
        using var to = new HttpRequestMessage(new HttpMethod(req.Method), $"http://127.0.0.1:{port}{path}{req.QueryString}");
        // Its server reads a body by its length (Python's http.server): the length handed on with it, never chunked.
        if (req.ContentLength > 0 || req.Headers.TransferEncoding.Count > 0)
        {
            to.Content = new StreamContent(req.Body);
            if (req.ContentLength is { } length) to.Content.Headers.ContentLength = length;
        }
        foreach (var h in Asked)
        {
            if (!req.Headers.TryGetValue(h, out var v)) continue;
            if (h == "Content-Type") { to.Content ??= new ByteArrayContent([]); to.Content.Headers.TryAddWithoutValidation(h, (IEnumerable<string>)v); }
            else to.Headers.TryAddWithoutValidation(h, (IEnumerable<string>)v);
        }
        HttpResponseMessage from;
        try { from = await Http.SendAsync(to, HttpCompletionOption.ResponseHeadersRead, ctx.RequestAborted); }
        catch (HttpRequestException e)
        {
            ctx.Response.StatusCode = 502;
            await ctx.Response.WriteAsync("SQ-tool didn't answer: " + e.Message);
            return;
        }
        using (from)
        {
            ctx.Response.StatusCode = (int)from.StatusCode;
            foreach (var h in Answered)
                if (from.Headers.TryGetValues(h, out var v) || from.Content.Headers.TryGetValues(h, out v))
                    ctx.Response.Headers[h] = h == "Location" ? v.Select(Here).ToArray() : v.ToArray();
            if (from.Content.Headers.ContentLength is { } n) ctx.Response.ContentLength = n;
            await using var body = await from.Content.ReadAsStreamAsync(ctx.RequestAborted);
            await body.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
        }
    }

    // A redirect SQ-tool makes to one of its own addresses, kept under /sq-tool/.
    private static string Here(string at) => at.StartsWith('/') ? "/sq-tool" + at : at;

    private static int FreePort()
    {
        using var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        return ((IPEndPoint)l.LocalEndpoint).Port;
    }

    private static void Stop()
    {
        var p = proc;
        proc = null;
        try { if (p is { HasExited: false }) p.Kill(true); } catch (InvalidOperationException) { /* gone */ }
    }

    // The page where it can't start: why, and what to do.
    private static string Unavailable(string reason) => $$"""
        <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>SQ-tool</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:40em;margin:3em auto;padding:0 1em;background:#141414;color:#e8e6e1}code{background:#2a2a2a;padding:.1em .3em;border-radius:3px}a{color:#d9a441}</style></head>
        <body><h1>SQ-tool can't start</h1><p>{{WebUtility.HtmlEncode(reason)}}.</p>
        <p>SQ-tool needs Python 3 with numpy. Mandarin OS and the Linux installer bring both. Installed by hand, add them:
        <code>sudo apt install python3 python3-numpy</code> on Debian or Ubuntu.</p>
        <p><a href="/">Back to Mandarin</a></p></body></html>
        """;
}
