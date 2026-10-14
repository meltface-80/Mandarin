namespace Mandarin.Tests;

/// <summary>
/// The waveform behind the progress bar (server/Mandarin.Server/Waveforms.cs, v0.8.19): off until it's
/// switched on; a track named by its id or by its title, album and artist; 4,000 buckets, decoded once
/// and kept, as the Node server drew them (WaveformRule); what isn't a file of ours says so
/// (test/waveform.test.js, in C#).
/// </summary>
public sealed class WaveformTests
{
    [Test]
    public async Task Waveforms_off_until_switched_on_by_id_or_by_name_decoded_once_and_kept()
    {
        await using var s = await Session.Started();
        // Song 2 of Album One, as the scan wrote it.
        var t = s.Server.Rows("SELECT id, path, duration FROM tracks WHERE title = 'Song 2'")[0];
        var id = Convert.ToInt64(t["id"], System.Globalization.CultureInfo.InvariantCulture);

        var r = await s.Api("settings/waveform");
        Assert.False(r.J.Bool("enabled"));
        Assert.NotNull(r.J.Bool("decoder"));
        r = await s.Api("waveform?track_id=" + id);
        Assert.Equal((null, "off"), (r.J.Str("peaks"), r.J.Str("reason")));
        Assert.True(r.Header("x-mandarin-answered") == "C#", "waveforms are the C# server's");

        Assert.Equal(400, (await s.Api("settings/waveform", new { })).Status);
        r = await s.Api("settings/waveform", new { enabled = true });
        Assert.Equal((true, true), (r.J.Bool("ok"), r.J.Bool("enabled")));
        Assert.True((await s.Api("settings/waveform")).J.Bool("enabled"));

        // By id: decoded now, kept; asked again, from what was kept.
        r = await s.Api("waveform?track_id=" + id);
        Assert.True(r.Status == 200, r.Text);
        Assert.Equal((4000.0, false), (r.J.Num("n"), r.J.Bool("cached")));
        Assert.Matches("immutable", r.Header("cache-control") ?? "");
        var want = WaveformRule.Of((string)t["path"]!, Convert.ToDouble(t["duration"], System.Globalization.CultureInfo.InvariantCulture));
        Assert.True(want == r.J.Str("peaks"), "the same buckets as the Node server drew");
        r = await s.Api("waveform?track_id=" + id);
        Assert.Equal((want, 4000.0, true), (r.J.Str("peaks"), r.J.Num("n"), r.J.Bool("cached")));

        // By its title, album and artist (as a speaker names what it plays).
        r = await s.Api("waveform?track=Song%202&album=Album%20One&artist=Artist%20A");
        Assert.Equal((want, true), (r.J.Str("peaks"), r.J.Bool("cached")));
        r = await s.Api("waveform?track=song%202&album=album%20one");
        Assert.True(want == r.J.Str("peaks"), "names folded; no artist needed");

        // What isn't ours, or isn't said.
        Assert.Equal(400, (await s.Api("waveform")).Status);
        r = await s.Api("waveform?track=Nothing&album=Nowhere");
        Assert.Equal((null, "no-local-file"), (r.J.Str("peaks"), r.J.Str("reason")));
        r = await s.Api("waveform?track_id=999999");
        Assert.Equal((null, "no-local-file"), (r.J.Str("peaks"), r.J.Str("reason")));

        // Off again: nothing.
        await s.Api("settings/waveform", new { enabled = false });
        Assert.Equal("off", (await s.Api("waveform?track_id=" + id)).J.Str("reason"));
    }
}
