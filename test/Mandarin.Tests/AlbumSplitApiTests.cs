using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Edit album's ways to take two copies merged into one album apart, and Library clean-up's list of them (bug list item
/// 424, AlbumSplitRoutes.cs, Scan/Scanner.Split.cs). Split… of one folder by the version words in its titles, kept
/// through a scan that regroups the folder, and Join back; by repeated track numbers; Split by folder of an album whose
/// tracks are in two folders, its Join back kept through a scan, and the clean-up list finding it; Look at this album
/// again reading only this album's folder. The folders aren't watched here: what changes is what was asked.
/// </summary>
public sealed class AlbumSplitApiTests
{
    // No scan of the watcher's between the steps.
    private static readonly Dictionary<string, string> Unwatched = new() { ["MANDARIN_WATCH_NOTIFY"] = "0", ["MANDARIN_WATCH_POLL_MS"] = "3600000" };

    private static long L(object? v) => Convert.ToInt64(v, System.Globalization.CultureInfo.InvariantCulture);

    private static async Task<JsonNode> Split(LibraryServer s, long offset, string by)
    {
        var (status, j) = await s.PostJ("/api/album/split", new { offset, by });
        Assert.True(status == 200, by + ": " + status + " " + j?.ToJsonString());
        return j!;
    }

    private static List<long> Ids(JsonNode j, string key = "albums") => [.. j[key].Items().Select(x => (long)x!.GetValue<double>())];

    private static string Parts(JsonNode? way) => string.Join(", ", way?["parts"].Items().Select(p => p.Str("name") + " " + p.Num("tracks")) ?? []);

    [Test]
    public async Task Split_by_the_version_words_of_one_folder_kept_through_a_scan_then_joined_back()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        var both = AlbumSplitTests.Owner(lib.Music);
        await using var s = await LibraryServer.Start(lib, env: Unwatched);
        var db = s.Server;
        var id = L(AlbumSplitTests.Moanins(db).Single(r => L(r["n"]) == 13)["id"]);
        Assert.Equal(200, (await s.PostJ("/api/favourites", new { offset = id, on = true })).Status);
        var split = (await s.GetJ("/api/album/edit?offset=" + id))["split"]!;
        Assert.Empty(split["folders"].Items());
        Assert.Equal(false, split.Bool("part"));
        var ways = split["ways"].Items().ToList();
        Assert.Equal("SACD Version 7, Remastered 2013 6", Parts(ways.Single(w => w.Str("by") == "words")));
        // Their formats lay them out the same way (24/88.2 and 24/192), and the numbers are offered only where nothing else is.
        Assert.Equal(["words"], ways.Select(w => w.Str("by")));

        var made = Ids(await Split(s, id, "words"));
        Assert.Equal(2, made.Count);
        Assert.Equal(id, made[0]);   // the biggest part keeps the album
        var rows = AlbumSplitTests.Moanins(db);
        Assert.Equal([7L, 6L, 6L], rows.Select(r => L(r["n"])).OrderDescending());
        Assert.Equal(7, L(rows.Single(r => L(r["id"]) == id)["n"]));
        var versions = (await s.Album(id))["versions"].Items().ToList();
        Assert.Equal(3, versions.Count);
        Assert.Contains("SACD Version", versions.Single(v => (long)v.Num("offset")! == id).Str("label"));
        Assert.True(versions.Single(v => (long)v.Num("offset")! == id).Bool("favourite"));
        Assert.Contains("Remastered 2013", versions.Single(v => (long)v.Num("offset")! == made[1]).Str("label"));
        Assert.Equal(true, (await s.GetJ("/api/album/edit?offset=" + made[1]))["split"].Bool("part"));

        // A scan that reads the folder again keeps to the split.
        var f = Directory.GetFiles(both, "*.flac")[0];
        File.SetLastWriteTimeUtc(f, DateTime.UtcNow.AddSeconds(5));
        Assert.Equal("updated", (await s.Scan()).Str("status"));
        Assert.Equal(3, AlbumSplitTests.Moanins(db).Count);
        Assert.Equal(7, L(AlbumSplitTests.Moanins(db).Single(r => L(r["id"]) == id)["n"]));

        // Join back: one album again, the one it was.
        var (st, j) = await s.PostJ("/api/album/join", new { offset = made[1] });
        Assert.True(st == 200, j?.ToJsonString());
        Assert.Equal([id], Ids(j!));
        rows = AlbumSplitTests.Moanins(db);
        Assert.Equal(2, rows.Count);
        Assert.Equal(13, L(rows.Single(r => L(r["id"]) == id)["n"]));
        Assert.Equal(0L, L(db.Scalar("SELECT COUNT(*) FROM album_splits")));
        File.SetLastWriteTimeUtc(f, DateTime.UtcNow.AddSeconds(10));
        await s.Scan();
        Assert.Equal(13, L(AlbumSplitTests.Moanins(db).Single(r => L(r["id"]) == id)["n"]));
        Assert.True((await s.Album(id))["versions"].Items().Single(v => (long)v.Num("offset")! == id).Bool("favourite"));
    }

    [Test]
    public async Task Split_by_repeated_track_numbers_where_nothing_else_tells_the_copies_apart()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        var dir = Path.Combine(lib.Music, "Band", "Twice");
        foreach (var copy in new[] { "a", "b" })
            for (int i = 1; i <= 2; i++)
                Fixtures.Gen(Path.Combine(dir, $"{copy}-{i:00}.flac"), seconds: 1, freq: 300 + i * 50 + (copy == "b" ? 7 : 0),
                    tags: new Dictionary<string, object> { ["title"] = "Song " + i, ["artist"] = "Band", ["album"] = "Twice", ["track"] = i });
        await using var s = await LibraryServer.Start(lib, env: Unwatched);
        var id = (long)(await s.Albums()).Single(a => a.Str("title") == "Twice").Num("offset")!;
        var ways = (await s.GetJ("/api/album/edit?offset=" + id))["split"]!["ways"].Items().ToList();
        Assert.Equal(["numbers"], ways.Select(w => w.Str("by")));
        Assert.Equal("Copy 1 2, Copy 2 2", Parts(ways[0]));
        var merged = await s.GetJ("/api/library/merged");
        var row = merged["albums"].Items().Single(a => a.Str("title") == "Twice");
        Assert.True(row.Bool("repeats") == true && row.Num("folders") == 1);
        var made = Ids(await Split(s, id, "numbers"));
        Assert.Equal(2, made.Count);
        foreach (var a in made)
        {
            var tracks = (await s.Album(a))["tracks"].Items().ToList();
            Assert.Equal(["Song 1", "Song 2"], tracks.Select(t => t.Str("title")));
        }
        Assert.DoesNotContain((await s.GetJ("/api/library/merged"))["albums"].Items(), a => a.Str("title") == "Twice");
    }

    [Test]
    public async Task Split_by_folder_its_Join_back_kept_through_a_scan_and_the_clean_up_list()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        var one = Path.Combine(lib.Music, "Artist A", "Album One");
        var other = Path.Combine(lib.Music, "Artist A", "Album One (Mono)");
        for (int i = 1; i <= 2; i++)
            Fixtures.Gen(Path.Combine(other, $"0{i} Song {i}.flac"), seconds: 1, freq: 640 + i * 30,
                tags: new Dictionary<string, object> { ["title"] = $"Song {i}", ["artist"] = "Artist A", ["album"] = "Album One", ["track"] = i, ["date"] = "1997" });
        await using var s = await LibraryServer.Start(lib, env: Unwatched);
        var db = s.Server;
        // As a library merged them before item 424: one album over two folders.
        var ids = db.Rows("SELECT a.id, COUNT(t.id) AS n FROM albums a JOIN tracks t ON t.album_id = a.id WHERE a.title = 'Album One' GROUP BY a.id ORDER BY n DESC");
        var (id, gone) = (L(ids[0]["id"]), L(ids[1]["id"]));
        db.Exec("UPDATE tracks SET album_id = $1 WHERE album_id = $2", id, gone);
        db.Exec("DELETE FROM albums WHERE id = $1", gone);
        await s.Reload();
        Assert.Equal(200, (await s.PostJ("/api/favourites", new { offset = id, on = true })).Status);

        var listed = (await s.GetJ("/api/library/merged"))["albums"].Items().Single(a => (long)a.Num("offset")! == id);
        Assert.True(listed.Num("folders") == 2 && listed.Num("tracks") == 5, listed?.ToJsonString());
        var folders = (await s.GetJ("/api/album/edit?offset=" + id))["split"]!["folders"].Items().ToList();
        Assert.Equal(["Album One 3", "Album One (Mono) 2"], folders.Select(x => x.Str("folder") + " " + x.Num("tracks")));

        var made = Ids(await Split(s, id, "folder"));
        Assert.Equal(2, made.Count);
        Assert.Equal(id, made[0]);
        Assert.Equal(3, (await s.Album(id))["tracks"].Items().Count());
        Assert.Equal(2, (await s.Album(made[1]))["tracks"].Items().Count());
        Assert.True((await s.Album(id))["versions"].Items().Single(v => (long)v.Num("offset")! == id).Bool("favourite"));
        Assert.DoesNotContain((await s.GetJ("/api/library/merged"))["albums"].Items(), a => (long)a.Num("offset")! == id);

        // Undo: joined back, and kept so by a scan that reads both folders again.
        var (st, j) = await s.PostJ("/api/album/join", new { offset = id, with = new[] { made[1] } });
        Assert.True(st == 200, j?.ToJsonString());
        Assert.Equal(5, (await s.Album(id))["tracks"].Items().Count());
        foreach (var d in new[] { one, other }) File.SetLastWriteTimeUtc(Directory.GetFiles(d, "*.flac")[0], DateTime.UtcNow.AddSeconds(5));
        Assert.Equal("updated", (await s.Scan()).Str("status"));
        Assert.Equal(5, (await s.Album(id))["tracks"].Items().Count());
        Assert.DoesNotContain((await s.GetJ("/api/library/merged"))["albums"].Items(), a => (long)a.Num("offset")! == id);
        // Split by folder again lets the join go.
        Assert.Equal(2, Ids(await Split(s, id, "folder")).Count);
        Assert.Equal(0L, L(db.Scalar("SELECT COUNT(*) FROM album_joins")));
    }

    [Test]
    public async Task Look_at_this_album_again_reads_its_folder_now_and_groups_it_from_scratch()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        await using var s = await LibraryServer.Start(lib, env: Unwatched);
        var id = (long)(await s.Albums()).Single(a => a.Str("title") == "Album One").Num("offset")!;
        // A track's tags rewritten: its album now another, the file's time as it was.
        var f = Path.Combine(lib.Music, "Artist A", "Album One", "03 Song 3.flac");
        var when = File.GetLastWriteTimeUtc(f);
        Fixtures.Gen(f, seconds: 3, freq: 600,
            tags: new Dictionary<string, object> { ["title"] = "Song 3", ["artist"] = "Artist A", ["album"] = "Album Three", ["track"] = 3, ["date"] = "1997" });
        File.SetLastWriteTimeUtc(f, when);
        Assert.DoesNotContain(await s.Albums(), a => a.Str("title") == "Album Three");
        var (st, j) = await s.PostJ("/api/album/look-again", new { offset = id });
        Assert.True(st == 200, j?.ToJsonString());
        var albums = Ids(j!);
        Assert.Equal(2, albums.Count);
        Assert.Equal(id, albums[0]);
        Assert.Equal(2, (await s.Album(id))["tracks"].Items().Count());
        var three = (await s.Albums()).Single(a => a.Str("title") == "Album Three");
        Assert.Equal(albums[1], (long)three.Num("offset")!);
        // The other albums untouched.
        Assert.Equal(2, (await s.Album((await s.Albums()).Single(a => a.Str("title") == "Hi Res").Num("offset")!))["tracks"].Items().Count());
    }
}
