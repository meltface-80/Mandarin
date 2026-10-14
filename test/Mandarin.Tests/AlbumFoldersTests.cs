using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// An album is its folder (v0.6.0-RC8): two copies of a record in two folders are two albums, whatever
/// their tags say; disc folders ("Disc 1", "CD2", "DISC 1"…) inside one album's folder are one album. A
/// library scanned by an older version is put right on the first start, with favourites and edits kept
/// (test/album-folders.test.js, in C#).
/// </summary>
public sealed class AlbumFoldersTests
{
    private static Dictionary<string, object> Tags(int n, int disc = 1) => new()
        { ["title"] = $"Track {n}", ["artist"] = "Daft Punk", ["album_artist"] = "Daft Punk", ["album"] = "Random Access Memories", ["track"] = n, ["disc"] = disc, ["date"] = "2013" };

    private static void Ram(string music)
    {
        var two = Path.Combine(music, "Daft Punk", "Random Access Memories (2023)");
        for (int i = 1; i <= 2; i++) Fixtures.Gen(Path.Combine(two, "Disc 1", $"0{i}.flac"), seconds: 1, freq: 200 + i * 50, tags: Tags(i, 1));
        for (int i = 1; i <= 2; i++) Fixtures.Gen(Path.Combine(two, "Disc 2", $"0{i}.flac"), seconds: 1, freq: 400 + i * 50, tags: Tags(i, 2));
        var one = Path.Combine(music, "Daft Punk", "Random Access Memories (2013)");
        for (int i = 1; i <= 3; i++) Fixtures.Gen(Path.Combine(one, $"0{i}.flac"), seconds: 1, freq: 600 + i * 50, tags: Tags(i));
    }

    // An album's tracks, as its page lists them.
    private static async Task<List<JsonNode>> TracksOf(LibraryServer s, object id) => [.. (await s.Album(id))["tracks"].Items().Select(t => t!)];

    private static object Id(JsonNode a) => (long)a.Num("offset")!.Value;

    [Test]
    public async Task Two_folders_of_the_same_record_are_two_albums_disc_folders_are_one()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        Ram(lib.Music);
        // Disc folders named every usual way, in one album's folder: one album.
        var set = Path.Combine(lib.Music, "Band", "Box Set");
        string[] names = ["CD1", "DISC 2", "cd 3", "Disc4"];
        for (int i = 0; i < names.Length; i++)
            Fixtures.Gen(Path.Combine(set, names[i], "01.flac"), seconds: 1, freq: 300 + i * 40,
                tags: new Dictionary<string, object> { ["title"] = $"Disc {i + 1} opener", ["artist"] = "Band", ["album"] = "Box Set", ["track"] = 1, ["disc"] = i + 1 });
        await using var s = await LibraryServer.Start(lib);
        var albums = await s.Albums();
        var rams = albums.Where(a => a.Str("title") == "Random Access Memories").ToList();
        Assert.True(rams.Count == 2, "never merged with the other folder's copy");
        var counts = new List<int>();
        foreach (var a in rams) counts.Add((await TracksOf(s, Id(a))).Count);
        Assert.Equal([3, 4], counts.Order());
        var twoDisc = rams[counts.IndexOf(4)];
        Assert.Equal([1.0, 1, 2, 2], (await TracksOf(s, Id(twoDisc))).Select(x => x.Num("disc") ?? 0));
        // Its tiles say so (v0.6.0); a single disc says nothing.
        Assert.Equal(2, twoDisc.Num("discs"));
        Assert.Null(rams.First(a => a != twoDisc)["discs"]);
        var box = albums.Where(a => a.Str("title") == "Box Set").ToList();
        Assert.Single(box);
        Assert.Equal([1.0, 2, 3, 4], (await TracksOf(s, Id(box[0]))).Select(x => x.Num("disc") ?? 0));
        Assert.Equal(4, box[0].Num("discs"));
    }

    [Test]
    public async Task A_library_from_before_the_merged_album_comes_apart_its_favourite_and_edit_kept()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        Ram(lib.Music);
        await using var s = await LibraryServer.Start(lib);
        var db = s.Server;
        // Make it as an older version left it: keys without the folder, the two copies one album, a
        // favourite and an edit on it.
        var rams = db.Rows("SELECT a.id, a.key, COUNT(t.id) AS n FROM albums a JOIN tracks t ON t.album_id = a.id WHERE a.title = 'Random Access Memories' GROUP BY a.id ORDER BY n DESC");
        var (keep, other) = (rams[0], rams[1]);
        static string Legacy(object? key) => string.Join('\u0001', ((string)key!).Split('\u0001').Take(2));
        var legacy = Legacy(keep["key"]);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        db.Exec("UPDATE tracks SET album_id = $1 WHERE album_id = $2", keep["id"], other["id"]);
        db.Exec("DELETE FROM albums WHERE id = $1", other["id"]);
        foreach (var a in db.Rows("SELECT id, key FROM albums")) db.Exec("UPDATE albums SET key = $1 WHERE id = $2", Legacy(a["key"]), a["id"]);
        db.Exec("INSERT INTO favourites(key, added_at) VALUES($1, $2)", legacy, now);
        db.Exec("INSERT INTO album_edits(key, year, updated_at) VALUES($1, $2, $3)", legacy, 1999, now);
        db.SetSetting("album_key_v", 1);
        await s.Reload();
        Assert.Single(await s.Albums(), a => a.Str("title") == "Random Access Memories");

        // The update starts: keys gain their folder, and the scan regroups.
        await s.Restart();
        Assert.Equal(2, db.Setting("album_key_v")?.GetValue<int>());
        Assert.Equal("updated", (await s.Status())["scan"]?["last"].Str("status"));
        Assert.True(db.Setting("album_regroup")?.GetValue<bool>() == false, "done once");
        var after = (await s.Albums()).Where(a => a.Str("title") == "Random Access Memories").ToList();
        Assert.Equal(2, after.Count);
        var keepId = Convert.ToDouble(keep["id"], System.Globalization.CultureInfo.InvariantCulture);
        var first = after.FirstOrDefault(a => a.Num("offset") == keepId);
        Assert.True(first != null, "the album keeps its id");
        Assert.Equal(4, (await TracksOf(s, Id(first))).Count);
        Assert.True(first.Bool("favourite"));
        Assert.Equal(1999, first.Num("year"));
        var second = after.First(a => a.Num("offset") != keepId);
        Assert.Equal(3, (await TracksOf(s, Id(second))).Count);
        Assert.Null(second["favourite"]);
    }

    [Test]
    public async Task A_renamed_album_folder_is_the_same_album()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        await using var s = await LibraryServer.Start(lib);
        var al = (await s.Albums()).First(a => a.Str("title") == "Album One");
        Assert.Equal(200, (await s.PostJ("/api/favourites", new { offset = al.Num("offset"), on = true })).Status);
        var to = Path.Combine(lib.Music, "Artist A", "Album One (1997)");
        Directory.Move(Path.Combine(lib.Music, "Artist A", "Album One"), to);
        // A file touched too, so the folder is read and regrouped.
        var f = Directory.GetFiles(to, "*.flac")[0];
        File.SetLastWriteTimeUtc(f, DateTime.UtcNow.AddSeconds(5));
        await s.Scan();
        var again = (await s.Albums()).Where(a => a.Str("title") == "Album One").ToList();
        Assert.Single(again);
        Assert.Equal(al.Num("offset"), again[0].Num("offset"));
        Assert.True(again[0].Bool("favourite"));
    }

    [Test]
    public async Task A_box_set_filed_as_discs_that_are_albums_each_its_own_album_each_knowing_its_box()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        var box = Path.Combine(lib.Music, "Yes - The Steven Wilson Remixes (2018)");
        (string Folder, string Album)[] discs = [("Disc 1 - The Yes Album (1971)", "The Yes Album"), ("Disc 4 - Tales From Topographic Oceans (1973)", "Tales From Topographic Oceans"), ("Disc 5 - Relayer (1974)", "Relayer")];
        for (int d = 0; d < discs.Length; d++)
            for (int i = 1; i <= 2; i++)
                Fixtures.Gen(Path.Combine(box, discs[d].Folder, $"0{i}.flac"), seconds: 1, freq: 200 + d * 100 + i * 20,
                    tags: new Dictionary<string, object> { ["title"] = $"{discs[d].Album} {i}", ["artist"] = "Yes", ["album"] = discs[d].Album, ["track"] = i });
        // Plain disc folders of one album stay one album, with no box.
        var set = Path.Combine(lib.Music, "Band", "Double");
        string[] cds = ["CD1", "CD2"];
        for (int i = 0; i < cds.Length; i++)
            Fixtures.Gen(Path.Combine(set, cds[i], "01.flac"), seconds: 1, freq: 700 + i * 30,
                tags: new Dictionary<string, object> { ["title"] = "T" + i, ["artist"] = "Band", ["album"] = "Double", ["track"] = 1, ["disc"] = i + 1 });
        await using var s = await LibraryServer.Start(lib);
        var albums = await s.Albums();
        var yes = albums.Where(a => a.Str("subtitle") == "Yes").ToList();
        Assert.True(yes.Count == 3, "three albums, not one");
        // "of" is at least the highest disc filed: disc 4 of 5, though 2 and 3 aren't here.
        var tales = yes.First(a => a.Str("title") == "Tales From Topographic Oceans");
        JsonAssert.Same("""{"name":"The Steven Wilson Remixes (2018)","disc":4,"of":5}""", tales["box"]);
        // Its page offers the box's other discs, in their order.
        Assert.Equal([("The Yes Album", 1.0), ("Relayer", 5.0)], (await s.Album(Id(tales)))["box_albums"].Items().Select(a => (a.Str("title"), a.Num("disc") ?? 0)));
        var dbl = albums.First(a => a.Str("title") == "Double");
        Assert.Null(dbl["box"]);
        Assert.Empty((await s.Album(Id(dbl)))["box_albums"].Items());
    }
}
