using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// Restart and Shut down answered by the C# server (v0.8.31; PowerRoutes.cs), and how the processor is
/// shared out (/api/cpu). Run for real, as an install runs it, in a data folder of its own:
///   - Restart: started again in its same process (from its file, as after an update), the library and
///     the account as they were;
///   - Shut down: it stops, with 0;
///   - /api/system/power and /api/cpu.
/// Away (over Tailscale: a request Tailscale's proxy on this machine forwards from a tailnet address)
/// both are refused, nothing stopped (test/power-csharp.test.js, in C#).
/// </summary>
public sealed class PowerCsharpTests
{
    private static async Task<ServerProcess> Start(Fixtures.Library lib, Dictionary<string, string>? more = null)
    {
        Needs.Server();
        if (OperatingSystem.IsWindows()) Assert.Skip("not on Windows");
        var env = new Dictionary<string, string> { ["SONOS_HOSTS"] = "" };
        foreach (var (k, v) in more ?? []) env[k] = v;
        return await ServerProcess.Start(Ports.Port(), lib.Music, lib.Data, env);
    }

    private static string Log(ServerProcess c) => string.Join("\n", c.Logs);

    private static async Task<bool> Healthy(ServerProcess c)
    {
        try { return (await Http.Get(c.Base + "/api/health")).Status == 200; } catch (HttpRequestException) { return false; }
    }

    private static async Task<int> AlbumCount(ServerProcess c, Dictionary<string, string> h)
    {
        int n = 0;
        await Session.Until(async () => { var x = await Http.Get(c.Base + "/api/library/albums", h); n = x.Status == 200 ? x.J["albums"].Items().Count() : 0; return n > 0; }, 30000, "the library");
        return n;
    }

    [Test]
    public async Task Restart_and_Shut_down_by_the_CSharp_server_as_an_install_runs_it()
    {
        var c = await Start(Fixtures.MakeLibrary());
        try
        {
            var h = new Dictionary<string, string> { ["Authorization"] = "Bearer " + await Session.SignIn(c.Base) };

            // What this install can do, answered by the C# server; signed in only.
            Assert.True((await Http.Get(c.Base + "/api/system/power")).Status == 401, "signed in only");
            var r = await Http.Get(c.Base + "/api/system/power", h);
            Assert.Equal("C#", r.Header("x-mandarin-answered"));
            JsonAssert.Same("""{"restart":true,"shutdown":true,"start_again":"manual"}""", r.Json);

            // The processor split (decided by the C# server; CpuAloneTests holds the decision).
            r = await Http.Get(c.Base + "/api/cpu", h);
            Assert.Equal("C#", r.Header("x-mandarin-answered"));
            var plan = r.J.AsObject();
            foreach (var k in new[] { "split", "cores", "playback", "background", "core", "dsp", "raised", "tools", "making", "making_cores" }) Assert.True(plan.ContainsKey(k), k + " in " + plan.ToJsonString());
            Assert.NotEmpty(plan["cores"]!.AsArray());
            Assert.Equal(0, (int)plan["making_cores"]!);
            // The cores a making has (item 260): "auto" or 1 to 3, no more than all but one; kept, and said.
            Assert.True((await Http.Post(c.Base + "/api/cpu", new { making_cores = 1 })).Status == 401, "signed in only");
            r = await Http.Post(c.Base + "/api/cpu", new { making_cores = 1 }, h);
            Assert.Equal(200, r.Status);
            Assert.Equal(1, (int)r.J["making_cores"]!);
            Assert.Equal(1, (int)(await Http.Get(c.Base + "/api/cpu", h)).J["making_cores"]!);
            foreach (var bad in new object[] { 0, 4, 1.5, "two", -1 })
                Assert.True((await Http.Post(c.Base + "/api/cpu", new { making_cores = bad }, h)).Status == 400, "refused: " + bad);
            Assert.Equal(1, (int)(await Http.Get(c.Base + "/api/cpu", h)).J["making_cores"]!);
            r = await Http.Post(c.Base + "/api/cpu", new { making_cores = "auto" }, h);
            Assert.Equal(0, (int)r.J["making_cores"]!);

            // Restart: started again in its same process.
            var pid = c.Proc.Id;
            Assert.DoesNotMatch("started the Node server", Log(c));
            var albums = await AlbumCount(c, h);
            r = await Http.Post(c.Base + "/api/system/restart", new { }, h);
            Assert.Equal(200, r.Status);
            JsonAssert.Same("""{"ok":true,"restarting":true}""", r.Json);
            await Session.Until(() => Task.FromResult(Log(c).Contains("starting again from ", StringComparison.Ordinal)), 30000, "the C# server to start again");
            await Session.Until(() => Healthy(c), 60000, "it to answer again");
            Assert.True(c.Exited == null, "the C# server never stopped");
            Assert.True(c.Proc.Id == pid, "in the same process");
            Assert.Matches(@"\[power\] restart asked for from Settings", Log(c));
            // As they were: still signed in, the same library.
            Assert.Equal(albums, await AlbumCount(c, h));

            // Shut down: it stops, with 0.
            r = await Http.Post(c.Base + "/api/system/shutdown", new { }, h);
            Assert.Equal(200, r.Status);
            JsonAssert.Same("""{"ok":true,"start_again":"manual"}""", r.Json);
            await c.Proc.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(30));
            Assert.True(c.Proc.ExitCode == 0, "left with 0: " + Log(c));
            Assert.Matches(@"\[power\] shut down asked for from Settings", Log(c));
        }
        finally { await c.Stop(); }
    }

    [Test]
    public async Task Neither_from_away_Restart_and_Shut_down_refused_over_Tailscale_nothing_stopped()
    {
        var c = await Start(Fixtures.MakeLibrary());
        try
        {
            var h = new Dictionary<string, string> { ["Authorization"] = "Bearer " + await Session.SignIn(c.Base), ["X-Forwarded-For"] = "100.101.102.103" };
            foreach (var p in new[] { "/api/system/restart", "/api/system/shutdown" })
            {
                var r = await Http.Post(c.Base + p, new { }, h);
                Assert.True(r.Status == 403, p);
                Assert.True(r.J.Bool("away"), p);
            }
            // A window: the server must not stop in it.
            await Task.Delay(1000);
            Assert.True(c.Exited == null, "still running");
            Assert.DoesNotMatch(new Regex(@"\[power\] (restart|shut down) asked for"), Log(c));
        }
        finally { await c.Stop(); }
    }

    /// <summary>
    /// On Mandarin OS (item 389) Shut down is the computer's: Mandarin OS is asked by its request file (the path unit
    /// mandarin-os-power.path acts on it as root), Mandarin stops with 0 so its library is saved first, and the power
    /// button is how it all starts again.
    /// </summary>
    [Test]
    public async Task On_Mandarin_OS_Shut_down_shuts_the_computer_down()
    {
        var lib = Fixtures.MakeLibrary();
        var request = Path.Combine(lib.Data, "power-request");
        var c = await Start(lib, more: new() { ["MANDARIN_OS"] = "0.1.0", ["MANDARIN_OS_POWER"] = request });
        try
        {
            var h = new Dictionary<string, string> { ["Authorization"] = "Bearer " + await Session.SignIn(c.Base) };
            JsonAssert.Same("""{"restart":true,"shutdown":true,"start_again":"power-button"}""", (await Http.Get(c.Base + "/api/system/power", h)).Json);
            var r = await Http.Post(c.Base + "/api/system/shutdown", new { }, h);
            Assert.Equal(200, r.Status);
            JsonAssert.Same("""{"ok":true,"start_again":"power-button"}""", r.Json);
            await c.Proc.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(30));
            Assert.True(c.Proc.ExitCode == 0, "left with 0: " + Log(c));
            Assert.True(File.Exists(request), "Mandarin OS asked: " + Log(c));
            Assert.Equal("poweroff\n", File.ReadAllText(request));
            Assert.Matches(@"\[power\] Mandarin OS asked to shut the computer down", Log(c));
        }
        finally { await c.Stop(); }
    }
}
