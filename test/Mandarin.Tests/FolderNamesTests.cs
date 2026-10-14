using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// Untagged files named from their folders (v0.6.0-RC10): the artist from the folder above the album's,
/// the album and year from its own, the track from the file name — only what the tags leave empty; and
/// a library scanned before is put right, its albums keeping their ids (Scan/ScanNames.cs;
/// test/folder-names.test.js, in C#).
/// </summary>
public sealed class FolderNamesTests
{
    private const string R = "/music";

    // What a file's folders and name say, as the scan reads them.
    private static async Task<JsonNode> FromNames(string file) =>
        (await Score.Run(new { fn = "fromnames", files = new[] { new object[] { Path.Combine(R, file), new[] { R } } } }))["names"]![0]!;

    // A track's own rows: its title, number and what was taken from its names.
    private static List<Dictionary<string, object?>> TracksIn(LibraryServer s, object? albumId) =>
        s.Server.Rows("SELECT track_no, title, names_from FROM tracks WHERE album_id = $1 ORDER BY disc_no, track_no, path", albumId);

    // A file with no tags at all.
    private static void Bare(string file, int freq)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var r = Fixtures.Run(["-loglevel", "error", "-y", "-f", "lavfi", "-i", $"sine=frequency={freq}:duration=1", "-ac", "2", "-map_metadata", "-1", file]);
        Assert.True(r.Code == 0, r.Err);
    }

    [Test]
    public async Task What_the_names_say()
    {
        JsonAssert.Same("""{"artist":"808 State","album":"10x10","year":1993,"disc":null,"track":1,"title":"10x10 (Radio Mix)"}""",
            await FromNames("4tb/Music/808 State/10x10 (1993)/01 - 10x10 (Radio Mix).flac"));
        JsonAssert.Same("""{"artist":"808 State","album":"ESP_ The 808 State Effect","year":2021,"disc":1,"track":1,"title":"Pacific State"}""",
            await FromNames("4tb/Music/808 State/ESP_ The 808 State Effect (2021)/1-01 - Pacific State.flac"));
        // A disc folder: the album and artist from the folders above it.
        JsonAssert.Same("""{"artist":"808 State","album":"Box","year":2000,"disc":2,"track":3,"title":"Cübik"}""",
            await FromNames("808 State/Box [2000]/CD2/03. Cübik.flac"));
        // "Artist - Album (Year)" as the album's folder, under a folder that isn't an artist.
        JsonAssert.Same("""{"artist":"808 State","album":"Ninety","year":1989,"disc":null,"track":2,"title":"Ancodia"}""",
            await FromNames("Music/808 State - Ninety (1989)/02 808 State - Ancodia.flac"));
        // An album straight in a music folder, or under "Music" / "4tb": no artist from that.
        Assert.Null((await FromNames("Album (1999)/01 - One.flac")).Str("artist"));
        Assert.Null((await FromNames("Music/Album (1999)/01 - One.flac")).Str("artist"));
        Assert.Null((await FromNames("4tb/Album (1999)/01 - One.flac")).Str("artist"));
        // A folder named for its parts, not for an artist: the parent's name kept.
        Assert.Equal("Live - Tokyo", (await FromNames("Band/Live - Tokyo (1993)/01 - One.flac")).Str("album"));
    }

    [Test]
    public async Task An_untagged_album_takes_its_names_from_its_folders_a_tagged_one_is_left_alone()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        Bare(Path.Combine(lib.Music, "808 State/10x10 (1993)/01 - 10x10 (Radio Mix).flac"), 300);
        Bare(Path.Combine(lib.Music, "808 State/10x10 (1993)/02 - La Luz (Acid Mix).flac"), 350);
        // Partly tagged: the title and artist are the file's own; the album from the folder.
        Fixtures.Gen(Path.Combine(lib.Music, "808 State", "Ninety (1989)", "01 - x.flac"), seconds: 1, tags: new Dictionary<string, object> { ["title"] = "Magical Dream", ["artist"] = "808 State" });
        await using var s = await LibraryServer.Start(lib);
        var albums = await s.Albums();
        var tx = albums.FirstOrDefault(a => a.Str("title") == "10x10");
        Assert.True(tx != null, string.Join("; ", albums.Select(a => a.Str("title") + " / " + a.Str("subtitle"))));
        Assert.Equal("808 State", tx.Str("subtitle"));
        Assert.Equal(1993, tx.Num("year"));
        var tracks = TracksIn(s, tx.Num("offset"));
        Assert.Equal([(1L, "10x10 (Radio Mix)"), (2L, "La Luz (Acid Mix)")], tracks.Select(x => ((long)x["track_no"]!, (string)x["title"]!)));
        Assert.Equal("artist,album,title,track,year", tracks[0]["names_from"]);
        Assert.True((await s.Album(tx.Num("offset")!)).Bool("names_from_folders"), "its page says so");
        var ninety = albums.First(a => a.Str("title") == "Ninety");
        Assert.Equal("808 State", ninety.Str("subtitle"));
        Assert.Equal("Magical Dream", TracksIn(s, ninety.Num("offset"))[0]["title"]);
        Assert.Equal("album,track,year", TracksIn(s, ninety.Num("offset"))[0]["names_from"]);
        // Album One, fully tagged: nothing from its names.
        var one = albums.First(a => a.Str("title") == "Album One");
        Assert.All(TracksIn(s, one.Num("offset")), x => Assert.True(string.IsNullOrEmpty((string?)x["names_from"])));
        Assert.False((await s.Album(one.Num("offset")!)).Bool("names_from_folders"));
    }

    [Test]
    public async Task A_library_scanned_before_Unknown_Artist_albums_named_from_their_folders_keeping_their_ids_and_hearts()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        var p = Path.Combine(lib.Music, "808 State", "Pacific (1989)", "01 - Pacific (707).flac");
        Bare(p, 500);
        await using var s = await LibraryServer.Start(lib);
        var db = s.Server;
        // Make it as v0.6.0-RC9 left it: Unknown Artist, the folder as the title, read at TAGS_V 1, unidentified.
        var al = db.Rows("SELECT a.* FROM albums a JOIN tracks t ON t.album_id = a.id WHERE t.path = $1", p)[0];
        var oldKey = "unknown artist\u0001pacific 1989\u0001" + ((string)al["key"]!).Split('\u0001')[2];
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        db.Exec("UPDATE albums SET key = $1, artist = 'Unknown Artist', title = 'Pacific (1989)' WHERE id = $2", oldKey, al["id"]);
        db.Exec("UPDATE tracks SET artist = '', album_artist = '', album = '', title = '01 - Pacific (707)', names_from = NULL WHERE path = $1", p);
        db.Exec("UPDATE tracks SET tags_v = 1");
        db.Exec("INSERT INTO favourites(key, added_at) VALUES($1, $2)", oldKey, now);
        db.Exec("INSERT INTO album_matches(key, status, checked_at) VALUES($1, 'unidentified', $2)", oldKey, now);
        db.SetSetting("names_v", 0);

        // The update starts: only the untagged track is read again, as its scan says.
        int seen = s.Server.Logs.Count;
        await s.Restart();
        var logs = s.Server.Logs.Skip(seen).ToList();
        var again = logs.FirstOrDefault(l => l.Contains("without an artist or album tag will be read again", StringComparison.Ordinal));
        Assert.Matches(new Regex(@"\b1 tracks without an artist or album tag will be read again, their names taken from their folders \(\d+ others left as they are\)"), again ?? string.Join("\n", logs));
        Assert.True(db.Setting("names_v")?.GetValue<int>() == 1, "done once");
        var album = (await s.Albums()).FirstOrDefault(a => a.Num("offset") == Convert.ToDouble(al["id"], System.Globalization.CultureInfo.InvariantCulture));
        Assert.True(album != null, "the same album id");
        Assert.Equal("808 State", album.Str("subtitle"));
        Assert.Equal("Pacific", album.Str("title"));
        Assert.True(album.Bool("favourite"));
        Assert.Equal("Pacific (707)", TracksIn(s, album.Num("offset"))[0]["title"]);
        // Looked up again under its new names.
        Assert.Equal(0L, db.Scalar("SELECT COUNT(*) AS n FROM album_matches WHERE status = 'unidentified'"));
    }

    [Test]
    public async Task Beatles_are_The_Beatles_one_artist_filed_under_B()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        Fixtures.Gen(Path.Combine(lib.Music, "The Beatles", "Abbey Road", "01.flac"), seconds: 1,
            tags: new Dictionary<string, object> { ["title"] = "Come Together", ["artist"] = "Beatles", ["album_artist"] = "Beatles", ["album"] = "Abbey Road", ["track"] = 1 });
        Fixtures.Gen(Path.Combine(lib.Music, "The Beatles", "Let It Be", "01.flac"), seconds: 1,
            tags: new Dictionary<string, object> { ["title"] = "Two of Us", ["artist"] = "The Beatles", ["album_artist"] = "The Beatles", ["album"] = "Let It Be", ["track"] = 1 });
        await using var s = await LibraryServer.Start(lib);
        var ar = (await s.Albums()).First(a => a.Str("title") == "Abbey Road");
        Assert.Equal("The Beatles", ar.Str("subtitle"));
        Assert.Equal("beatles", s.Server.Scalar("SELECT sort_artist FROM albums WHERE id = $1", (long)ar.Num("offset")!.Value));
        var both = await s.GetJ("/api/artist-albums?artist=" + Uri.EscapeDataString("The Beatles"));
        Assert.Equal(["Abbey Road", "Let It Be"], both["primary"].Items().Select(a => a.Str("title") ?? "").Order(StringComparer.Ordinal));
        Assert.Empty(both["featured"].Items());
        Assert.Equal(2, (await s.GetJ("/api/artist-albums?artist=Beatles"))["primary"].Items().Count());
    }
}
