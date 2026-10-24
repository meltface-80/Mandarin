namespace Mandarin.Tests;

/// <summary>
/// A database write held by another program (a scan, a job) holds no request: the gate keeps when each
/// device was last seen in memory and writes it in the background, where it wrote it on the request and
/// waited out the lock (a burst of requests held for seconds, the thread pool with them, so even
/// /server-info waited). And GET /api/ping, the Android app's home-or-away test: answered at once,
/// open, with the server's version and its id, which stays across a restart.
/// </summary>
public sealed class BusyServerTests
{
    private const int Hold = 3000, Quick = 1500;

    [Test]
    public async Task A_write_lock_held_elsewhere_holds_no_request_and_last_seen_is_still_fresh()
    {
        await using var s = await Session.Started();
        // The device last seen long ago: its next request is the one the gate wrote for.
        s.Server.Exec("UPDATE devices SET last_seen = 0");
        var t0 = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var answers = await Busy.Holding(s.Server, Hold, async () =>
        {
            var asks = new List<Task<(string What, int Status, long Ms)>>();
            for (int i = 0; i < 16; i++) asks.Add(Busy.Timed("auth/status", () => s.Api("auth/status")));
            for (int i = 0; i < 8; i++) asks.Add(Busy.Timed("library/albums", () => s.Api("library/albums?count=1")));
            for (int i = 0; i < 8; i++) asks.Add(Busy.Timed("phone/state", () => s.Api("phone/state", new { state = "stopped" })));
            for (int i = 0; i < 8; i++) asks.Add(Busy.Timed("server-info", () => Http.Get(s.Base + "/server-info")));
            return await Task.WhenAll(asks);
        });
        var said = string.Join(", ", answers.Select(a => $"{a.What} {a.Status} in {a.Ms} ms"));
        Assert.All(answers, a => Assert.Equal(200, a.Status));
        Assert.True(answers.Max(a => a.Ms) < Quick, "each answered well inside the " + Hold + " ms the lock was held: " + said);

        // Settings → Devices: this device seen just now, before the database has it.
        var me = (await s.Api("auth/devices")).J["devices"].Items().Single(d => d.Bool("current") == true);
        Assert.True(me.Num("last_seen") >= t0, "last seen " + me.Num("last_seen") + ", the burst at " + t0);
        Assert.Equal("127.0.0.1", me.Str("last_ip"));
        // And the database is brought up to it in the background.
        await Session.Until(() => Task.FromResult(Convert.ToInt64(s.Server.Scalar("SELECT MAX(last_seen) FROM devices"), System.Globalization.CultureInfo.InvariantCulture) >= t0), 30000, "last seen written to the database");
    }

    [Test]
    public async Task Ping_answers_at_once_open_with_the_version_and_an_id_kept_across_a_restart()
    {
        await using var s = await Session.Started();
        var r = await Http.Get(s.Base + "/api/ping");
        Assert.Equal(200, r.Status);
        var id = r.J.Str("id");
        Assert.Matches("^[0-9a-f]{32}$", id ?? "");
        Assert.True(r.J.Bool("ok"));
        Assert.Equal((await Http.Get(s.Base + "/server-info")).J.Str("version"), r.J.Str("version"));
        Assert.Equal("no-store", r.Header("Cache-Control"));
        Assert.Equal(id, (string?)s.Server.Setting("serverId"));

        // A write held elsewhere: answered at once all the same.
        var held = await Busy.Holding(s.Server, Hold, async () =>
        {
            var pings = new List<(string What, int Status, long Ms)>();
            for (int i = 0; i < 5; i++) { pings.Add(await Busy.Timed("ping", () => Http.Get(s.Base + "/api/ping"))); await Task.Delay(200); }
            return pings;
        });
        Assert.All(held, p => Assert.True(p.Status == 200 && p.Ms < 500, $"{p.Status} in {p.Ms} ms"));

        // The library's copy being read again, many albums of it: answered at once too.
        Busy.ManyAlbums(s.Server, 20000);
        await s.Server.Internal("/internal/library/changed", new { lookups = true, background = true });
        var reading = new List<(string What, int Status, long Ms)>();
        for (int i = 0; i < 10; i++) { reading.Add(await Busy.Timed("ping", () => Http.Get(s.Base + "/api/ping"))); await Task.Delay(50); }
        Assert.All(reading, p => Assert.True(p.Status == 200 && p.Ms < 500, $"{p.Status} in {p.Ms} ms"));

        // Started again: the same id.
        await s.Server.Restart(s.Token);
        Assert.Equal(id, (await Http.Get(s.Base + "/api/ping")).J.Str("id"));
    }
}
