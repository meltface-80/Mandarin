using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// The database's tables and migrations made by the C# server (v0.8.48; Schema.cs, `mandarin-server db`),
/// held to what lib/library/db.js made from the same start, file for file:
///   - a new database: the same tables, indexes and their CREATE text, the same columns, version and journal;
///   - one from before the columns added since: the same columns added, its rows kept;
///   - one made by something else: moved aside as musicd.old-&lt;ms&gt;.db, a fresh one made, what is worth
///     keeping carried over, row for row;
///   - one from a newer version (its user_version ahead): kept as it is;
///   - the album edits kept twice: read back from album-edits.json into an empty table, and the file
///     written where there are edits and none.
/// The Node server's databases, what it said and the edits it wrote are kept (test/golden/db-csharp.json;
/// its folder named "&lt;dir&gt;") (test/db-csharp.test.js, in C#).
/// </summary>
public sealed partial class DbCsharpTests(DbCsharpTests.Book book) : IClassFixture<DbCsharpTests.Book>
{
    /// <summary>test/golden/db-csharp.json, every kept answer asked for by the class's end.</summary>
    public sealed class Book() : KeptBook("db-csharp");

    private Golden.Answers Kept => book.Kept;

    [GeneratedRegex(@"musicd\.old-\d+\.db")] private static partial Regex Aside();

    private static string Tmp() => Directory.CreateTempSubdirectory("mandarin-db-").FullName;

    // Made by the C# program, as the Node server asked it.
    private static async Task<(JsonNode Said, List<string> Lines)> ByCsharp(string dir)
    {
        var r = await ServerCommand.Run(["db", dir]);
        Assert.True(r.Code == 0, r.Out + r.Err);
        var lines = r.Out.Split('\n').Where(l => l.Length > 0).ToList();
        var said = JsonNode.Parse(lines[^1])!;
        lines.RemoveAt(lines.Count - 1);
        return (said, lines);
    }

    // The C# program's side of a step, held to the Node server's, kept.
    private void Held(string what, params (string Name, JsonNode? Value)[] mine) =>
        Kept.Same(what, [.. mine.Select(m => (object?)m.Name)], [.. mine.Select(m => (JsonNode?)JsonValue.Create(m.Name))], [.. mine.Select(m => m.Value)]);

    // What was said, the folder named.
    private static JsonArray Said(IEnumerable<string> lines, string dir) => new([.. lines.Select(l => (JsonNode?)JsonValue.Create(Aside().Replace(l, "musicd.old-<ms>.db").Replace(dir, "<dir>", StringComparison.Ordinal)))]);

    // The C# server's own columns beyond the Node server's (the classical fields, bug list item 48): the recording
    // is from before them, so they are taken out of the dump, from tracks' columns and from its CREATE text as
    // ALTER TABLE ADD COLUMN wrote them on its end.
    private static readonly (string Column, string Type)[] Ours = [("composer", "TEXT"), ("conductor", "TEXT"), ("work", "TEXT"), ("movement", "TEXT"), ("movement_no", "INTEGER"), ("performers", "TEXT")];

    // Its own indexes beyond the Node server's (Schema.Indexes.cs): made, then taken out of the dump as its columns are.
    private static readonly string[] OurIndexes = ["plays_album_ts"];

    private static JsonNode Db(string dir)
    {
        var d = SqliteDump.Dump(Path.Combine(dir, "musicd.db"));
        var master = d["master"]!.AsArray();
        foreach (var name in OurIndexes)
        {
            var mine = master.FirstOrDefault(m => m.Str("name") == name);
            Assert.True(mine != null, "no index " + name);
            master.Remove(mine);
        }
        var added = string.Concat(Ours.Select(o => $", {o.Column} {o.Type}"));
        foreach (var m in d["master"]!.AsArray()) if (m.Str("name") == "tracks" && m.Str("sql") is { } sql) m!["sql"] = sql.Replace(added, "", StringComparison.Ordinal);
        if (d["columns"]!["tracks"] is JsonArray cols)
        {
            var ours = Ours.Select(o => o.Column).ToHashSet(StringComparer.Ordinal);
            foreach (var c in cols.Where(c => ours.Contains(c.Str("name") ?? "")).ToList()) cols.Remove(c);
        }
        return d;
    }

    // A database as the server made it before the columns added since its tables first shipped. Its
    // CREATE text is kept in the file as written, so it is written as the recording's was (each
    // continued line six spaces in).
    private static void OldDatabase(string dir) => SqliteDump.Exec(Path.Combine(dir, "musicd.db"), """
        CREATE TABLE albums (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, artist TEXT NOT NULL,
              sort_title TEXT NOT NULL DEFAULT '', sort_artist TEXT NOT NULL DEFAULT '', year INTEGER, label TEXT,
              genres TEXT NOT NULL DEFAULT '[]', dir TEXT NOT NULL DEFAULT '', art_path TEXT, art_embedded TEXT, art_hash TEXT,
              track_count INTEGER NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0, max_rate INTEGER, max_bits INTEGER,
              lossless INTEGER NOT NULL DEFAULT 1, container TEXT, compilation INTEGER NOT NULL DEFAULT 0,
              added_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE album_matches (key TEXT PRIMARY KEY, mbid TEXT, distance REAL, status TEXT NOT NULL, candidate TEXT,
              before TEXT, checked_at INTEGER NOT NULL, applied_at INTEGER);
        INSERT INTO albums(key, title, artist, added_at, updated_at) VALUES('k1', 'Old', 'Someone', 1, 2);
        INSERT INTO settings(key, value) VALUES('displaySeconds', '30');
        INSERT INTO album_matches(key, status, checked_at) VALUES('k1', 'applied', 3);
        """);

    // A database another program wrote (an older project on the same volume): its albums lack our columns.
    private static void ForeignDatabase(string dir) => SqliteDump.Exec(Path.Combine(dir, "musicd.db"), """
        CREATE TABLE albums (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, extra TEXT);
        CREATE TABLE plays (id INTEGER PRIMARY KEY, album_id INTEGER, title TEXT, ts INTEGER NOT NULL);
        CREATE TABLE favourites (key TEXT PRIMARY KEY, added_at INTEGER NOT NULL);
        CREATE TABLE album_edits (key TEXT PRIMARY KEY, title TEXT, updated_at INTEGER NOT NULL);
        INSERT INTO albums(name) VALUES('theirs');
        INSERT INTO settings(key, value, extra) VALUES('a', '1', 'x'), ('b', '"two"', NULL);
        INSERT INTO plays(album_id, title, ts) VALUES(4, 'Song', 100), (NULL, 'Other', 200);
        INSERT INTO favourites(key, added_at) VALUES('fav', 5);
        INSERT INTO album_edits(key, title, updated_at) VALUES('ed', 'Fixed', 6);
        """);

    [Test]
    public async Task A_new_database_the_same_tables_indexes_columns_version_and_journal()
    {
        var b = Tmp();
        var c = await ByCsharp(b);
        JsonAssert.Same("""{"ok":true,"existed":false,"aside":null,"version":1}""", c.Said);
        Held("a new database", ("said", Said(c.Lines, b)), ("db", Db(b)));
        // Asked again: nothing changes.
        JsonAssert.Same("""{"ok":true,"existed":true,"aside":null,"version":1}""", (await ByCsharp(b)).Said);
        Held("a new database, asked again", ("db", Db(b)));
        Assert.True(!File.Exists(Path.Combine(b, "album-edits.json")), "no edits, no file");
    }

    [Test]
    public async Task One_from_before_the_columns_added_since_brought_up_to_date_the_same_its_rows_kept()
    {
        var b = Tmp();
        OldDatabase(b);
        JsonAssert.Same("""{"ok":true,"existed":true,"aside":null,"version":1}""", (await ByCsharp(b)).Said);
        var dc = Db(b);
        Held("one from before the columns added since", ("db", dc));
        Assert.True(dc["columns"]!["albums"].Items().Any(x => x.Str("name") == "mb_group") && dc["columns"]!["album_matches"].Items().Any(x => x.Str("name") == "itunes"));
        Assert.True(dc["rows"]!["albums"]!.AsArray().Count == 1, "its album kept");
    }

    [Test]
    public async Task One_made_by_something_else_moved_aside_a_fresh_one_made_what_is_worth_keeping_carried_over()
    {
        var b = Tmp();
        ForeignDatabase(b);
        var c = await ByCsharp(b);
        var aside = Directory.GetFiles(b).Select(Path.GetFileName).FirstOrDefault(f => Regex.IsMatch(f!, @"^musicd\.old-\d+\.db$"));
        Assert.True(aside != null, "moved it aside: " + string.Join(", ", Directory.GetFiles(b).Select(Path.GetFileName)));
        Assert.Equal(Path.Combine(b, aside), c.Said.Str("aside"));
        // The old one as it was, the new one with what was kept, said as the Node server says it, and the edits it kept written beside it too.
        var edits = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(b, "album-edits.json")))!["edits"]!.DeepClone();
        Held("one made by something else", ("old", SqliteDump.Dump(Path.Combine(b, aside))), ("db", Db(b)), ("said", Said(c.Lines, b)), ("edits", edits));
        Assert.True(c.Lines.Any(l => Regex.IsMatch(l, @"kept 2 plays row\(s\)")) && c.Lines.Any(l => Regex.IsMatch(l, @"kept 1 album edits row\(s\)")), string.Join("\n", c.Lines));
    }

    [Test]
    public async Task One_from_a_newer_version_kept_and_used_as_it_is()
    {
        var b = Tmp();
        SqliteDump.Exec(Path.Combine(b, "musicd.db"), "CREATE TABLE albums (id INTEGER PRIMARY KEY, name TEXT); PRAGMA user_version = 7;");
        Assert.Null((await ByCsharp(b)).Said.Str("aside"));
        Held("one from a newer version", ("db", Db(b)));
        Assert.DoesNotContain(Directory.GetFiles(b), f => Path.GetFileName(f).StartsWith("musicd.old-", StringComparison.Ordinal));
    }

    [Test]
    public async Task The_album_edits_kept_twice_read_back_from_album_edits_json_and_the_file_written_where_there_is_none()
    {
        // Read back: a new database beside the file a lost one left.
        var edits = new
        {
            version = 1, saved_at = 1, edits = new object[]
            {
                new { key = "k1", title = "Fixed", artist = (string?)null, year = 1999, art = Convert.ToBase64String(Encoding.UTF8.GetBytes("not really a jpeg")), art_hash = "h", art_source = "https://example.com/x.jpg", updated_at = 1700000000000 },
                new { key = "k2", title = "", artist = "Them", year = 0, art = (string?)null, art_hash = (string?)null, art_source = (string?)null, updated_at = 5 },
                new { title = "no key" }
            }
        };
        var b = Tmp();
        await File.WriteAllTextAsync(Path.Combine(b, "album-edits.json"), Http.Json(edits));
        var c = await ByCsharp(b);
        Held("the album edits read back", ("db", Db(b)), ("said", Said(c.Lines.Where(l => l.Contains("restored", StringComparison.Ordinal)), b)));
        Assert.Matches(@"restored 2 album edit\(s\)", string.Join("\n", c.Lines));
        // Written: edits in the database, no file yet.
        File.Delete(Path.Combine(b, "album-edits.json"));
        await ByCsharp(b);
        var fb = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(b, "album-edits.json")))!.AsObject();
        Assert.True(Math.Abs(fb.Num("saved_at")!.Value - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) < 60000);
        var file = (JsonObject)fb.DeepClone();
        file["saved_at"] = 0;
        Held("the album edits written", ("file", file));
        Assert.Equal(2, fb["edits"]!.AsArray().Count);
        // An unreadable file: nothing read, the database made all the same.
        var b2 = Tmp();
        await File.WriteAllTextAsync(Path.Combine(b2, "album-edits.json"), "{ not json");
        var c2 = await ByCsharp(b2);
        Assert.Contains(c2.Lines, l => l.Contains("is unreadable", StringComparison.Ordinal));
        Held("an unreadable album-edits.json", ("db", Db(b2)));
    }
}
