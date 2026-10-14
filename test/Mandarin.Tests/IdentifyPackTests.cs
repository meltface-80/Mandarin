using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Tests;

/// <summary>
/// The scan with the MusicBrainz pack (v0.6.8): the albums whose barcode the pack has come first, and
/// while musicbrainz.org isn't answering the scan carries on with them from the pack alone. An album
/// the pack can't place is left for musicbrainz.org, not marked unidentified. Here musicbrainz.org is
/// a closed port: down for the whole test (test/identify-pack.test.js, in C#).
/// </summary>
public sealed class IdentifyPackTests
{
    private const string Gid = "7a0f0c3e-1111-4222-8333-944455556666";

    /// <summary>A pack of one release, as the pack builder writes it.</summary>
    internal static void WritePack(string file)
    {
        using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = file, Pooling = false }.ToString());
        db.Open();
        void Run(string sql, params object[] args)
        {
            using var c = db.CreateCommand();
            c.CommandText = sql;
            for (int i = 0; i < args.Length; i++) c.Parameters.AddWithValue("$" + (i + 1), args[i]);
            c.ExecuteNonQuery();
        }
        Run("""
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE groups (id INTEGER PRIMARY KEY, gid BLOB NOT NULL, title TEXT, note TEXT, type TEXT, first INTEGER);
            CREATE TABLE releases (id INTEGER PRIMARY KEY, gid BLOB NOT NULL, grp INTEGER, title TEXT, artist TEXT, note TEXT,
              status TEXT, barcode TEXT, code TEXT, date INTEGER, country TEXT, format TEXT, tracks TEXT);
            CREATE INDEX releases_code ON releases (code); CREATE INDEX releases_gid ON releases (gid);
            """);
        static byte[] Blob(string g) => Convert.FromHexString(g.Replace("-", "", StringComparison.Ordinal));
        Run("INSERT INTO meta VALUES ($1, $2)", "format", "1");
        Run("INSERT INTO meta VALUES ($1, $2)", "releases", "1");
        Run("INSERT INTO meta VALUES ($1, $2)", "built", "2026-10-04T00:00:00Z");
        Run("INSERT INTO groups VALUES (1, $1, 'The Bar Album', '', 'Album', 20010000)", Blob("7a0f0c3e-0000-4222-8333-944455556666"));
        Run("INSERT INTO releases VALUES (1, $1, 1, 'The Bar Album', 'Tagger', '', 'Official', '0602537000016', '602537000016', 20010000, 'GB', 'CD', $2)",
            Blob(Gid), """[[1,1,"Bar Album 1",3],[1,2,"Bar Album 2",3],[1,3,"Bar Album 3",3]]""");
    }

    // fn's answer once it is one (not null), or its last answer when the time is up.
    private static async Task<JsonNode?> Until(Func<Task<JsonNode?>> fn, int ms = 20000)
    {
        var t0 = Environment.TickCount64;
        for (; ; )
        {
            var v = await fn();
            if (v != null || Environment.TickCount64 - t0 > ms) return v;
            await Task.Delay(100);
        }
    }

    [Test]
    public async Task The_pack_places_what_it_can_while_musicbrainz_org_is_down_the_rest_waits()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        Directory.Delete(lib.Music, true);
        void Album(string dir, string name, Dictionary<string, object> tags)
        {
            for (int i = 1; i <= 3; i++)
            {
                var t = new Dictionary<string, object> { ["title"] = $"{name} {i}", ["artist"] = "Tagger", ["album"] = name, ["track"] = i, ["date"] = "2001" };
                foreach (var (k, v) in tags) t[k] = v;
                Fixtures.Gen(Path.Combine(lib.Music, dir, $"0{i}.flac"), seconds: 3, freq: 200 + 50 * i, tags: t);
            }
        }
        Album("Barcode", "Bar Album", new() { ["BARCODE"] = "0602537000016" });   // the pack has it
        Album("Plain", "Plain Album", []);                                         // only a search by name would find it
        Directory.CreateDirectory(lib.Data);
        WritePack(Path.Combine(lib.Data, "mbpack.sqlite"));
        await using var srv = await new TestServer(Ports.Port(), lib.Music, lib.Data, new Dictionary<string, object?>
        {
            ["serverIp"] = "127.0.0.1", ["sonosHosts"] = Array.Empty<string>(), ["upnpMulticast"] = false,
            ["identify"] = true, ["identifyTickMs"] = 100, ["mbBaseUrl"] = "http://127.0.0.1:9", ["itunesBaseUrl"] = "http://127.0.0.1:9"
        }).Start();
        var h = new Dictionary<string, string> { ["Authorization"] = "Bearer " + await Session.SignIn(srv.Base) };
        async Task<JsonNode> Api(string p, object? body = null) =>
            (body == null ? await Http.Get(srv.Base + "/api/" + p, h) : await Http.Post(srv.Base + "/api/" + p, body, h)).J;

        await Until(async () => (await Api("status")).Num("index_count") == 2 ? JsonValue.Create(true) : null);
        var head = await Http.Get(srv.Base + "/api/identify?lists=0", h);
        Assert.True(head.Header("x-mandarin-answered") == "C#", "the scan is the C# server's");
        await Api("identify/settings", new { schedule = false, itunes = false });

        // The barcoded album first, from the pack, though musicbrainz.org never answers.
        var r = await Until(async () => await Api("identify") is var j && j["applied"].Items().Count() == 1 ? j : null);
        Assert.True(r != null, "applied from the pack");
        var c = r["applied"]![0]!["candidate"];
        Assert.Equal((Gid, "The Bar Album", "barcode", (bool?)true), (c.Str("mbid"), c.Str("title"), c.Str("matched_by"), c.Bool("from_pack")));

        // musicbrainz.org fails for the plain album, the scan pauses, and with nothing left the pack can
        // answer it waits: the plain album is not marked unidentified.
        var paused = await Until(async () => await Api("identify") is var j && j.Str("reason") == "unreachable" ? j : null);
        Assert.True(paused != null, "paused once musicbrainz.org failed");
        Assert.Equal(0, paused["progress"].Num("unidentified"));
        Assert.Equal(1, paused["progress"].Num("checked"));

        // During that pause an album the pack can answer is still matched from it (the pack mode, not
        // the pause, decides): "Check again" undoes the match and forgets the verdict, and the pack
        // places the album again.
        var bar = r["applied"]![0]!["album"].Num("offset");
        var first = r["applied"]![0].Num("checked_at");
        await Api("identify/recheck", new { offset = bar });
        var again = await Until(async () => await Api("identify") is var j && j["applied"].Items().Count() == 1
            && j["applied"]![0].Num("checked_at") > first && j.Str("reason") == "unreachable" ? j : null);
        Assert.True(again != null, "matched from the pack again, then nothing more it can answer");
        Assert.Equal(bar, again["applied"]![0]!["album"].Num("offset"));
        Assert.True(again["applied"]![0]!["candidate"].Bool("from_pack"));
        Assert.Equal(0, again["progress"].Num("unidentified"));
    }
}
