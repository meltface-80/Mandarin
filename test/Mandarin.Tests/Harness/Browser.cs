using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// The page itself, in a real browser (test/browser-harness.js, in C#): what a screen shows, where a
/// button sits, what a tap does. No package: the Chromium or Chrome already on the machine, driven over
/// the DevTools protocol on its WebSocket. Where no browser is found the tests skip themselves (in CI
/// one must be found).
///   await using var b = await Browser.Launch(width: 1440, height: 900, mouse: true);
///   var page = await b.Page(url, cookies: [...]);
///   var title = await page.Eval("document.title");
/// </summary>
public sealed partial class Browser : IAsyncDisposable
{
    private static readonly string?[] Candidates = [
        Environment.GetEnvironmentVariable("CHROME_PATH"),
        "/opt/pw-browsers/chromium",
        // Chrome itself before /usr/bin/google-chrome, a script that starts it (killing the script would leave Chrome running).
        "/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

    // A desktop: a mouse, so (hover: hover) and (pointer: fine) match; without it, said outright: no
    // pointer and no hover, as headless Chrome reports on Linux.
    private const string Mouse = "--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2";
    private const string NoMouse = "--blink-settings=primaryPointerType=1,availablePointerTypes=1,primaryHoverType=1,availableHoverTypes=1";

    /// <summary>The longest the browser is given to answer a DevTools command, or a page to load.</summary>
    public static readonly TimeSpan CallLimit = TimeSpan.FromSeconds(90);

    /// <summary>The browser to use, or null.</summary>
    public static string? Find() => Candidates.FirstOrDefault(p => p != null && File.Exists(p));

    /// <summary>Skips the test where no browser is found, outside CI.</summary>
    public static void Need() { if (Find() == null && Environment.GetEnvironmentVariable("CI") is not { Length: > 0 }) Assert.Skip("no Chromium or Chrome (set CHROME_PATH)"); }

    private readonly Process proc;
    private readonly string dir;
    private readonly ClientWebSocket ws = new();
    private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonNode?>> waiting = new();
    private readonly List<Action<JsonNode>> listeners = [];
    private readonly SemaphoreSlim sendLock = new(1, 1);
    private int id;
    private readonly int width, height;

    private Browser(Process proc, string dir, int width, int height) { this.proc = proc; this.dir = dir; this.width = width; this.height = height; }

    /// <summary>A headless browser of the given window size (a mouse, or none: a touch screen's page asks for touch).</summary>
    public static async Task<Browser> Launch(int width = 1280, int height = 800, bool mouse = false)
    {
        var bin = Find() ?? throw new InvalidOperationException("no Chromium or Chrome found (set CHROME_PATH)");
        Exception? last = null;
        // A starved runner can take a while to bring the browser up, or lose it: a minute, and a second launch.
        for (int attempt = 1; attempt <= 2; attempt++)
        {
            var dir = Directory.CreateTempSubdirectory("musicd-browser-").FullName;
            var psi = new ProcessStartInfo(bin) { RedirectStandardError = true, RedirectStandardOutput = true, UseShellExecute = false };
            foreach (var a in new[] { "--headless=new", "--remote-debugging-port=0", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
                "--disable-crash-reporter", "--disable-breakpad", "--no-first-run", "--no-default-browser-check", "--mute-audio",
                "--user-data-dir=" + dir, FormattableString.Invariant($"--window-size={width},{height}"), mouse ? Mouse : NoMouse, "about:blank" }) psi.ArgumentList.Add(a);
            var proc = Process.Start(psi)!;
            var url = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            proc.ErrorDataReceived += (_, e) => { if (e.Data != null && ListeningRe().Match(e.Data) is { Success: true } m) url.TrySetResult(m.Groups[1].Value); };
            proc.OutputDataReceived += (_, _) => { };
            proc.BeginErrorReadLine();
            proc.BeginOutputReadLine();
            var b = new Browser(proc, dir, width, height);
            try
            {
                var wsUrl = await url.Task.WaitAsync(TimeSpan.FromSeconds(60));
                await b.ws.ConnectAsync(new Uri(wsUrl), CancellationToken.None);
                _ = b.Read();
                await b.Send("Browser.getVersion");
                return b;
            }
            catch (Exception e) when (e is TimeoutException or WebSocketException or InvalidOperationException)
            {
                last = e;
                await b.DisposeAsync();
            }
        }
        throw new InvalidOperationException("the browser didn't answer: " + bin, last);
    }

    /// <summary>One DevTools command and its result; bounded, so a call never answered fails with its name.</summary>
    public async Task<JsonNode?> Send(string method, object? @params = null, string? sessionId = null)
    {
        int n = Interlocked.Increment(ref id);
        var msg = new JsonObject { ["id"] = n, ["method"] = method, ["params"] = JsonNode.Parse(Http.Json(@params ?? new { })) };
        if (sessionId != null) msg["sessionId"] = sessionId;
        var done = new TaskCompletionSource<JsonNode?>(TaskCreationOptions.RunContinuationsAsynchronously);
        waiting[n] = done;
        await sendLock.WaitAsync();
        try { await ws.SendAsync(Encoding.UTF8.GetBytes(msg.ToJsonString()), WebSocketMessageType.Text, true, CancellationToken.None); }
        finally { sendLock.Release(); }
        try { return await done.Task.WaitAsync(CallLimit); }
        catch (TimeoutException) { waiting.TryRemove(n, out _); throw new TimeoutException($"the browser didn't answer {method} within {CallLimit.TotalSeconds} s"); }
    }

    private async Task Read()
    {
        var buf = new byte[1 << 16];
        var msg = new MemoryStream();
        try
        {
            while (ws.State == WebSocketState.Open)
            {
                var r = await ws.ReceiveAsync(buf, CancellationToken.None);
                if (r.MessageType == WebSocketMessageType.Close) break;
                msg.Write(buf, 0, r.Count);
                if (!r.EndOfMessage) continue;
                var node = JsonNode.Parse(msg.ToArray())!;
                msg.SetLength(0);
                if (node["id"] is { } idNode && waiting.TryRemove(idNode.GetValue<int>(), out var w))
                {
                    if (node["error"] is { } err) w.TrySetException(new InvalidOperationException((string?)err["message"]));
                    else w.TrySetResult(node["result"]);
                }
                else if (node["method"] != null)
                {
                    Action<JsonNode>[] ls;
                    lock (listeners) ls = [.. listeners];
                    foreach (var l in ls) l(node);
                }
            }
        }
        catch (WebSocketException) { }
        catch (ObjectDisposedException) { }
        foreach (var w in waiting.Values) w.TrySetException(new InvalidOperationException("browser closed"));
    }

    private void Listen(Action<JsonNode> fn) { lock (listeners) listeners.Add(fn); }

    /// <summary>
    /// A tab at <paramref name="url"/>, sized like the window, with the cookies. <paramref name="init"/>
    /// is script run in the page before any of its own on every load (a stand-in for the Android app's
    /// bridges); <paramref name="touch"/> makes it a touch screen (pointer: coarse, hover: none).
    /// </summary>
    public async Task<Page> Page(string url, IEnumerable<object>? cookies = null, string? init = null, bool touch = false)
    {
        var targetId = (string)(await Send("Target.createTarget", new { url = "about:blank" }))!["targetId"]!;
        var sessionId = (string)(await Send("Target.attachToTarget", new { targetId, flatten = true }))!["sessionId"]!;
        var page = new Page(this, sessionId);
        Listen(m =>
        {
            if ((string?)m["sessionId"] != sessionId || (string?)m["method"] != "Runtime.exceptionThrown") return;
            var d = m["params"]?["exceptionDetails"];
            lock (page.ErrorsList) page.ErrorsList.Add((string?)d?["exception"]?["description"] ?? (string?)d?["text"] ?? "?");
        });
        await page.Send("Runtime.enable");
        await page.Send("Page.enable");
        await page.Send("Emulation.setDeviceMetricsOverride", new { width, height, deviceScaleFactor = 1, mobile = touch });
        if (touch) await page.Send("Emulation.setTouchEmulationEnabled", new { enabled = true, maxTouchPoints = 5 });
        foreach (var c in cookies ?? []) await page.Send("Network.setCookie", c);
        if (init != null) await page.Send("Page.addScriptToEvaluateOnNewDocument", new { source = init });
        var loaded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Listen(m => { if ((string?)m["sessionId"] == sessionId && (string?)m["method"] == "Page.loadEventFired") loaded.TrySetResult(); });
        await page.Send("Page.navigate", new { url });
        try { await loaded.Task.WaitAsync(CallLimit); }
        catch (TimeoutException) { throw new TimeoutException($"the page didn't load within {CallLimit.TotalSeconds} s: {url}"); }
        return page;
    }

    internal void On(string sessionId, Action<JsonNode> fn) => Listen(m => { if ((string?)m["sessionId"] == sessionId) fn(m); });

    /// <summary>Closed: killed outright with every process it started, its profile removed.</summary>
    public async ValueTask DisposeAsync()
    {
        try { ws.Abort(); ws.Dispose(); } catch (ObjectDisposedException) { }
        try { proc.Kill(true); } catch (InvalidOperationException) { }
        try { await proc.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(2)); } catch (TimeoutException) { }
        foreach (var w in waiting.Values) w.TrySetException(new InvalidOperationException("browser closed"));
        try { Directory.Delete(dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    [GeneratedRegex(@"DevTools listening on (ws://\S+)")]
    private static partial Regex ListeningRe();
}

/// <summary>One tab of the browser.</summary>
public sealed class Page
{
    private readonly Browser browser;
    private readonly string sessionId;
    internal readonly List<string> ErrorsList = [];

    internal Page(Browser browser, string sessionId) { this.browser = browser; this.sessionId = sessionId; }

    /// <summary>What the page has thrown so far (Runtime.exceptionThrown), first lines included.</summary>
    public IReadOnlyList<string> Errors { get { lock (ErrorsList) return [.. ErrorsList]; } }

    /// <summary>A DevTools command for this tab.</summary>
    public Task<JsonNode?> Send(string method, object? @params = null) => browser.Send(method, @params, sessionId);

    /// <summary>This tab's DevTools events.</summary>
    public void On(Action<JsonNode> fn) => browser.On(sessionId, fn);

    /// <summary>An expression run in the page (a promise is awaited): its value, as JSON.</summary>
    public async Task<JsonNode?> Eval(string expression)
    {
        var r = await Send("Runtime.evaluate", new { expression, awaitPromise = true, returnByValue = true });
        if (r?["exceptionDetails"] is { } d) throw new InvalidOperationException((string?)d["exception"]?["description"] ?? (string?)d["text"]);
        return r?["result"]?["value"]?.DeepClone();
    }

    /// <summary>A real mouse: "mousePressed", "mouseMoved" or "mouseReleased" at x, y; the left button.</summary>
    public Task Mouse(string type, double x, double y, int clickCount = 1) =>
        Send("Input.dispatchMouseEvent", new { type, x, y, button = "left", buttons = type == "mouseReleased" ? 0 : 1, clickCount });

    /// <summary>The tab as a PNG, written to <paramref name="file"/> (a look at the page while writing a test).</summary>
    public async Task Screenshot(string file)
    {
        var r = await Send("Page.captureScreenshot", new { format = "png" });
        await File.WriteAllBytesAsync(file, Convert.FromBase64String((string)r!["data"]!));
    }
}
