// ArtistRows.cs — the library's artists (item 330): each act an id of its own, its name beside it, so two acts of the
// same name (Airbag from Norway and Airbag from Argentina) are two artists and their albums are not run together.
//
//   artists(id, mbid, name, key, note): id the library's own; mbid MusicBrainz's for the act, unique where known; name
//   as an album credits it, the same name allowed on many rows; key the name as artists are matched (Names.ArtistKey);
//   note what MusicBrainz says to tell the act from others of its name ("Norwegian progressive rock band").
//   albums.artist_id: the artist an album is by; albums.mb_artist: the MusicBrainz id it was filed by.
//
// An album is filed (Scanner.Album.cs) by the MusicBrainz id its files' tags give (TagReader.Ids.cs), else the one its
// applied MusicBrainz match gives for an act of the same name: the artist with that id, or the one act of that name not
// yet told by an id (it is that act), or a new one. An album with no id goes to the one act of its name, or, where its
// name is shared by acts with ids, to the act of that name with none. A name only one act has is one artist, as ever.
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static class ArtistRows
{
    private const string Table = """
CREATE TABLE IF NOT EXISTS artists (
  id    INTEGER PRIMARY KEY,
  mbid  TEXT UNIQUE,
  name  TEXT NOT NULL,
  key   TEXT NOT NULL,
  note  TEXT
);
CREATE INDEX IF NOT EXISTS artists_key ON artists(key);
CREATE INDEX IF NOT EXISTS albums_artist ON albums(artist_id);
""";

    /* The artists' table, made where it isn't yet. */
    public static void Ensure(SqliteConnection c, SqliteTransaction? tx = null) => Exec(c, tx, Table);

    /*
     * The artist album credit [name] is, [mbid] MusicBrainz's id for it where known ([note] what MusicBrainz says of the
     * act, kept where none is yet): its id, made where there is none.
     */
    public static long For(SqliteConnection c, SqliteTransaction? tx, string name, string? mbid, string? note = null)
    {
        Ensure(c, tx);
        var key = Names.ArtistKey(name);
        var same = Rows(c, tx, "SELECT id, mbid FROM artists WHERE key = $k ORDER BY id", ("$k", key));
        if (mbid != null)
        {
            if (Scalar(c, tx, "SELECT id FROM artists WHERE mbid = $m", ("$m", mbid)) is long known)
            {
                Exec(c, tx, "UPDATE artists SET note = COALESCE(note, $n) WHERE id = $id", ("$n", note), ("$id", known));
                return known;
            }
            // The one act of this name, not yet told by an id: this one.
            var untold = same.Where(r => r.Mbid == null).ToList();
            if (untold.Count == 1 && same.All(r => r.Mbid == null))
            {
                Exec(c, tx, "UPDATE artists SET mbid = $m, note = COALESCE(note, $n) WHERE id = $id", ("$m", mbid), ("$n", note), ("$id", untold[0].Id));
                return untold[0].Id;
            }
            return Insert(c, tx, mbid, name, key, note);
        }
        if (same.Count == 1) return same[0].Id;
        return same.FirstOrDefault(r => r.Mbid == null)?.Id ?? Insert(c, tx, null, name, key, null);
    }

    /* The artists no album is by, forgotten (an act whose albums have all left the library). */
    public static void Prune(SqliteConnection c, SqliteTransaction? tx = null)
    {
        Ensure(c, tx);
        Exec(c, tx, "DELETE FROM artists WHERE id NOT IN (SELECT artist_id FROM albums WHERE artist_id IS NOT NULL)");
    }

    /*
     * What an applied MusicBrainz match ([candidate], album_matches' JSON) says of the act credited [name]: its id and
     * note, where the match credits the same name (a match that names another act says nothing of this one).
     */
    public static (string? Mbid, string? Note) FromMatch(string? candidate, string name)
    {
        if (string.IsNullOrEmpty(candidate)) return (null, null);
        JsonObject? o;
        try { o = JsonNode.Parse(candidate) as JsonObject; }
        catch (System.Text.Json.JsonException) { return (null, null); }
        var id = Tags.TagReader.ArtistMbid((string?)Value(o?["artist_mbid"]));
        var credited = (string?)Value(o?["artist"]) ?? "";
        if (id == null || Names.ArtistKey(Names.SplitArtists(credited).FirstOrDefault() ?? credited) != Names.ArtistKey(Names.SplitArtists(name).FirstOrDefault() ?? name))
            return (null, null);
        var note = (string?)Value(o?["artist_note"]);
        return (id, string.IsNullOrWhiteSpace(note) ? null : note.Trim());
    }

    private static JsonNode? Value(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out _) ? n : null;

    /* Every artist, by id: its MusicBrainz id and note (the library's snapshot, Library.Artists.cs). */
    public static Dictionary<long, (string? Mbid, string? Note)> All(SqliteConnection c)
    {
        Ensure(c);
        var m = new Dictionary<long, (string? Mbid, string? Note)>();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id, mbid, note FROM artists";
        using var r = cmd.ExecuteReader();
        while (r.Read()) m[r.GetInt64(0)] = (r.IsDBNull(1) ? null : r.GetString(1), r.IsDBNull(2) ? null : r.GetString(2));
        return m;
    }

    private sealed record Row(long Id, string? Mbid);

    private static long Insert(SqliteConnection c, SqliteTransaction? tx, string? mbid, string name, string key, string? note)
    {
        Exec(c, tx, "INSERT INTO artists(mbid, name, key, note) VALUES($m, $name, $k, $n)", ("$m", mbid), ("$name", name), ("$k", key), ("$n", note));
        return (long)Scalar(c, tx, "SELECT last_insert_rowid()")!;
    }

    private static SqliteCommand Command(SqliteConnection c, SqliteTransaction? tx, string sql, (string, object?)[] ps)
    {
        var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.Transaction = tx;
        foreach (var (k, v) in ps) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
        return cmd;
    }

    private static void Exec(SqliteConnection c, SqliteTransaction? tx, string sql, params (string, object?)[] ps)
    {
        using var cmd = Command(c, tx, sql, ps);
        cmd.ExecuteNonQuery();
    }

    private static object? Scalar(SqliteConnection c, SqliteTransaction? tx, string sql, params (string, object?)[] ps)
    {
        using var cmd = Command(c, tx, sql, ps);
        return cmd.ExecuteScalar() is var v && v is DBNull ? null : v;
    }

    private static List<Row> Rows(SqliteConnection c, SqliteTransaction? tx, string sql, params (string, object?)[] ps)
    {
        using var cmd = Command(c, tx, sql, ps);
        using var r = cmd.ExecuteReader();
        var list = new List<Row>();
        while (r.Read()) list.Add(new Row(r.GetInt64(0), r.IsDBNull(1) ? null : r.GetString(1)));
        return list;
    }
}
