using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Two copies of a record merged into one album come apart when their files are moved into a folder each (bug list
/// item 424, Scan/Scanner.Split.cs). The owner's Moanin': the 2013 remaster (6 tracks, 24/192) and the SACD version (7,
/// 24/88.2) in one folder with one album tag were one album of 13, rightly; moved into two sibling folders, every scan
/// after said "moved 7 files" and kept the one album, as a moved file keeps its album. Now the scan groups an album whose
/// tracks are in two folders by folder: the folder with most of them keeps the album (its id, heart and plays), the
/// other is an album of its own, a version of it beside the 1998 edition already apart. A whole album moved stays one
/// album with its id, and an album moved into disc folders ("CD1", "CD2") stays one.
/// </summary>
public sealed class AlbumSplitTests
{
    internal const string Act = "Art Blakey & The Jazz Messengers";
    internal static readonly string[] Remaster = ["Moanin'", "Are You Real", "Along Came Betty", "The Drum Thunder Suite", "Blues March", "Come Rain or Come Shine"];
    internal static readonly string[] Sacd = [.. Remaster, "Moanin' (Alternate Take)"];

    // One track of a copy: its title with the copy's words, as the owner's files are named and tagged.
    internal static void Track(string dir, int n, string title, string words, int rate, string? fmt = "s32", string? bits = "24", string album = "Moanin'") =>
        Fixtures.Gen(Path.Combine(dir, $"{n:00} - {title} ({words}).flac"), seconds: 1, freq: 200 + n * 40 + rate / 4000, rate: rate, fmt: fmt,
            codecArgs: bits != null ? ["-bits_per_raw_sample", bits] : null,
            tags: new Dictionary<string, object> { ["title"] = $"{title} ({words})", ["artist"] = Act, ["album"] = album, ["track"] = n, ["date"] = "1959" });

    /// <summary>The owner's folder before the move: both copies in one, interleaved by name; and the 1998 edition in its own.</summary>
    internal static string Owner(string music)
    {
        var both = Path.Combine(music, Act, "Moanin' (1959)");
        for (int i = 0; i < Remaster.Length; i++) Track(both, i + 1, Remaster[i], "Remastered 2013", 192000);
        for (int i = 0; i < Sacd.Length; i++) Track(both, i + 1, Sacd[i], "SACD Version", 88200);
        var rvg = Path.Combine(music, Act, "Moanin' (1958) (Remastered 1998_Rudy Van Gelder Edition)");
        for (int i = 0; i < Remaster.Length; i++)
            Fixtures.Gen(Path.Combine(rvg, $"{i + 1:00} - {Remaster[i]}.flac"), seconds: 1, freq: 900 + i * 30,
                tags: new Dictionary<string, object> { ["title"] = Remaster[i], ["artist"] = Act, ["album"] = "Moanin'", ["track"] = i + 1, ["date"] = "1959" });
        Fixtures.Run(["-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=300x300", "-frames:v", "1", Path.Combine(both, "folder.jpg")]);
        return both;
    }

    internal static List<Dictionary<string, object?>> Moanins(TestServer db) =>
        db.Rows("SELECT a.id, a.dir, a.key, COUNT(t.id) AS n FROM albums a JOIN tracks t ON t.album_id = a.id WHERE a.title = 'Moanin''' GROUP BY a.id ORDER BY a.id");

    private static long L(object? v) => Convert.ToInt64(v, System.Globalization.CultureInfo.InvariantCulture);

    [Test]
    public async Task The_owners_two_copies_moved_into_a_folder_each_are_two_albums_the_bigger_keeping_its_id_heart_and_plays()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        var both = Owner(lib.Music);
        await using var s = await LibraryServer.Start(lib);
        var db = s.Server;
        var before = Moanins(db);
        Assert.Equal([13L, 6L], before.Select(r => L(r["n"])).OrderDescending());
        var merged = before.Single(r => L(r["n"]) == 13);
        var id = L(merged["id"]);
        Assert.Equal(200, (await s.PostJ("/api/favourites", new { offset = id, on = true })).Status);
        // A play of each copy's first track, on the album of 13.
        long TrackId(string like) => L(db.Scalar("SELECT id FROM tracks WHERE path LIKE $1", "%" + like));
        var (remPlay, sacdPlay) = (TrackId("01 - Moanin' (Remastered 2013).flac"), TrackId("01 - Moanin' (SACD Version).flac"));
        foreach (var t in new[] { remPlay, sacdPlay }) db.Exec("INSERT INTO plays(album_id, track_id, title, ts) VALUES($1, $2, 'x', $3)", id, t, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

        // The owner's move: a new folder for each copy, the files moved in, the old folder left with its picture.
        var rem = Path.Combine(lib.Music, Act, "Moanin' (1959) (Remastered 2013)");
        var sacd = Path.Combine(lib.Music, Act, "Moanin' (1959) (SACD Version)");
        Directory.CreateDirectory(rem); Directory.CreateDirectory(sacd);
        foreach (var f in Directory.GetFiles(both, "*.flac"))
            File.Move(f, Path.Combine(f.Contains("(SACD Version)", StringComparison.Ordinal) ? sacd : rem, Path.GetFileName(f)));
        var scan = await s.Scan();
        Assert.True(scan.Num("relocated") == 13, scan.ToJsonString());

        var after = Moanins(db);
        Assert.True(after.Count == 3, "two albums of the 13 and the 1998 edition: " + string.Join(", ", after.Select(r => r["dir"] + " " + r["n"])));
        var kept = after.Single(r => L(r["id"]) == id);
        Assert.Equal(7, L(kept["n"]));
        Assert.Equal(sacd, kept["dir"]);
        Assert.EndsWith("/" + Path.GetFileName(sacd), (string)kept["key"]!, StringComparison.OrdinalIgnoreCase);   // its key its folder's
        var made = after.Single(r => (string?)r["dir"] == rem);
        Assert.Equal(6, L(made["n"]));
        // The heart stays with the album kept; each play is with its track's album.
        var albums = await s.Albums();
        var tile = albums.Single(a => a.Str("title") == "Moanin'");
        Assert.Equal(3, tile.Num("versions"));
        var versions = (await s.Album(id))["versions"].Items().ToList();
        Assert.Equal(3, versions.Count);
        Assert.True(versions.Single(v => (long)v.Num("offset")! == id).Bool("favourite"));
        Assert.Null(versions.Single(v => (long)v.Num("offset")! == L(made["id"]))?["favourite"]);
        Assert.Equal(id, L(db.Scalar("SELECT album_id FROM plays WHERE track_id = $1", sacdPlay)));
        Assert.Equal(L(made["id"]), L(db.Scalar("SELECT album_id FROM plays WHERE track_id = $1", remPlay)));

        // And it stays so: the next scan has nothing to do.
        Assert.Equal("unchanged", (await s.Scan()).Str("status"));
        Assert.Equal(3, Moanins(db).Count);
    }

    [Test]
    public async Task A_whole_album_moved_to_a_new_folder_stays_one_album_with_its_id_the_old_folder_left_with_its_picture()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        await using var s = await LibraryServer.Start(lib);
        var al = (await s.Albums()).First(a => a.Str("title") == "Album One");
        Assert.Equal(200, (await s.PostJ("/api/favourites", new { offset = al.Num("offset"), on = true })).Status);
        var from = Path.Combine(lib.Music, "Artist A", "Album One");
        var to = Path.Combine(lib.Music, "Artist A", "Album One (1997)");
        Directory.CreateDirectory(to);
        foreach (var f in Directory.GetFiles(from, "*.flac")) File.Move(f, Path.Combine(to, Path.GetFileName(f)));
        Assert.Equal(3, (await s.Scan()).Num("relocated"));
        var again = (await s.Albums()).Where(a => a.Str("title") == "Album One").ToList();
        Assert.Single(again);
        Assert.Equal(al.Num("offset"), again[0].Num("offset"));
        Assert.True(again[0].Bool("favourite"));
        Assert.Equal(3, (await s.Album(again[0].Num("offset")!))["tracks"].Items().Count());
    }

    [Test]
    public async Task An_album_moved_into_disc_folders_stays_one_album()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        var dbl = Path.Combine(lib.Music, "Band", "Double");
        for (int d = 1; d <= 2; d++)
            for (int i = 1; i <= 2; i++)
                Fixtures.Gen(Path.Combine(dbl, $"{d}-{i:00}.flac"), seconds: 1, freq: 300 + d * 100 + i * 20,
                    tags: new Dictionary<string, object> { ["title"] = $"D{d}T{i}", ["artist"] = "Band", ["album"] = "Double", ["track"] = i, ["disc"] = d });
        // And one whose discs are sibling folders naming them ("Name (Disc 1)"), moved there from one folder.
        var set = Path.Combine(lib.Music, "Band", "Set");
        for (int d = 1; d <= 2; d++)
            Fixtures.Gen(Path.Combine(set, $"{d}-01.flac"), seconds: 1, freq: 700 + d * 30,
                tags: new Dictionary<string, object> { ["title"] = $"S{d}", ["artist"] = "Band", ["album"] = "Set", ["track"] = 1, ["disc"] = d });
        await using var s = await LibraryServer.Start(lib);
        var id = (await s.Albums()).Single(a => a.Str("title") == "Double").Num("offset");
        var setId = (await s.Albums()).Single(a => a.Str("title") == "Set").Num("offset");
        foreach (var f in Directory.GetFiles(dbl, "*.flac"))
        {
            var cd = Path.Combine(dbl, "CD" + Path.GetFileName(f)[0]);
            Directory.CreateDirectory(cd);
            File.Move(f, Path.Combine(cd, Path.GetFileName(f)));
        }
        foreach (var f in Directory.GetFiles(set, "*.flac"))
        {
            var disc = Path.Combine(lib.Music, "Band", $"Set (Disc {Path.GetFileName(f)[0]})");
            Directory.CreateDirectory(disc);
            File.Move(f, Path.Combine(disc, Path.GetFileName(f)));
        }
        Assert.Equal(6, (await s.Scan()).Num("relocated"));
        var albums = await s.Albums();
        var d2 = albums.Where(a => a.Str("title") == "Double").ToList();
        Assert.True(d2.Count == 1 && d2[0].Num("offset") == id, "one album, its id kept");
        Assert.Equal(4, (await s.Album(id!))["tracks"].Items().Count());
        var sets = albums.Where(a => a.Str("title") == "Set").ToList();
        Assert.True(sets.Count == 1 && sets[0].Num("offset") == setId && sets[0].Num("versions") == null, "the discs' folders one album: " + string.Join(", ", sets.Select(x => x.ToJsonString())));
    }
}
