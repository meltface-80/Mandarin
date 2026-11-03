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
        await using var s = await LibraryServer.Start(lib);
        var h = new Dictionary<string, string> { ["Authorization"] = "Bearer " + s.Token };
        var wrong = new List<string>();
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
                        return;
                    }
                    if (done.IsCancellationRequested) return;
                }
            });
            var (status, j) = await s.PostJ("/api/library/rescan", new { force = true });
            Assert.True(status == 200, "rescan " + status + " " + j?.ToJsonString());
            await Task.Delay(500);
            done.Cancel();
            await watching;
        }
        Assert.True(wrong.Count == 0, string.Join("; ", wrong));
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
