namespace Mandarin.Tests;

/// <summary>
/// Listen later (Stage 7): albums put aside, kept on the server by the album's identity, newest first;
/// off the list once every track has been played since (a play recorded by the zones, as history is)
/// or by hand (test/listen-later.test.js, in C#).
/// </summary>
public sealed class ListenLaterTests
{
    private static async Task<List<string>> Later(Session s) => [.. (await s.Api("listen-later")).J["albums"].Items().Select(a => a.Str("title") ?? "")];

    [Test]
    public async Task Listen_later()
    {
        await using var s = await Session.Started();
        var cd = (await s.Album("Album One"))!; var hi = (await s.Album("Hi Res"))!; var best = (await s.Album("Best Of"))!;
        Assert.Null(cd["later"]);
        Assert.Empty(await Later(s));

        // One at a time, and several at once (the selection menu).
        var r = await s.Api("listen-later", new { offset = cd.Num("offset"), on = true });
        Assert.Equal(200, r.Status); Assert.True(r.J.Bool("later"));
        await Task.Delay(5);
        r = await s.Api("listen-later", new { offsets = new[] { hi.Num("offset"), best.Num("offset") }, on = true });
        Assert.Equal(2, r.J.Num("count"));
        var titles = await Later(s);
        Assert.Equal(["Album One", "Best Of", "Hi Res"], titles.Order(StringComparer.Ordinal).ToArray());
        Assert.True(titles[2] == "Album One", "newest first: the one put aside first is last");
        Assert.True((await s.Api("album?offset=" + cd.Num("offset"))).J["album"].Bool("later"));
        Assert.True((await s.Album("Album One")).Bool("later"));
        Assert.True((await s.Api("settings/home-rows")).J["rows"].Items().Any(x => x.Str("id") == "later"), "a Home row of its own");

        // Survives the library being rebuilt from the files.
        await s.Server.Reload();
        Assert.Equal(3, (await Later(s)).Count);

        // By hand.
        r = await s.Api("listen-later", new { offset = best.Num("offset"), on = false });
        Assert.False(r.J.Bool("later"));
        Assert.Equal(["Hi Res", "Album One"], await Later(s));
        Assert.Equal(404, (await s.Api("listen-later", new { offset = 999999, on = true })).Status);

        // Played through: a play for each track, as the zones record them (here the phone, this signed-in
        // app, given the album and saying what it plays). Two of three leaves it on the list; the third takes it off.
        var zoneId = (await s.Api("phone/hello", new { name = "Pixel 8" })).J.Str("zone_id");
        Assert.Equal(200, (await s.Api("play", new { offset = cd.Num("offset"), zone_or_output_id = zoneId, kind = "play_now" })).Status);
        // A play counts once the track is half way (30 s of 60): said so by the phone.
        async Task Playing(int index)
        {
            await s.Api("phone/state", new { index, position = 31, duration = 60, state = "playing", volume = 40 });
            await Session.Until(async () => (await s.Api("zone-state?zone=" + zoneId)).J["zone"]?["now_playing"].Str("line1") == "Song " + (index + 1), 10000);
        }
        await Playing(0); await Playing(1);
        await Session.Until(() => Task.FromResult(Convert.ToInt64(s.Server.Scalar("SELECT COUNT(DISTINCT track_id) AS n FROM plays WHERE album_id = $1", cd.Num("offset")), System.Globalization.CultureInfo.InvariantCulture) == 2), 10000);
        Assert.True((await Later(s)).Contains("Album One"), "two of three played: still on the list");
        await Playing(2);
        await Session.Until(async () => !(await Later(s)).Contains("Album One"), 10000);
        Assert.True((await Later(s)).SequenceEqual(["Hi Res"]), "every track played: off the list");
        // Plays from before it was put aside don't count: the same album again.
        await s.Api("listen-later", new { offset = cd.Num("offset"), on = true });
        Assert.Contains("Album One", await Later(s));
    }
}
