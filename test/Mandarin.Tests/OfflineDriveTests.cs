using System.Globalization;

namespace Mandarin.Tests;

/// <summary>
/// A drive that isn't there right now is not music that is gone (Scan/OfflineDrives.cs): a drive once mounted
/// anywhere under a watched folder (the setting musicMounts, remembered at each scan) keeps its tracks while its
/// folder is there and empty, as a watched folder missing does, and Home says so; a drive whose folder is gone too was
/// taken away, and its tracks go. Before, only a folder directly in the music folder was kept so: a drive one deeper
/// (a pool of drives, /music/pool/d3) unmounted lost every track it held at the next scan.
/// </summary>
public sealed class OfflineDriveTests
{
    [Test]
    public async Task A_drive_not_mounted_keeps_its_tracks_and_one_taken_away_lets_them_go()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        var d1 = Path.Combine(lib.Music, "pool", "d1");
        var d3 = Path.Combine(lib.Music, "pool", "d3");
        foreach (var (dir, album, freq) in new[] { (d1, "On D1", 300), (d3, "On D3", 500) })
            for (var i = 1; i <= 2; i++)
                Fixtures.Gen(Path.Combine(dir, "Artist P", album, $"0{i} T{i}.flac"), freq: freq + i, tags: new Dictionary<string, object> { ["title"] = $"T{i}", ["artist"] = "Artist P", ["album"] = album, ["track"] = i });
        await using var s = await Session.Started(lib: lib);
        long On(string dir) => Convert.ToInt64(s.Server.Scalar("SELECT COUNT(*) FROM tracks WHERE path LIKE $1", dir + "/%"), CultureInfo.InvariantCulture);
        await Session.Until(() => Task.FromResult(On(d3) == 2 && On(d1) == 2), 30000, "the pool read");
        // d3 was seen mounted at an earlier scan (as /proc/self/mountinfo would have said).
        s.Server.Exec("INSERT OR REPLACE INTO settings(key, value) VALUES('musicMounts', $1)", $"[\"{d3}\"]");

        // Unmounted: its folder there and empty. Kept, and said.
        foreach (var f in Directory.GetDirectories(d3)) Directory.Delete(f, true);
        Assert.Equal(200, (await s.Api("library/rescan", new { })).Status);
        Assert.Equal((2L, 2L), (On(d3), On(d1)));
        var last = (await s.Api("status")).J?["scan"]?["last"];
        Assert.True(last?["offline_dirs"].Items().Select(d => (d.Str("dir"), d.Str("reason"))).SequenceEqual([(d3, "empty")]), last?.ToJsonString());

        // Back: as it was.
        Fixtures.Gen(Path.Combine(d3, "Artist P", "On D3", "01 T1.flac"), freq: 501, tags: new Dictionary<string, object> { ["title"] = "T1", ["artist"] = "Artist P", ["album"] = "On D3", ["track"] = 1 });
        Fixtures.Gen(Path.Combine(d3, "Artist P", "On D3", "02 T2.flac"), freq: 502, tags: new Dictionary<string, object> { ["title"] = "T2", ["artist"] = "Artist P", ["album"] = "On D3", ["track"] = 2 });
        Assert.Equal(200, (await s.Api("library/rescan", new { })).Status);
        Assert.Equal(2L, On(d3));

        // Taken away: the folder gone too. Its tracks go, and the drive is forgotten.
        Directory.Delete(d3, true);
        Assert.Equal(200, (await s.Api("library/rescan", new { })).Status);
        Assert.Equal((0L, 2L), (On(d3), On(d1)));
        Assert.Equal("[]", Convert.ToString(s.Server.Scalar("SELECT value FROM settings WHERE key = 'musicMounts'"), CultureInfo.InvariantCulture));
    }
}
