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

    [Test]
    public async Task A_long_copy_is_read_while_it_goes_on_not_only_once_it_ends()
    {
        // Item 356: a file every 100 ms for four seconds, never quiet for the quiet time. Before, each change began the
        // wait again, so nothing was read until the copy ended; now it is read no later than the longest wait after its first change.
        var root = Directory.CreateTempSubdirectory("musicd-watch-").FullName;
        var a = Path.Combine(root, "a"); Directory.CreateDirectory(a);
        await using var s = await LibraryServer.Start(new Fixtures.Library(root, a, Path.Combine(root, "data")), env: new Dictionary<string, string>
        {
            ["MANDARIN_WATCH_QUIET_MS"] = "1500", ["MANDARIN_WATCH_GAP_MS"] = Gap.ToString(System.Globalization.CultureInfo.InvariantCulture)
        });
        int Scans() => s.Server.Logs.Count(l => ScanRe().IsMatch(l));
        s.Server.SetSetting("music_folders", new[] { a });
        await s.Scan();
        // Heard at all, and that scan let finish.
        var probe = Path.Combine(a, "probe");
        for (int i = 0; i < 100 && Scans() == 0; i++) { await File.WriteAllTextAsync(probe, i.ToString(System.Globalization.CultureInfo.InvariantCulture)); await Task.Delay(100); }
        await Until(() => Scans() >= 1);
        await Task.Delay(Settled);
        int @base = Scans();
        for (int i = 0; i < 40; i++)
        {
            var album = Path.Combine(a, "Artist", "Album " + (i / 10));
            Directory.CreateDirectory(album);
            await File.WriteAllTextAsync(Path.Combine(album, $"{i % 10:00}.flac"), "x");
            await Task.Delay(100);
        }
        int during = Scans() - @base;
        Assert.True(during >= 3, $"read while the copy went on ({during} scans in four seconds)");
        // Once it ends, the last of it read (a scan or two more: one may have been under way as it ended), then quiet:
        // no reading on and on.
        await Task.Delay(1500 + Gap + Settled);
        int after = Scans();
        Assert.True(after - (@base + during) <= 2, $"a scan or two more for the last of it ({after - @base - during})");
        await Task.Delay(Settled);
        Assert.Equal(after, Scans());
    }

    [Test]
    public async Task A_folder_whose_changes_cant_be_heard_is_looked_at_an_album_added_and_one_removed_noticed()
    {
        // Item 356: a network share's changes made from another machine are never told; its folders' times are looked at
        // instead (here every 200 ms, with the notifications turned off as a share has none).
        var root = Directory.CreateTempSubdirectory("musicd-watch-").FullName;
        var a = Path.Combine(root, "a"); Directory.CreateDirectory(a);
        await using var s = await LibraryServer.Start(new Fixtures.Library(root, a, Path.Combine(root, "data")), env: new Dictionary<string, string>
        {
            ["MANDARIN_WATCH_QUIET_MS"] = Quiet.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["MANDARIN_WATCH_GAP_MS"] = Gap.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["MANDARIN_WATCH_POLL_MS"] = "200", ["MANDARIN_WATCH_NOTIFY"] = "0"
        });
        int Scans() => s.Server.Logs.Count(l => ScanRe().IsMatch(l));
        s.Server.SetSetting("music_folders", new[] { a });
        await s.Scan();
        await Until(() => s.Server.Logs.Any(l => l.Contains("[watch] looking at " + a + " every", StringComparison.Ordinal)));
        Assert.True(s.Server.Logs.Any(l => l.Contains("[watch] looking at " + a + " every", StringComparison.Ordinal)), "the folder is looked at");
        Assert.DoesNotContain(s.Server.Logs, l => l.TrimEnd().EndsWith("[watch] watching " + a, StringComparison.Ordinal));
        await Task.Delay(Settled);
        int @base = Scans();
        // An album copied in: a folder's time moves.
        var album = Path.Combine(a, "Artist", "Album");
        Directory.CreateDirectory(album);
        await File.WriteAllTextAsync(Path.Combine(album, "01.flac"), "x");
        await Until(() => Scans() >= @base + 1);
        Assert.True(Scans() >= @base + 1, "the album added was noticed");
        await Task.Delay(Settled);
        @base = Scans();
        // Nothing moved: nothing read.
        await Task.Delay(Settled);
        Assert.Equal(@base, Scans());
        // The album deleted.
        Directory.Delete(Path.Combine(a, "Artist"), true);
        await Until(() => Scans() >= @base + 1);
        Assert.True(Scans() >= @base + 1, "the album removed was noticed");
    }

    [GeneratedRegex(@"\[watch\] \d+ changes? in the music folders")]
    private static partial Regex ScanRe();
}
