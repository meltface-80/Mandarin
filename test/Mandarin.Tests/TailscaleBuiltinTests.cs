using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// Tailscale built into the server (Admin/Tailscale.cs), driven against a stand-in for the engine that
/// answers its control API the way the real one does (test/StandIns/Musicdnet.cs; the real one is tested
/// against a private tailnet in android/musicdnet). Through the server's own routes; the order an away
/// address is chosen in asked through `mandarin-server score` (test/tailscale-builtin.test.js, in C#).
/// </summary>
public sealed class TailscaleBuiltinTests
{
    private sealed record Engine(string Dir, string Bin)
    {
        public string Calls() { try { return File.ReadAllText(Path.Combine(Dir, "calls.log")); } catch (IOException) { return ""; } }
        public int Count(string what) => Regex.Matches(Calls(), Regex.Escape(what)).Count;
        public string Args() => File.ReadAllText(Path.Combine(Dir, "args.txt"));
    }

    private static Engine StubEngine()
    {
        var dir = Directory.CreateTempSubdirectory("musicd-ts-").FullName;
        return new Engine(dir, StandIn.Script("musicdnet", Path.Combine(dir, "musicdnet")));
    }

    private static async Task<(TestServer Srv, Dictionary<string, string> H, string Token)> Server(string bin, Dictionary<string, string>? env = null, Dictionary<string, object?>? config = null)
    {
        Needs.Server();
        var dir = Directory.CreateTempSubdirectory("musicd-tsd-").FullName;
        Directory.CreateDirectory(Path.Combine(dir, "music"));
        var o = new Dictionary<string, object?> { ["serverIp"] = "127.0.0.1", ["sonosHosts"] = Array.Empty<string>(), ["tailscaleBin"] = bin };
        foreach (var (k, v) in config ?? []) o[k] = v;
        var srv = await new TestServer(Ports.Port(), Path.Combine(dir, "music"), Path.Combine(dir, "data"), o, env).Start();
        var token = await Session.SignIn(srv.Base);
        return (srv, new() { ["Authorization"] = "Bearer " + token }, token);
    }

    // As JavaScript tests it: true, a number not 0, a string not empty.
    private static bool Truthy(JsonNode? v) => v is JsonValue j && (j.TryGetValue<bool>(out var b) ? b : j.TryGetValue<string>(out var s) ? s.Length > 0 : j.TryGetValue<double>(out var d) && d != 0);

    private static async Task<JsonNode> Tailscale(TestServer srv, Dictionary<string, string> h) => (await Http.Get(srv.Base + "/api/tailscale", h)).J;

    [Test]
    public async Task Signing_the_server_in_to_Tailscale_from_Settings()
    {
        var eng = StubEngine();
        var (srv, h, _) = await Server(eng.Bin);
        await using var _srv = srv;
        async Task<JsonNode> Api(string p, object? body = null) => (body == null ? await Http.Get(srv.Base + "/api/" + p, h) : await Http.Post(srv.Base + "/api/" + p, body, h)).J;

        // Started by itself, as "musicd", waiting to be signed in, with a link.
        JsonNode? st = null;
        await Session.Until(async () => (st = await Api("tailscale")).Str("state") == "NeedsLogin", 10000, "the engine waiting for a sign-in");
        Assert.True(st.Bool("available"));
        Assert.True(st.Bool("enabled"));
        Assert.Equal("https://login.tailscale.com/a/abc123", st.Str("auth_url"));
        Assert.Null(st.Str("address"));
        Assert.Matches(new Regex(@"^-server -dir .*tailscale\nok$"), eng.Args());
        Assert.Contains("POST /start {\"Hostname\":\"musicd\"", eng.Calls(), StringComparison.Ordinal);

        // A new link on asking.
        Assert.Equal("https://login.tailscale.com/a/new456", (await Api("tailscale/login", new { })).Str("auth_url"));

        // Signed out (v0.9.1, the audit's T1): the engine told, then started afresh, to be signed in again.
        var before = eng.Count("POST /start ");
        var signedOut = await Api("tailscale/logout", new { });
        Assert.True(signedOut.Bool("enabled"), signedOut.ToJsonString());
        Assert.Contains("POST /logout ", eng.Calls(), StringComparison.Ordinal);
        await Session.Until(async () => eng.Count("POST /start ") == before + 1 && (await Api("tailscale")).Str("state") == "NeedsLogin", 10000, "started afresh");
        // Away, the way you're reaching the server is what it would change: refused, nothing asked of the engine.
        var away = await Http.Post(srv.Base + "/api/tailscale/logout", new { }, new Dictionary<string, string>(h) { ["X-Forwarded-For"] = "100.101.102.103" });
        Assert.Equal(403, away.Status);
        Assert.Equal(1, eng.Count("POST /logout "));

        // Unauthenticated: nothing.
        Assert.Equal(401, (await Http.Get(srv.Base + "/api/tailscale")).Status);

        // Off, and on again.
        var off = await Api("tailscale/enable", new { on = false });
        Assert.Equal((false, "Stopped"), (off.Bool("enabled") ?? true, off.Str("state")));
        Assert.True((await Api("tailscale/enable", new { on = true })).Bool("enabled"));
        await Session.Until(async () => (await Api("tailscale")).Str("state") == "NeedsLogin", 10000, "waiting again");
    }

    [Test]
    public async Task With_TS_AUTHKEY_it_joins_by_itself_serves_the_servers_port_and_phones_learn_its_address()
    {
        var eng = StubEngine();
        var (srv, h, _) = await Server(eng.Bin, new() { ["TS_AUTHKEY"] = "tskey-auth-test" });
        await using var _srv = srv;
        JsonNode? st = null;
        await Session.Until(async () => Truthy((st = await Tailscale(srv, h))["serving"]), 10000, "serving");
        var port = srv.Port;
        Assert.Equal("Running", st.Str("state"));
        Assert.Equal("http://100.90.1.2:" + port, st.Str("address"));
        Assert.Equal("musicd.tail1.ts.net", st.Str("dns_name"));
        Assert.Matches($@"POST /serve\?port={port}&upstream=http%3A%2F%2F127\.0\.0\.1%3A{port}", eng.Calls());
        // The key goes through the API, never the engine's environment.
        Assert.Contains("\"AuthKey\":\"tskey-auth-test\"", eng.Calls(), StringComparison.Ordinal);
        Assert.EndsWith("\nok", eng.Args(), StringComparison.Ordinal);
        // The address a phone is given when it says hello: the built-in one.
        var hello = (await Http.Post(srv.Base + "/api/phone/hello", new { }, h)).J;
        Assert.Equal("http://100.90.1.2:" + port, hello.Str("away_address"));
        // And the order they're chosen in: TAILSCALE_ADDRESS, the built-in one, the host's.
        var host = new { tailscale0 = new[] { new { family = "IPv4", address = "100.64.9.9" } } };
        var aways = (await Score.Run(new { fn = "auth", aways = new object[] { new { port, own = st.Str("address"), ifaces = host }, new { port, set = "nas.tail1.ts.net", own = st.Str("address"), ifaces = host }, new { port, ifaces = host } } }))["aways"];
        JsonAssert.Same(Http.Json(new[] { "http://100.90.1.2:" + port, "http://nas.tail1.ts.net:" + port, "http://100.64.9.9:" + port }), aways);
    }

    [Test]
    public async Task Without_the_engine_a_source_install_it_says_so_and_stays_out_of_the_way()
    {
        if (OperatingSystem.IsMacOS()) Assert.Skip("a Mac fetches its engine wherever it runs (item 156)");
        var (srv, h, _) = await Server("/nonexistent/musicdnet");
        await using var _srv = srv;
        var s = await Tailscale(srv, h);
        Assert.False(s.Bool("available"));
        Assert.Equal("Stopped", s.Str("state"));
        var r = await Http.Post(srv.Base + "/api/tailscale/login", new { }, h);
        Assert.Equal(500, r.Status);
        Assert.Matches("isn't in this install", r.J.Str("error"));
    }

    [Test]
    public async Task An_install_updated_in_place_downloads_the_engine_checked_once_per_server_version()
    {
        if (!OperatingSystem.IsLinux() && !OperatingSystem.IsMacOS()) Assert.Skip("the engine is built for Linux and a Mac");
        var os = OperatingSystem.IsMacOS() ? "darwin" : "linux";
        // A release site (here, a server of our own) with the engine and its checksums.
        var eng = StubEngine();
        byte[] gz;
        using (var ms = new MemoryStream())
        {
            using (var z = new GZipStream(ms, CompressionLevel.Optimal, leaveOpen: true)) z.Write(await File.ReadAllBytesAsync(eng.Bin));
            gz = ms.ToArray();
        }
        var arch = RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "arm64" : "amd64";
        var good = Convert.ToHexStringLower(SHA256.HashData(gz)) + "  musicdnet-" + os + "-" + arch + ".gz\n";
        var sums = good;
        int fetches = 0;
        await using var web = await FakeServer.Start(async ctx =>
        {
            var u = ctx.Request.Path.Value;
            if (u == "/SHA256SUMS") { await ctx.Response.Body.WriteAsync(Encoding.UTF8.GetBytes(sums)); return; }
            if (u == "/musicdnet-" + os + "-" + arch + ".gz") { Interlocked.Increment(ref fetches); await ctx.Response.Body.WriteAsync(gz); return; }
            ctx.Response.StatusCode = 404;
        });
        var (srv, h, token) = await Server("/nonexistent/musicdnet", new() { ["TS_ENGINE_URL"] = web.Base });
        await using var _srv = srv;
        var bin = Path.Combine(srv.DataDir, "bin", "musicdnet");
        var version = (string)JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(ServerProcess.Root, "package.json")))!["version"]!;
        async Task<JsonNode> Waiting()
        {
            JsonNode? s = null;
            await Session.Until(async () => (s = await Tailscale(srv, h)).Str("state") == "NeedsLogin", 30000, "the engine waiting for a sign-in");
            return s!;
        }
        Assert.True((await Waiting()).Bool("available"));
        Assert.Equal(1, fetches);
        Assert.True(File.Exists(bin));
        Assert.True(await File.ReadAllTextAsync(bin + ".version") == version, "fetched for this version of the server");

        // The same version again: nothing fetched.
        await srv.Restart(token);
        await Waiting();
        Assert.Equal(1, fetches);

        // The server updated (the engine there was fetched for an older one): fetched again. A damaged
        // download is refused, and the old engine still runs.
        await File.WriteAllTextAsync(bin + ".version", "0.3.21");
        sums = new string('0', 64) + "  musicdnet-" + os + "-" + arch + ".gz\n";
        await srv.Restart(token);
        Assert.Matches("checksum", (await Waiting()).Str("error") ?? "");
        Assert.Equal(2, fetches);
        Assert.Equal("0.3.21", await File.ReadAllTextAsync(bin + ".version"));
        // Mended: taken, and noted for this version.
        sums = good;
        await srv.Restart(token);
        Assert.Null((await Waiting()).Str("error"));
        Assert.Equal(3, fetches);
        Assert.Equal(version, await File.ReadAllTextAsync(bin + ".version"));
    }

    // The watchdog (v0.7.2): an engine that says Running but isn't online on the tailnet is asked to
    // rebind, and started afresh when that doesn't help.
    [Test]
    public async Task A_node_that_is_Running_but_not_online_is_rebound_then_started_afresh()
    {
        var eng = StubEngine();
        var (srv, h, _) = await Server(eng.Bin, new() { ["TS_AUTHKEY"] = "tskey-auth-test", ["TS_STUB_STALE"] = "1" },
            new() { ["tailscaleWatchdog"] = new { rebindMs = 400, restartMs = 1500 } });
        await using var _srv = srv;
        JsonNode? st = null;
        try
        {
            await Session.Until(async () => Truthy((st = await Tailscale(srv, h))["serving"]), 10000, "serving");
            Assert.True(st.Bool("online") == false, "the status says it isn't online");
            // The engine is asked every 5 s: the rebind within three asks, the fresh start a few after.
            await Session.Until(() => Task.FromResult(eng.Calls().Contains("POST /rebind", StringComparison.Ordinal)), 40000, "a rebind");
            // Still not online after the rebind: the engine is started afresh (a second /start).
            await Session.Until(() => Task.FromResult(eng.Count("POST /start") >= 2), 40000, "a fresh start");
            await Session.Until(() => Task.FromResult(eng.Count("POST /serve") >= 2), 40000, "served again");
        }
        catch (Exception e) when (e is TimeoutException or Xunit.Sdk.XunitException)
        {
            throw new Xunit.Sdk.XunitException(e.Message + "\nCALLS:\n" + eng.Calls() + "\nSTATUS: " + st?.ToJsonString());
        }
    }

    // An engine let go of by a restart (Restart: its input closed, killed 1.5 s on) that leaves only after the
    // next one has started (item 181): its leaving is the old one's, and touches nothing of the new one's —
    // not reported as the engine stopping, no restart of its own, the new one's asking left going.
    [Test]
    public async Task An_engine_that_leaves_after_the_next_has_started_leaves_the_new_one_alone()
    {
        var eng = StubEngine();
        var (srv, h, _) = await Server(eng.Bin, new() { ["TS_AUTHKEY"] = "tskey-auth-test", ["TS_STUB_LINGER"] = "1" });
        await using var _srv = srv;
        await Session.Until(async () => Truthy((await Tailscale(srv, h))["serving"]), 15000, "serving");
        // Signed out: the engine let go of (lingering until killed) and started afresh.
        Assert.Equal(200, (await Http.Post(srv.Base + "/api/tailscale/logout", new { }, h)).Status);
        await Session.Until(async () => eng.Count("POST /start ") == 2 && Truthy((await Tailscale(srv, h))["serving"]), 15000, "the new engine serving");
        // Past the old one's leaving, the new one still asked how it is, every few seconds.
        await Task.Delay(2000);
        var asked = eng.Count("GET /status");
        await Session.Until(() => Task.FromResult(eng.Count("GET /status") >= asked + 2), 15000, "the new engine asked on");
        Assert.DoesNotContain(srv.Logs, l => l.Contains("[tailscale] stopped", StringComparison.Ordinal));
        Assert.Null((await Tailscale(srv, h)).Str("error"));
    }
}
