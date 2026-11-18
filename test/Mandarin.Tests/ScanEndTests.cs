namespace Mandarin.Tests;

/// <summary>
/// A scan is under way until the library has been read again (v1.0.17, Scans.cs): /api/status never
/// says it ended before then, so a page (or a test) that sees it ended and asks for the albums gets the
/// ones it made, not "still being scanned" or the list from before it. It said so for a moment as the
/// scan gave its result, and a test that asked then was answered 503.
/// </summary>
public sealed class ScanEndTests
{
    [Test]
    public async Task Once_status_says_a_scan_ended_its_albums_are_there()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        foreach (var f in Directory.GetFiles(lib.Music, "*", SearchOption.AllDirectories)) File.Delete(f);
        // The scans here are the ones asked for below, and no others (item 482): the watcher, which hears each file
        // written, kept quiet for the test's length, and the first scan (half a second after the start) ended before
        // any file is written. On a busy machine the watcher's own scan ("the music folders changed during the scan:
        // reading them again") ran as the third file was being written and rightly ended with two albums; the test
        // saw that one end, and wanted three.
        await using var s = await LibraryServer.Start(lib, env: new Dictionary<string, string> { ["MANDARIN_WATCH_QUIET_MS"] = "600000", ["MANDARIN_WATCH_MAX_MS"] = "600000" });
        var h = new Dictionary<string, string> { ["Authorization"] = "Bearer " + s.Token };
        async Task<bool> Idle() => (await Http.Get(s.B + "/api/status", h)).Json?["scan"] is { } sc && sc.Bool("running") == false && sc["last"] != null;
        await Session.Until(Idle, 60000, "the first scan");
        var wrong = new List<string>();
        var looked = 0;
        for (int n = 1; n <= 6; n++)
        {
            Fixtures.Gen(Path.Combine(lib.Music, $"Artist {n}", $"Album {n}", "01.flac"), seconds: 1,
                tags: new Dictionary<string, object> { ["title"] = "One", ["artist"] = $"Artist {n}", ["album"] = $"Album {n}", ["track"] = 1 });
            using var done = new CancellationTokenSource();
            var watching = Task.Run(async () =>
            {
                // Each status read as a page reads it: once the scan has been seen under way and then ended, the albums asked for at once.
                bool seen = false;
                while (true)
                {
                    var st = (await Http.Get(s.B + "/api/status", h)).Json;
                    if (st?["scan"].Bool("running") == true) seen = true;
                    else if (seen && st?["scan"]?["last"] != null)
                    {
                        var a = await Http.Get(s.B + "/api/library/albums?count=200", h);
                        var count = a.Status == 200 ? a.J["albums"].Items().Count() : -1;
                        if (count != n) wrong.Add($"scan {n}: ended, then the albums answered {a.Status} with {count}");
                        Interlocked.Increment(ref looked);
                        return;
                    }
                    if (done.IsCancellationRequested) return;
                }
            });
            var (status, j) = await s.PostJ("/api/library/rescan", new { force = true });
            Assert.True(status == 200, "rescan " + status + " " + j?.ToJsonString());
            // A rescan answers after 8 s at most, the scan still going on a busy machine: its end waited for, so the
            // next file isn't written (and the next scan looked for) while this one is under way.
            await Session.Until(Idle, 60000, $"scan {n} ended");
            await Task.Delay(500);
            done.Cancel();
            await watching;
        }
        Assert.True(wrong.Count == 0, string.Join("; ", wrong));
        // Each of the six seen under way and looked at as it ended: where a rescan was answered "busy" and the watch let
        // go half a second later, the test passed having looked at none (17 s with each scan's end held 5.5 s, item 482).
        Assert.True(looked == 6, $"{looked} of 6 scans were seen ending and their albums asked for");
    }

    [Test]
    public async Task A_scan_is_under_way_until_the_library_is_read_again_though_its_last_tick_says_it_ended()
    {
        // The scan's ticks (every half second) went on after it ended and before its result: one said "not running",
        // and a page that saw it asked for the albums before the server had read them (item 257; 5 runs in 113). Held
        // open here: the scan waits 1.5 s between its end and its result, its ticks saying it ended all the while.
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        foreach (var f in Directory.GetFiles(lib.Music, "*", SearchOption.AllDirectories)) File.Delete(f);
        await using var s = await LibraryServer.Start(lib, env: new Dictionary<string, string> { ["MANDARIN_SCAN_END_WAIT_MS"] = "1500" });
        var h = new Dictionary<string, string> { ["Authorization"] = "Bearer " + s.Token };
        await Session.Until(async () => (await Http.Get(s.B + "/api/status", h)).Json?["scan"].Bool("running") == false, 30000, "the first scan");
        Fixtures.Gen(Path.Combine(lib.Music, "Artist", "Album", "01.flac"), seconds: 1,
            tags: new Dictionary<string, object> { ["title"] = "One", ["artist"] = "Artist", ["album"] = "Album", ["track"] = 1 });
        var post = s.PostJ("/api/library/rescan", new { force = true });
        bool seen = false;
        int? count = null;
        for (var t0 = DateTime.UtcNow; count == null && DateTime.UtcNow - t0 < TimeSpan.FromSeconds(30);)
        {
            var st = (await Http.Get(s.B + "/api/status", h)).Json;
            if (st?["scan"].Bool("running") == true) seen = true;
            else if (seen) count = (await Http.Get(s.B + "/api/library/albums?count=200", h)).J["albums"].Items().Count();
        }
        await post;
        Assert.True(seen, "the scan was seen under way");
        Assert.True(count == 1, $"ended, then the albums answered {count}");
    }
}
