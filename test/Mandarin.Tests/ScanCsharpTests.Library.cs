using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using static Mandarin.Tests.JsGen;

namespace Mandarin.Tests;

/// <summary>The music folder the scan test reads, with something of everything, and the test itself.</summary>
public sealed partial class ScanCsharpTests
{
    private sealed record Mixed(string Root, string Music);

    private static Dictionary<string, object> Tags(params (string K, object V)[] kv) => kv.ToDictionary(x => x.K, x => x.V);
    private static readonly string[] Mp3 = ["-b:a", "128k"];

    // A music folder with something of everything.
    private static Mixed MakeMixedLibrary()
    {
        var root = Directory.CreateTempSubdirectory("musicd-scan-").FullName;
        var music = Path.Combine(root, "music");
        void T(string p, Dictionary<string, object>? tags = null, int rate = 44100, string? fmt = "s16", string[]? codecArgs = null) =>
            Fixtures.Gen(Path.Combine(music, p), seconds: 1, rate: rate, fmt: fmt, codecArgs: codecArgs, tags: tags);
        void Img(string p, string colour = "red")
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(music, p))!);
            Fixtures.Run(["-loglevel", "error", "-y", "-f", "lavfi", "-i", $"color=c={colour}:s=64x64", "-frames:v", "1", Path.Combine(music, p)]);
        }
        // A tagged album, its cover and its back; the release's identifiers and loudness.
        T("Artist A/Album One/01 Song 1.flac", Tags(("title", "Song 1"), ("artist", "Artist A"), ("album", "Album One"), ("track", 1), ("date", "1997-02-04"), ("originaldate", "1997"),
            ("genre", "Rock;Pop"), ("label", "Parlophone"), ("REPLAYGAIN_TRACK_GAIN", "-7.21 dB"), ("REPLAYGAIN_TRACK_PEAK", "0.988"), ("BARCODE", "0039841500523"), ("CATALOGNUMBER", "XL 123")));
        T("Artist A/Album One/02 Song 2.flac", Tags(("title", "Song 2"), ("artist", "Artist A"), ("album", "Album One"), ("track", 2), ("date", "1997"), ("genre", "rock"), ("label", "Parlophone")));
        Img("Artist A/Album One/cover.jpg");
        Img("Artist A/Album One/back.jpg", "blue");
        File.WriteAllText(Path.Combine(music, "Artist A/Album One/.DS_Store"), "x");
        File.WriteAllText(Path.Combine(music, "Artist A/Album One/._01 Song 1.flac"), "x");
        // Hi-res.
        T("Artist B/Hi Res/01 Hi 1.flac", Tags(("title", "Hi 1"), ("artist", "Artist B"), ("album", "Hi Res"), ("track", 1), ("date", "2020")),
            rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"]);
        // Two albums in one folder.
        T("Mixed/01 a.flac", Tags(("title", "a"), ("artist", "M"), ("album", "First")));
        T("Mixed/02 b.flac", Tags(("title", "b"), ("artist", "M"), ("album", "Second")));
        // One album over two disc folders, by different artists: Various Artists.
        T("Comp/CD1/01.mp3", Tags(("title", "C1"), ("artist", "X"), ("album", "Best Of"), ("track", 1)), fmt: null, codecArgs: Mp3);
        T("Comp/CD2/01.mp3", Tags(("title", "C2"), ("artist", "Y"), ("album", "Best Of"), ("track", 1), ("disc", 2)), fmt: null, codecArgs: Mp3);
        // Flagged a compilation; an album artist; an artist's sort name.
        T("Flagged/01.flac", Tags(("title", "f1"), ("artist", "P"), ("album", "Hits"), ("compilation", "1")));
        T("Flagged/02.flac", Tags(("title", "f2"), ("artist", "P"), ("album", "Hits"), ("compilation", "1")));
        T("AA/01.flac", Tags(("title", "duet"), ("artist", "X & Y"), ("album", "Duets"), ("album_artist", "X")));
        T("A Tribe/The Low End Theory/01.flac", Tags(("title", "Excursions"), ("artist", "A Tribe Called Quest"), ("album", "The Low End Theory"), ("ARTISTSORT", "Tribe Called Quest, A")));
        // No tags: the names from the folders and files.
        T("808 State/10x10 (1993)/01 - 10x10 (Radio Mix).flac");
        T("808 State - Ninety (1989)/Disc 2/03 - Ancodia.flac");
        T("Yes - The Box/Disc 4 - Tales From Topographic Oceans (1973)/01 - The Revealing Science.flac");
        T("Music/Some Album/1-01 - Intro.flac");
        // Names beyond ASCII: accents, a Greek final sigma, an emoji, a ligature; "The" and not.
        T("Björk/Homogénic/01 Jóga.flac", Tags(("title", "Jóga"), ("artist", "Björk"), ("album", "Homogénic"), ("date", "1997")));
        T("Greek/ΟΔΥΣΣΕΑΣ/01.flac", Tags(("title", "Α"), ("artist", "ΣΩΣ"), ("album", "ΟΔΥΣΣΕΑΣ")));
        T("Ünïcode 😀/Ålbum ﬀ/01.flac", Tags(("title", "x"), ("artist", "Ünïcode 😀"), ("album", "Ålbum ﬀ")));
        T("The Beatles/Abbey Road/01.flac", Tags(("title", "Come Together"), ("artist", "The Beatles"), ("album", "Abbey Road")));
        T("Beatles/Help/01.flac", Tags(("title", "Help!"), ("artist", "Beatles"), ("album", "Help!")));
        // Covers: two unnamed (neither), one in a disc folder, two named the same but for case.
        T("Art/Two Unnamed/01.flac", Tags(("title", "u"), ("artist", "Art"), ("album", "Two Unnamed")));
        Img("Art/Two Unnamed/x.jpg");
        Img("Art/Two Unnamed/y.png");
        T("Art/Disc Art/CD1/01.flac", Tags(("title", "d"), ("artist", "Art"), ("album", "Disc Art")));
        Img("Art/Disc Art/CD1/folder.jpg");
        T("Art/Front Ties/01.flac", Tags(("title", "t"), ("artist", "Art"), ("album", "Front Ties")));
        Img("Art/Front Ties/front.jpg");
        Img("Art/Front Ties/Front.png", "green");
        // Other containers.
        T("M4A/01.m4a", Tags(("title", "m"), ("artist", "Mp4"), ("album", "In A Box"), ("track", 3), ("date", "2001")), fmt: null, codecArgs: ["-c:a", "aac", "-b:a", "64k"]);
        T("Wav/01.wav", Tags(("title", "w"), ("artist", "Wave"), ("album", "Riff")));
        // A file that can't be read; a link to a folder, a loop, a link to nothing.
        Directory.CreateDirectory(Path.Combine(music, "Broken/Bad"));
        File.WriteAllBytes(Path.Combine(music, "Broken/Bad/01.mp3"), [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0x10]);   // an ID3 tag, cut short
        Directory.CreateSymbolicLink(Path.Combine(music, "Linked Wav"), Path.Combine(music, "Wav"));
        T("Loop/01.flac", Tags(("title", "l"), ("artist", "Loop"), ("album", "Loop")));
        Directory.CreateSymbolicLink(Path.Combine(music, "Loop", "again"), Path.Combine(music, "Loop"));
        File.CreateSymbolicLink(Path.Combine(music, "Dangling.flac"), "/nonexistent/anything.flac");
        return new Mixed(root, music);
    }

    private static void SetRaw(SqliteConnection d, string k, JsonNode? v) =>
        Exec(d, "INSERT INTO settings(key, value) VALUES($a, $b) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, JsJson.Stringify(v));

    private static void Exec(SqliteConnection d, string sql, params object[] args)
    {
        using var c = d.CreateCommand();
        c.CommandText = sql;
        for (int i = 0; i < args.Length; i++) c.Parameters.AddWithValue("$" + (char)('a' + i), args[i]);
        c.ExecuteNonQuery();
    }

    private static object? One(SqliteConnection d, string sql, params object[] args)
    {
        using var c = d.CreateCommand();
        c.CommandText = sql;
        for (int i = 0; i < args.Length; i++) c.Parameters.AddWithValue("$" + (char)('a' + i), args[i]);
        return c.ExecuteScalar();
    }

    // What hangs on an album's key, put on Album One.
    private static string Put(SqliteConnection d)
    {
        var key = (string)One(d, "SELECT key FROM albums WHERE title = 'Album One'")!;
        var song1 = (long)One(d, "SELECT id FROM tracks WHERE title = 'Song 1'")!;
        Exec(d, "INSERT INTO favourites(key, added_at) VALUES($a, 1)", key);
        Exec(d, "INSERT INTO album_edits(key, year, updated_at) VALUES($a, 1998, 1)", key);
        Exec(d, "INSERT INTO album_matches(key, status, checked_at) VALUES($a, 'unidentified', 1)", key);
        Exec(d, "INSERT INTO cache(ns, key, value, ts) VALUES('mbday', $a, '{\"date\":\"1997-02-04\"}', 1)", key);
        Exec(d, "INSERT INTO track_loudness(track_id, lufs, peak, measured_at) VALUES($a, -9.5, -0.2, 1)", song1);
        SetRaw(d, "album_of_the_day", Obj(("date", "2026-10-08"), ("key", key), ("why", "ÿ")));
        return key;
    }

    [Test]
    public async Task The_scan_made_by_the_CSharp_server_writes_what_the_Node_servers_scan_writes()
    {
        Needs.Server();
        Needs.Ffmpeg();
        var lib = MakeMixedLibrary();
        try
        {
            var files = new Looker(lib.Music);
            var csData = Path.Combine(lib.Root, "data-cs");
            Assert.True((await ServerCommand.Run(["db", csData])).Code == 0, "the C# server's database made");
            int massRemoval = 500;
            var scanRoot = lib.Music;
            // The database, opened for a moment: written to between scans, or read whole.
            T WithDb<T>(Func<SqliteConnection, T> fn) { using var d = SqliteDump.Open(Path.Combine(csData, "musicd.db"), readOnly: false); return fn(d); }
            async Task<JsonNode> Both(string what, bool force = false)
            {
                await files.Look();
                var c = await ScanCs(csData, scanRoot, force, massRemoval);
                Assert.True(c.Lines.Any(l => l.Contains("made by the C# server", StringComparison.Ordinal)), what + ": the C# server made it\n" + string.Join("\n", c.Lines));
                var tables = Normalised(Dump(Path.Combine(csData, "musicd.db")), lib.Root, files);
                var state = new JsonArray([.. StateKeys.Select(k => c.State?[k]?.DeepClone())]);
                book.Kept.Same(what + ": the result, what was said, the state", ["result", "said", "state"], [what, what, what],
                    [Named(Result(c.Result!), lib.Root), Named(new JsonArray([.. Said(c.Lines).Select(l => (JsonNode?)l)]), lib.Root), state]);
                book.Kept.Same(what + ": the tables", ["tables"], [what], [new JsonArray([.. tables.Keys.Select(k => (JsonNode?)k)])]);
                foreach (var (t, table) in tables)
                {
                    var cols = new JsonArray([.. table.Cols.Select(x => (JsonNode?)x)]);
                    book.Kept.Same($"{what}: table {t}", [.. table.Rows.Select((_, i) => (object?)$"{t} row {i + 1}")], [.. table.Rows.Select(_ => (JsonNode?)cols)], [.. table.Rows]);
                }
                return c.Result!;
            }
            var first = await Both("the first scan");
            Assert.Equal("updated", first.Str("status"));
            Assert.True(first.Num("albums") >= 20, "albums: " + first.Num("albums"));
            Assert.True(first.Num("errors") >= 1, "the broken file said so");

            var key = WithDb(Put);
            Assert.Equal("unchanged", (await Both("nothing changed")).Str("status"));

            // A file changed, a folder renamed, a file gone, one new, an album's tags rewritten.
            var one = Path.Combine(lib.Music, "Artist A/Album One");
            File.SetLastAccessTimeUtc(Path.Combine(one, "01 Song 1.flac"), DateTime.UtcNow);
            File.SetLastWriteTimeUtc(Path.Combine(one, "01 Song 1.flac"), DateTime.UtcNow.AddHours(-1));
            Directory.Move(one, one + " (Remaster)");
            File.Delete(Path.Combine(lib.Music, "Mixed/02 b.flac"));
            Fixtures.Gen(Path.Combine(lib.Music, "Mixed/03 c.flac"), seconds: 1, tags: Tags(("title", "c"), ("artist", "M"), ("album", "First")));
            Fixtures.Gen(Path.Combine(lib.Music, "AA/01.flac"), seconds: 1, tags: Tags(("title", "duet"), ("artist", "X & Y"), ("album", "Duets (Deluxe)"), ("album_artist", "X")));
            var changed = await Both("files changed, renamed, gone and new");
            Assert.True(changed.Num("relocated") >= 1 && changed.Num("removed") >= 1, JsJson.Stringify(changed));
            WithDb(d =>
            {
                var moved = One(d, "SELECT key FROM albums WHERE title = 'Album One'") as string;
                Assert.True(moved != null && moved != key, "Album One has its new folder's key");
                Assert.True((long)One(d, "SELECT COUNT(*) FROM favourites WHERE key = $a", moved!)! == 1, "its heart went with it");
                Assert.True(JsJson.Parse((string)One(d, "SELECT value FROM settings WHERE key = 'album_of_the_day'")!).Str("key") == moved, "and Album of the day");
                return 0;
            });

            // Most of a folder gone at once is kept; so is a drive that isn't there.
            massRemoval = 1;
            File.Delete(Path.Combine(lib.Music, "Flagged/01.flac"));
            File.Delete(Path.Combine(lib.Music, "Flagged/02.flac"));
            var kept1 = await Both("most of a folder gone at once");
            Assert.True(kept1.Num("removed") == 0, JsJson.Stringify(kept1));
            Assert.True(kept1.Num("kept_offline") >= 2, JsJson.Stringify(kept1));
            Directory.Move(Path.Combine(lib.Music, "Artist B"), Path.Combine(lib.Root, "Artist B"));
            Directory.CreateDirectory(Path.Combine(lib.Music, "Artist B"));
            var drive = await Both("a drive not mounted");
            Assert.True(drive["offline_dirs"]!.AsArray().Any(d => d.Str("name") == "Artist B" && d.Str("reason") == "empty"), JsJson.Stringify(drive["offline_dirs"]));
            Directory.Delete(Path.Combine(lib.Music, "Artist B"));
            Directory.Move(Path.Combine(lib.Root, "Artist B"), Path.Combine(lib.Music, "Artist B"));
            // A folder that can't be read (here a link that loops onto itself): its albums kept.
            var unnamed = Path.Combine(lib.Music, "Art/Two Unnamed");
            Directory.Move(unnamed, Path.Combine(lib.Root, "Two Unnamed"));
            File.CreateSymbolicLink(unnamed, unnamed);
            var unreadable = await Both("a folder that can't be read");
            Assert.True(unreadable["offline_dirs"]!.AsArray().Any(d => d.Str("reason") == "unreadable"), JsJson.Stringify(unreadable["offline_dirs"]));
            File.Delete(unnamed);
            Directory.Move(Path.Combine(lib.Root, "Two Unnamed"), unnamed);

            // Everything read again; and every folder regrouped (the emptied folder filled again first).
            massRemoval = 500;
            await Both("a forced rescan", force: true);
            WithDb(d => { SetRaw(d, "album_regroup", true); return 0; });
            Fixtures.Gen(Path.Combine(lib.Music, "Flagged/01.flac"), seconds: 1, tags: Tags(("title", "f1"), ("artist", "P"), ("album", "Hits"), ("compilation", "1")));
            Fixtures.Gen(Path.Combine(lib.Music, "Flagged/02.flac"), seconds: 1, tags: Tags(("title", "f2"), ("artist", "P"), ("album", "Hits"), ("compilation", "1")));
            var rg = await Both("the regroup");
            Assert.Empty(rg["offline_dirs"]!.AsArray());
            Assert.True(WithDb(d => (string)One(d, "SELECT value FROM settings WHERE key = 'album_regroup'")!) == "false", "the regroup done");

            // No music at all: nothing touched.
            scanRoot = Path.Combine(lib.Root, "nowhere");
            Assert.Equal("no-music", (await Both("no music folder")).Str("status"));
            book.Kept.Done();
        }
        finally { try { Directory.Delete(lib.Root, true); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
    }
}
