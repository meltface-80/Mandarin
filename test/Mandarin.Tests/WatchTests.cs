using System.Diagnostics;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// The music folders watched: a file added or removed starts one scan once the changes have gone quiet;
/// a folder that appears later is watched too, and one taken out of the library is let go. The C#
/// server's watching (Scans.cs, Watcher), its quiet and gap shortened, the scans it starts counted from
/// what it says as it starts each and the folders it watches from "[watch] watching &lt;dir&gt;"
/// (test/watch.test.js, in C#).
/// </summary>
public sealed partial class WatchTests
{
    private const int Quiet = 300, Gap = 600, Settled = 2000;

    // Until fn() holds, or ms have gone: the file system tells of a change, and the quiet is waited out.
    private static async Task Until(Func<bool> fn, int ms = 15000) { var t0 = Stopwatch.StartNew(); while (!fn() && t0.ElapsedMilliseconds < ms) await Task.Delay(20); }

    [Test]
    public async Task Changes_in_a_watched_folder_are_noticed_and_gathered_into_one_scan()
    {
        var root = Directory.CreateTempSubdirectory("musicd-watch-").FullName;
        var a = Path.Combine(root, "a"); Directory.CreateDirectory(a);
        var b = Path.Combine(root, "b");
        await using var s = await LibraryServer.Start(new Fixtures.Library(root, a, Path.Combine(root, "data")), env: new Dictionary<string, string>
        {
            ["MANDARIN_WATCH_QUIET_MS"] = Quiet.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["MANDARIN_WATCH_GAP_MS"] = Gap.ToString(System.Globalization.CultureInfo.InvariantCulture)
        });
        int Scans() => s.Server.Logs.Count(l => ScanRe().IsMatch(l));
        bool Watching(string d) => s.Server.Logs.Any(l => l.TrimEnd().EndsWith("[watch] watching " + d, StringComparison.Ordinal));

        // Both folders the library's; only the one that exists is watched (from the next refresh, after a scan).
        s.Server.SetSetting("music_folders", new[] { a, b });
        await s.Scan();
        Assert.True(Watching(a), "the folder that exists is watched");
        Assert.False(Watching(b), "only the folder that exists is watched");
        // Hearing already? A file written until it is heard, and its scan let finish: the counting starts after.
        var probe = Path.Combine(a, "probe");
        for (int i = 0; i < 100 && Scans() == 0; i++) { await File.WriteAllTextAsync(probe, i.ToString(System.Globalization.CultureInfo.InvariantCulture)); await Task.Delay(100); }
        await Until(() => Scans() >= 1);
        Assert.True(Scans() >= 1, "the watch hears a change at all");
        await Task.Delay(Settled);
        int @base = Scans();
        // Several files in quick succession: one scan, after the quiet.
        Directory.CreateDirectory(Path.Combine(a, "Artist", "Album"));
        for (int i = 0; i < 5; i++) await File.WriteAllTextAsync(Path.Combine(a, "Artist", "Album", $"0{i}.flac"), "x");
        await Until(() => Scans() >= @base + 1);
        Assert.True(Scans() == @base + 1, "one scan for the burst");
        // Quiet: no more.
        await Task.Delay(Settled);
        Assert.Equal(@base + 1, Scans());
        // A deletion counts too (after the minimum gap).
        Directory.Delete(Path.Combine(a, "Artist"), true);
        await Until(() => Scans() >= @base + 2);
        Assert.True(Scans() == @base + 2, "the removal was noticed");
        await Task.Delay(Settled);
        Assert.True(Scans() == @base + 2, "one scan for the removal");
        // The second folder appears: watched after a refresh, and heard.
        Directory.CreateDirectory(b);
        await s.Scan();
        Assert.True(Watching(b), "the folder that appeared is watched");
        await File.WriteAllTextAsync(Path.Combine(b, "new.flac"), "x");
        await Until(() => Scans() >= @base + 3);
        Assert.True(Scans() == @base + 3, "a change in it heard");
        await Task.Delay(Settled);
        // Taken out of the library: let go at the next refresh, its changes no longer heard.
        s.Server.SetSetting("music_folders", new[] { a });
        await s.Scan();
        int before = Scans();
        await File.WriteAllTextAsync(Path.Combine(b, "other.flac"), "x");
        await Task.Delay(Settled);
        Assert.True(Scans() == before, "a folder removed from the library is let go");
    }

    [GeneratedRegex(@"\[watch\] \d+ changes? in the music folders")]
    private static partial Regex ScanRe();
}
