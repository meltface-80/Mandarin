// CreditStore.cs — the albums' credits and what is known of each act (bug
// list item 129), kept in tables of their own beside the library's: made the
// first time something is kept (Schema.cs keeps the library's own, as the
// Node server made them), and read as empty until then. All of it can be
// found again, so a database replaced keeps none of it (Schema.cs's Keep).
//
//   album_credits       one row a name on an album: its roles and tracks (JSON)
//   album_credit_state  each album looked at: the release asked and what came of it
//   artist_info         one row an act, by its key (Names.ArtistKey): its MusicBrainz
//                       id, kind, facts (JSON) and picture's address
using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Credits;

/* An act as kept: [About] its facts as CreditStore.AboutJson wrote them. */
internal sealed record StoredArtist(string Key, string Name, string? Mbid, string? Type, JsonObject About, string? Photo, string? PhotoSource, long Fetched);

internal static class CreditStore
{
    private const string Tables = """
CREATE TABLE IF NOT EXISTS album_credits (
  album_id  INTEGER NOT NULL,
  key       TEXT NOT NULL,
  name      TEXT NOT NULL,
  mbid      TEXT,
  roles     TEXT NOT NULL,
  tracks    TEXT NOT NULL,
  source    TEXT NOT NULL,
  PRIMARY KEY (album_id, key)
);
CREATE INDEX IF NOT EXISTS album_credits_key ON album_credits(key);
CREATE TABLE IF NOT EXISTS album_credit_state (
  album_id  INTEGER PRIMARY KEY,
  release   TEXT,
  status    TEXT NOT NULL,
  ts        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS artist_info (
  key           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  mbid          TEXT,
  type          TEXT,
  about         TEXT NOT NULL DEFAULT '{}',
  photo         TEXT,
  photo_source  TEXT,
  fetched       INTEGER NOT NULL
);
""";

    private static volatile bool made;

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /* A connection with the tables made (only what keeps something asks for this). */
    private static SqliteConnection Writing()
    {
        var c = Db.Open();
        if (!made)
        {
            Exec(c, Tables);
            made = true;
        }
        return c;
    }

    /* A connection to read, or null while the tables aren't there yet (nothing kept). */
    private static SqliteConnection? Reading()
    {
        var c = Db.Open();
        if (made) return c;
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'artist_info'";
            if (Convert.ToInt64(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) > 0) { made = true; return c; }
        }
        c.Dispose();
        return null;
    }

    private static void Exec(SqliteConnection c, string sql, params (string, object?)[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    private static List<object?[]> Rows(SqliteConnection c, string sql, params (string, object?)[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
        using var r = cmd.ExecuteReader();
        var list = new List<object?[]>();
        while (r.Read())
        {
            var row = new object?[r.FieldCount];
            for (var i = 0; i < r.FieldCount; i++) row[i] = r.IsDBNull(i) ? null : r.GetValue(i);
            list.Add(row);
        }
        return list;
    }

    private static string Strings(IEnumerable<string> list) => new JsonArray(list.Select(x => (JsonNode?)x).ToArray()).ToJsonString();
    private static string Ints(IEnumerable<int> list) => new JsonArray(list.Select(x => (JsonNode?)x).ToArray()).ToJsonString();
    private static List<string> StringsOf(object? v) => Parsed(v) is JsonArray a ? a.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0).ToList() : [];
    private static List<int> IntsOf(object? v) => Parsed(v) is JsonArray a ? a.Select(x => x?.GetValue<int>() ?? 0).Where(x => x > 0).ToList() : [];
    private static JsonNode? Parsed(object? v)
    {
        if (v is not string s) return null;
        try { return JsonNode.Parse(s); } catch (System.Text.Json.JsonException) { return null; }
    }
    private static string? Text(object? v) => v is string s && s.Length > 0 ? s : null;
    private static long Long(object? v) => v == null ? 0 : Convert.ToInt64(v, CultureInfo.InvariantCulture);

    // ---------------------------------------------------------------- albums

    /* An album's credits kept, in place of any before, and what came of looking ([status]: "tags", "musicbrainz" or "failed"). */
    public static void SaveAlbum(long albumId, IReadOnlyList<AlbumCredit> rows, string? release, string status)
    {
        using var c = Writing();
        using var tx = c.BeginTransaction();
        Exec(c, "DELETE FROM album_credits WHERE album_id = $a", ("$a", albumId));
        foreach (var r in rows)
            Exec(c, "INSERT OR REPLACE INTO album_credits(album_id, key, name, mbid, roles, tracks, source) VALUES($a, $k, $n, $m, $r, $t, $s)",
                ("$a", albumId), ("$k", r.Key), ("$n", r.Name), ("$m", r.Mbid), ("$r", Strings(r.Roles)), ("$t", Ints(r.Tracks)), ("$s", r.Source));
        Exec(c, "INSERT INTO album_credit_state(album_id, release, status, ts) VALUES($a, $rel, $st, $ts) " +
                "ON CONFLICT(album_id) DO UPDATE SET release = excluded.release, status = excluded.status, ts = excluded.ts",
            ("$a", albumId), ("$rel", release), ("$st", status), ("$ts", NowMs()));
        tx.Commit();
    }

    /* What came of looking at an album, or null when it hasn't been. */
    public static string? AlbumStatus(long albumId)
    {
        using var c = Reading();
        if (c == null) return null;
        return Rows(c, "SELECT status FROM album_credit_state WHERE album_id = $a", ("$a", albumId)).Select(r => Text(r[0])).FirstOrDefault();
    }

    /* Every album looked at already: one whose looking failed only when that was after [failedSince] (ms). */
    public static HashSet<long> AlbumsLooked(long failedSince)
    {
        using var c = Reading();
        if (c == null) return [];
        return Rows(c, "SELECT album_id FROM album_credit_state WHERE status <> 'failed' OR ts > $s", ("$s", failedSince)).Select(r => Long(r[0])).ToHashSet();
    }

    /* An album's credits, in the order kept. */
    public static List<AlbumCredit> AlbumCredits(long albumId)
    {
        using var c = Reading();
        if (c == null) return [];
        return Rows(c, "SELECT key, name, mbid, roles, tracks, source FROM album_credits WHERE album_id = $a ORDER BY rowid", ("$a", albumId))
            .Select(r => new AlbumCredit((string)r[0]!, (string)r[1]!, Text(r[2]), StringsOf(r[3]), IntsOf(r[4]), (string)r[5]!)).ToList();
    }

    /* The albums a name is credited on, with its roles there. */
    public static List<(long AlbumId, List<string> Roles)> CreditedOn(string key)
    {
        using var c = Reading();
        if (c == null) return [];
        return Rows(c, "SELECT album_id, roles FROM album_credits WHERE key = $k", ("$k", key)).Select(r => (Long(r[0]), StringsOf(r[1]))).ToList();
    }

    /* Names credited with a MusicBrainz id and not yet looked up, a few at a time. */
    public static List<(string Key, string Name, string Mbid)> CreditedUnknown(int limit)
    {
        using var c = Reading();
        if (c == null) return [];
        return Rows(c, "SELECT key, min(name), min(mbid) FROM album_credits WHERE mbid IS NOT NULL AND key NOT IN (SELECT key FROM artist_info) GROUP BY key LIMIT $l",
            ("$l", limit)).Select(r => ((string)r[0]!, (string)r[1]!, (string)r[2]!)).ToList();
    }

    // ---------------------------------------------------------------- acts

    /* An act's facts as kept in artist_info.about. */
    public static JsonObject AboutJson(ArtistFacts? f)
    {
        var o = new JsonObject();
        if (f == null) return o;
        static JsonArray Stints(IEnumerable<Member> list) => new(list.Select(m => (JsonNode?)new JsonObject
        {
            ["name"] = m.Name, ["mbid"] = m.Mbid, ["begin"] = m.Begin, ["end"] = m.End, ["ended"] = m.Ended,
            ["roles"] = new JsonArray(m.Roles.Select(x => (JsonNode?)x).ToArray()),
        }).ToArray());
        o["disambiguation"] = f.Disambiguation;
        o["begin"] = f.Begin;
        o["end"] = f.End;
        o["ended"] = f.Ended;
        o["area"] = f.Area;
        o["members"] = Stints(f.Members);
        o["member_of"] = Stints(f.MemberOf);
        var links = new JsonObject();
        foreach (var (k, v) in f.Links) links[k] = v;
        o["links"] = links;
        return o;
    }

    /* What is known of an act kept, in place of any before ([facts] null: looked for, nothing found). */
    public static void SaveArtist(string key, string name, string? mbid, ArtistFacts? facts, string? photo, string? photoSource)
    {
        using var c = Writing();
        Exec(c, "INSERT INTO artist_info(key, name, mbid, type, about, photo, photo_source, fetched) VALUES($k, $n, $m, $t, $a, $p, $ps, $f) " +
                "ON CONFLICT(key) DO UPDATE SET name = excluded.name, mbid = excluded.mbid, type = excluded.type, about = excluded.about, " +
                "photo = excluded.photo, photo_source = excluded.photo_source, fetched = excluded.fetched",
            ("$k", key), ("$n", name), ("$m", mbid), ("$t", facts?.Type), ("$a", AboutJson(facts).ToJsonString()), ("$p", photo), ("$ps", photoSource), ("$f", NowMs()));
    }

    private static StoredArtist ArtistOf(object?[] r) => new((string)r[0]!, (string)r[1]!, Text(r[2]), Text(r[3]),
        Parsed(r[4]) as JsonObject ?? new JsonObject(), Text(r[5]), Text(r[6]), Long(r[7]));

    private const string ArtistColumns = "key, name, mbid, type, about, photo, photo_source, fetched";

    /* An act by its key, or null when it hasn't been looked up. */
    public static StoredArtist? Artist(string key)
    {
        using var c = Reading();
        if (c == null) return null;
        return Rows(c, $"SELECT {ArtistColumns} FROM artist_info WHERE key = $k", ("$k", key)).Select(ArtistOf).FirstOrDefault();
    }

    /* Every act looked up, by key: its picture's address (null where none was found). */
    public static Dictionary<string, string?> Photos()
    {
        using var c = Reading();
        var m = new Dictionary<string, string?>(StringComparer.Ordinal);
        if (c == null) return m;
        foreach (var r in Rows(c, "SELECT key, photo FROM artist_info")) m[(string)r[0]!] = Text(r[1]);
        return m;
    }

    /* How far the looking has come: albums and acts. */
    public static (long Albums, long Artists, long Photos) Counts()
    {
        using var c = Reading();
        if (c == null) return (0, 0, 0);
        var a = Long(Rows(c, "SELECT count(*) FROM album_credit_state")[0][0]);
        var r = Rows(c, "SELECT count(*), count(photo) FROM artist_info")[0];
        return (a, Long(r[0]), Long(r[1]));
    }
}
