// Schema.cs — the database's tables and migrations (v0.8.48, stage 5 part 8 of
// old/csharp-migration.md): made and brought up to date here, as
// lib/library/db.js open() and the Features constructor (lib/server/
// features.js) made them, statement for statement, so the file reads the same
// whichever made it (test/Mandarin.Tests/DbCsharpTests.cs holds the two together).
//
//   - the tables and their indexes, with the same CREATE text (sqlite_master
//     keeps it as written);
//   - the columns added since a table first shipped (CREATE TABLE IF NOT
//     EXISTS leaves a table as it is), and user_version;
//   - a database made by something else (another program, or an older project
//     that used the same volume), whose tables lack columns this one needs:
//     moved aside as musicd.old-<ms>.db, a fresh one made, and what is worth
//     keeping (what you did, not what a scan finds again) carried over;
//   - the album edits, kept twice: read back from album-edits.json into an
//     empty table, and that file written where there are edits and none yet;
//   - Smart Picks' and the radio's tables (the Features constructor's).
//
// `mandarin-server db <data folder>` runs it, its log lines first and one line
// of JSON last ({ ok, existed, aside, version }): the Node server runs it when
// it opens the database behind this server (DB.open, MANDARIN_SERVER_DB=1), so
// a backup put back as it starts again is brought up to date here too. This
// server runs it itself before it starts the Node server (Program.cs).
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static class Schema
{
    /* lib/library/db.js SCHEMA, as it is written there. */
    private const string Tables = """
CREATE TABLE IF NOT EXISTS albums (
  id            INTEGER PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  artist        TEXT NOT NULL,
  sort_title    TEXT NOT NULL DEFAULT '',
  sort_artist   TEXT NOT NULL DEFAULT '',
  year          INTEGER,
  date          TEXT,
  label         TEXT,
  genres        TEXT NOT NULL DEFAULT '[]',
  dir           TEXT NOT NULL DEFAULT '',
  art_path      TEXT,
  art_embedded  TEXT,
  art_hash      TEXT,
  track_count   INTEGER NOT NULL DEFAULT 0,
  duration      REAL NOT NULL DEFAULT 0,
  max_rate      INTEGER,
  max_bits      INTEGER,
  lossless      INTEGER NOT NULL DEFAULT 1,
  container     TEXT,
  compilation   INTEGER NOT NULL DEFAULT 0,
  added_at      INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tracks (
  id            INTEGER PRIMARY KEY,
  album_id      INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  path          TEXT NOT NULL UNIQUE,
  mtime         INTEGER NOT NULL,
  size          INTEGER NOT NULL,
  title         TEXT NOT NULL,
  artist        TEXT NOT NULL DEFAULT '',
  album_artist  TEXT NOT NULL DEFAULT '',
  album         TEXT NOT NULL DEFAULT '',
  track_no      INTEGER,
  disc_no       INTEGER,
  duration      REAL NOT NULL DEFAULT 0,
  codec         TEXT,
  container     TEXT,
  sample_rate   INTEGER,
  bits          INTEGER,
  channels      INTEGER,
  lossless      INTEGER NOT NULL DEFAULT 0,
  year          INTEGER,
  date          TEXT,
  label         TEXT,
  genres        TEXT NOT NULL DEFAULT '[]',
  has_picture   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tracks_album ON tracks(album_id);
CREATE TABLE IF NOT EXISTS plays (
  id        INTEGER PRIMARY KEY,
  album_id  INTEGER,
  track_id  INTEGER,
  title     TEXT,
  artist    TEXT,
  album     TEXT,
  zone      TEXT,
  ts        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_album ON plays(album_id);
CREATE INDEX IF NOT EXISTS plays_ts ON plays(ts);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- The albums you hearted, by the album's identity from its tags, so a
-- favourite survives a rescan the way an edit does.
CREATE TABLE IF NOT EXISTS favourites (
  key       TEXT PRIMARY KEY,
  added_at  INTEGER NOT NULL
);
-- Listen later (v0.5.28): albums put aside to play, by the same identity;
-- off the list once every track has been played since, or by hand.
CREATE TABLE IF NOT EXISTS listen_later (
  key       TEXT PRIMARY KEY,
  added_at  INTEGER NOT NULL
);
-- Record labels (v0.5.30): two names you said are one label (the source
-- folded into the target, by label key), and the logo kept for a label.
CREATE TABLE IF NOT EXISTS label_merges (
  source_key   TEXT PRIMARY KEY,
  source_name  TEXT NOT NULL,
  target_key   TEXT NOT NULL,
  merged_at    INTEGER NOT NULL
);
-- A label looked up for an album whose files carry none (v0.5.31), by the
-- album's identity; NULL label = asked and nothing found.
CREATE TABLE IF NOT EXISTS label_lookups (
  key           TEXT PRIMARY KEY,
  label         TEXT,
  source        TEXT,
  looked_up_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS label_logos (
  key         TEXT PRIMARY KEY,
  file        TEXT NOT NULL,
  type        TEXT NOT NULL,
  source      TEXT NOT NULL,
  url         TEXT,
  updated_at  INTEGER NOT NULL
);
-- What you corrected by hand. The music folders are read-only, so a fixed
-- title, artist, year or a found cover lives here, keyed by the album's
-- identity from its tags, and is laid over the scanned album on every load.
-- NULL means "as scanned".
CREATE TABLE IF NOT EXISTS album_edits (
  key         TEXT PRIMARY KEY,
  title       TEXT,
  artist      TEXT,
  year        INTEGER,
  art         BLOB,
  art_hash    TEXT,
  art_source  TEXT,
  updated_at  INTEGER NOT NULL
);
-- A track's corrected title (lib/identify), keyed by its album's identity and
-- its place on the album ("disc-track"), so it survives a rescan like an
-- album edit does. Laid over the track when the album's tracks are listed.
-- Every tag of every file, as the file carries it (v0.6.0-RC5): { KEY: [values] }.
-- Nothing a file says is thrown away; what Mandarin uses is also in tracks.
CREATE TABLE IF NOT EXISTS track_tags (
  track_id  INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  tags      TEXT NOT NULL
);
-- Loudness measured by the server for files without ReplayGain tags
-- (v0.6.0-RC5): EBU R128 integrated loudness and true peak, per track.
CREATE TABLE IF NOT EXISTS track_loudness (
  track_id     INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  lufs         REAL,
  peak         REAL,
  measured_at  INTEGER NOT NULL,
  error        TEXT
);
-- Each file read by both tag readers, this server's and the C# one
-- (lib/library/tagcheck.js, v0.8.13): what came of it, as the file was then.
-- outcome: same, different, both_failed, node_failed, csharp_failed, crashed.
CREATE TABLE IF NOT EXISTS tag_checks (
  track_id    INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  mtime       INTEGER,
  size        INTEGER,
  outcome     TEXT NOT NULL,
  detail      TEXT,
  checked_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS track_edits (
  key    TEXT NOT NULL,
  pos    TEXT NOT NULL,
  title  TEXT,
  PRIMARY KEY (key, pos)
);
-- What the identification scan (lib/identify) decided about each album: the
-- MusicBrainz release it matched, how far off it was (0 = identical), and
-- whether the names were applied, proposed for you to accept, or nothing
-- close enough was found. "before" holds the edit the album had before an
-- applied match, so it can be undone.
CREATE TABLE IF NOT EXISTS album_matches (
  key         TEXT PRIMARY KEY,
  mbid        TEXT,
  distance    REAL,
  status      TEXT NOT NULL,
  candidate   TEXT,
  before      TEXT,
  checked_at  INTEGER NOT NULL,
  applied_at  INTEGER
);
-- The one account (see lib/server/auth.js). Only the SRP salt and verifier
-- are kept: never the password, nor anything a password can be read from.
CREATE TABLE IF NOT EXISTS account (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  username    TEXT NOT NULL,
  salt        TEXT NOT NULL,
  verifier    TEXT NOT NULL,
  iterations  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
-- Each signed-in browser, app or wall display. The token itself is never
-- stored, only its SHA-256, so the database can't be used to sign in.
CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  last_ip     TEXT
);
CREATE TABLE IF NOT EXISTS cache (
  ns     TEXT NOT NULL,
  key    TEXT NOT NULL,
  value  TEXT NOT NULL,
  ts     INTEGER NOT NULL,
  PRIMARY KEY (ns, key)
);
-- The id an album had when it last left the library (its folder gone for a
-- while): given back when it returns, so plays, downloads on phones and
-- playlists that name it by id find it again.
CREATE TABLE IF NOT EXISTS album_ids (
  key  TEXT PRIMARY KEY,
  id   INTEGER NOT NULL
);
-- Every player Mandarin has met (lib/renderers/registry.js): Sonos rooms,
-- phones running the app, UPnP renderers. The name you gave it, what it is,
-- what it can take (caps, in layers) and its settings. Kept across a rebuild.
CREATE TABLE IF NOT EXISTS audio_devices (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  family        TEXT NOT NULL DEFAULT '',
  network_name  TEXT NOT NULL,
  name          TEXT,
  manufacturer  TEXT,
  model         TEXT,
  model_number  TEXT,
  firmware      TEXT,
  ip            TEXT,
  location      TEXT,
  caps          TEXT NOT NULL DEFAULT '{}',
  settings      TEXT NOT NULL DEFAULT '{}',
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL
);
""";

    // Bumped whenever SCHEMA changes in a way CREATE TABLE IF NOT EXISTS can't fix (db.js SCHEMA_VERSION).
    public const int Version = 1;

    // Columns added after a table first shipped, each nullable (db.js ADDED_COLUMNS).
    private static readonly (string Table, string Column, string Type)[] Added =
    [
        // The release date as precisely as the tags state it, beside the year (v0.3.13).
        ("albums", "date", "TEXT"),
        ("tracks", "date", "TEXT"),
        // Whether iTunes was asked about an album MusicBrainz couldn't place (v0.5.49).
        ("album_matches", "itunes", "TEXT"),
        // What identifies a recording and a release, and the files' own loudness (v0.6.0-RC5).
        ("tracks", "tags_v", "INTEGER"),
        ("tracks", "isrc", "TEXT"),
        ("tracks", "barcode", "TEXT"),
        ("tracks", "catno", "TEXT"),
        ("tracks", "country", "TEXT"),
        ("tracks", "mb_album", "TEXT"),
        ("tracks", "mb_group", "TEXT"),
        ("tracks", "mb_recording", "TEXT"),
        ("tracks", "rg_track_gain", "REAL"),
        ("tracks", "rg_track_peak", "REAL"),
        ("tracks", "rg_album_gain", "REAL"),
        ("tracks", "rg_album_peak", "REAL"),
        // Which of a track's names came from its folder and file name (v0.6.0-RC10).
        ("tracks", "names_from", "TEXT"),
        ("albums", "barcode", "TEXT"), ("albums", "catno", "TEXT"), ("albums", "country", "TEXT"), ("albums", "mb_album", "TEXT"), ("albums", "mb_group", "TEXT"),
        // A classical track's composer, conductor, work, movement and performers (bug list item 48, Tags/Classical.cs).
        ("tracks", "composer", "TEXT"), ("tracks", "conductor", "TEXT"), ("tracks", "work", "TEXT"),
        ("tracks", "movement", "TEXT"), ("tracks", "movement_no", "INTEGER"), ("tracks", "performers", "TEXT"),
    ];

    /* Smart Picks and the radio's memory (lib/server/features.js, the Features constructor). */
    private const string FeatureTables = """
      CREATE TABLE IF NOT EXISTS smart_blocks (canon TEXT PRIMARY KEY, artist TEXT, ts INTEGER);
      CREATE TABLE IF NOT EXISTS smart_picks (day TEXT, rank INTEGER, album_id INTEGER, reason TEXT, PRIMARY KEY(day, rank));
      CREATE TABLE IF NOT EXISTS radio_played (key TEXT PRIMARY KEY, ts INTEGER);
""";

    // What is worth keeping from a database that has to be replaced (db.js KEEP).
    private static readonly string[] Keep = ["album_edits", "plays", "settings", "account", "devices", "audio_devices", "favourites", "listen_later",
        "track_edits", "album_matches", "label_merges", "label_logos", "label_lookups"];

    private const string EditsFile = "album-edits.json";

    /* What bringing it up to date came to. */
    public sealed record Made(bool Existed, string? Aside);

    private static double NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static SqliteConnection Open(string file)
    {
        var c = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = file, Mode = SqliteOpenMode.ReadWriteCreate, Pooling = false, DefaultTimeout = 60
        }.ToString());
        c.Open();
        Exec(c, "PRAGMA busy_timeout = 30000");
        return c;
    }

    private static void Exec(SqliteConnection c, string sql, params (string, object?)[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    private static object? Scalar(SqliteConnection c, string sql)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        return cmd.ExecuteScalar();
    }

    private static List<string> Names(SqliteConnection c, string sql)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        using var r = cmd.ExecuteReader();
        var list = new List<string>();
        while (r.Read()) list.Add(r.GetString(0));
        return list;
    }

    /* PRAGMA [schema.]table_info(t): its columns, in order. */
    private static List<string> Columns(SqliteConnection c, string table, string schema = "main") =>
        Names(c, $"SELECT name FROM pragma_table_info('{table}', '{schema}') ORDER BY cid");

    private static List<string> TableNames(SqliteConnection c, string schema = "main") =>
        Names(c, $"SELECT name FROM {schema}.sqlite_master WHERE type = 'table'");

    private static long UserVersion(SqliteConnection c) => Convert.ToInt64(Scalar(c, "PRAGMA user_version"), CultureInfo.InvariantCulture);

    /* The columns each table must have, read from the schema itself (db.js expectedColumns). */
    private static Dictionary<string, List<string>> Expected()
    {
        using var mem = new SqliteConnection("Data Source=:memory:");
        mem.Open();
        Exec(mem, Tables);
        var out_ = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var t in TableNames(mem)) out_[t] = Columns(mem, t);
        return out_;
    }

    /*
     * A database this build can't use: one written by another program whose
     * tables lack columns ours need. Never our own file: a database from a
     * NEWER version of the server (the image rolled back) is kept and used.
     */
    private static bool Incompatible(SqliteConnection c)
    {
        var tables = TableNames(c);
        if (tables.Count == 0) return false;                    // brand new file
        if (UserVersion(c) >= Version) return false;
        foreach (var (table, cols) in Expected())
        {
            if (!tables.Contains(table)) continue;
            var have = Columns(c, table).ToHashSet(StringComparer.Ordinal);
            var added = Added.Where(a => a.Table == table).Select(a => a.Column).ToHashSet(StringComparer.Ordinal);
            if (cols.Any(col => !have.Contains(col) && !added.Contains(col))) return true;
        }
        return false;
    }

    private static void AddColumns(SqliteConnection c)
    {
        foreach (var (table, col, type) in Added)
            if (!Columns(c, table).Contains(col)) { Exec(c, $"ALTER TABLE {table} ADD COLUMN {col} {type}"); if (table == "tracks" && col == "composer") Exec(c, "UPDATE tracks SET tags_v = 1 WHERE tags_v > 1"); }   // the classical fields (item 48) just added: every track read once more for them at the next scan
    }

    /* What you did, copied column by column from the database moved aside, where its tables have them (db.js carryOver). */
    private static void CarryOver(SqliteConnection c, string oldFile, Action<string> log)
    {
        try
        {
            Exec(c, "ATTACH DATABASE $f AS old", ("$f", oldFile));
            var oldTables = TableNames(c, "old").ToHashSet(StringComparer.Ordinal);
            foreach (var t in Keep)
            {
                if (!oldTables.Contains(t)) continue;
                var theirs = Columns(c, t, "old").ToHashSet(StringComparer.Ordinal);
                var cols = Columns(c, t).Where(theirs.Contains).ToList();
                if (cols.Count == 0) continue;
                var list = string.Join(", ", cols);
                using var cmd = c.CreateCommand();
                cmd.CommandText = $"INSERT OR IGNORE INTO main.{t}({list}) SELECT {list} FROM old.{t}";
                var n = cmd.ExecuteNonQuery();
                // t.replace("_", " "): the first one only, as JavaScript replaces a string.
                var i = t.IndexOf('_');
                if (n > 0) log($"[musicd] kept {n} {(i < 0 ? t : t[..i] + " " + t[(i + 1)..])} row(s) from the old database");
            }
        }
        catch (SqliteException e) { log($"[musicd] couldn't carry anything over from {oldFile}: {e.Message}"); }
        finally
        {
            try { Exec(c, "DETACH DATABASE old"); } catch (SqliteException) { /* not attached */ }
        }
    }

    private static long Count(SqliteConnection c, string table) => Convert.ToInt64(Scalar(c, $"SELECT COUNT(*) AS n FROM {table}"), CultureInfo.InvariantCulture);

    /* JavaScript's truthiness, for what a JSON file held. */
    private static bool Truthy(JsonNode? n) => n switch
    {
        null => false,
        JsonValue v when v.TryGetValue<bool>(out var b) => b,
        JsonValue v when v.TryGetValue<string>(out var s) => s.Length > 0,
        JsonValue v when v.TryGetValue<double>(out var d) => d != 0 && !double.IsNaN(d),
        _ => true
    };

    /* A value from the file as better-sqlite3 binds it: text, a number (a double), true/false as 1/0. */
    private static object? Bind(JsonNode? n) => n switch
    {
        null => null,
        JsonValue v when v.TryGetValue<string>(out var s) => s,
        JsonValue v when v.TryGetValue<bool>(out var b) => b ? 1L : 0L,
        JsonValue v when v.TryGetValue<double>(out var d) => d,
        _ => n.ToJsonString()
    };

    /* The album edits read back from album-edits.json, into an empty table (db.js importEdits). */
    private static int ImportEdits(SqliteConnection c, string dataDir, Action<string> log)
    {
        var file = Path.Combine(dataDir, EditsFile);
        if (!File.Exists(file)) return 0;
        if (Count(c, "album_edits") > 0) return 0;
        JsonNode? doc;
        try { doc = JsonNode.Parse(File.ReadAllText(file)); }
        catch (Exception e) when (e is System.Text.Json.JsonException or IOException) { log($"[musicd] {file} is unreadable: {e.Message}"); return 0; }
        var n = 0;
        using var tx = c.BeginTransaction(deferred: false);
        var edits = doc is JsonObject o && Truthy(o["edits"]) ? o["edits"] as JsonArray : null;
        foreach (var r in edits ?? [])
        {
            if (r is not JsonObject e || !Truthy(e["key"])) continue;
            using var cmd = c.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = @"INSERT OR IGNORE INTO album_edits(key, title, artist, year, art, art_hash, art_source, updated_at)
                          VALUES($key, $title, $artist, $year, $art, $art_hash, $art_source, $updated_at)";
            object? Or(string k) => Truthy(e[k]) ? Bind(e[k]) : null;
            cmd.Parameters.AddWithValue("$key", Bind(e["key"]) ?? DBNull.Value);
            foreach (var k in new[] { "title", "artist", "year", "art_hash", "art_source" }) cmd.Parameters.AddWithValue("$" + k, Or(k) ?? DBNull.Value);
            object art = DBNull.Value;
            if (Truthy(e["art"]))
            {
                // Buffer.from(…, "base64"): what can be read of it.
                try { art = Convert.FromBase64String(Base64Of(e["art"])); } catch (FormatException) { art = Array.Empty<byte>(); }
            }
            cmd.Parameters.AddWithValue("$art", art);
            cmd.Parameters.AddWithValue("$updated_at", Or("updated_at") ?? NowMs());
            n += cmd.ExecuteNonQuery();
        }
        tx.Commit();
        if (n > 0) log($"[musicd] restored {n} album edit(s) from {file}");
        return n;
    }

    /* A base64 string as Buffer.from reads it: URL-safe letters too, padding optional, anything else skipped. */
    private static string Base64Of(JsonNode? n)
    {
        var s = n is JsonValue v && v.TryGetValue<string>(out var t) ? t : n?.ToJsonString() ?? "";
        var sb = new StringBuilder(s.Length + 3);
        foreach (var ch in s)
        {
            if (ch == '=') break;
            if (ch is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '+' or '/') sb.Append(ch);
            else if (ch == '-') sb.Append('+');
            else if (ch == '_') sb.Append('/');
        }
        if (sb.Length % 4 == 1) sb.Length--;
        while (sb.Length % 4 != 0) sb.Append('=');
        return sb.ToString();
    }

    /* album-edits.json written from the table (db.js exportEdits): the edits, their covers as base64. */
    public static void ExportEdits(SqliteConnection c, string dataDir)
    {
        var rows = new List<object?>();
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT * FROM album_edits";
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                var o = new Tags.JsObj();
                for (int i = 0; i < r.FieldCount; i++)
                {
                    var name = r.GetName(i);
                    var v = r.IsDBNull(i) ? null : r.GetValue(i);
                    // r.art ? base64 : null — an empty blob is a Buffer, and truthy; other blobs as better-sqlite3 gives them.
                    o[name] = v switch
                    {
                        null => null,
                        byte[] b when name == "art" => Convert.ToBase64String(b),
                        byte[] b => BlobJson(b),
                        long l => (double)l,
                        double d => d,
                        string s => s,
                        _ => Convert.ToString(v, CultureInfo.InvariantCulture)
                    };
                }
                rows.Add(o);
            }
        }
        var doc = new Tags.JsObj();
        doc["version"] = 1.0;
        doc["saved_at"] = NowMs();
        doc["edits"] = rows;
        var file = Path.Combine(dataDir, EditsFile);
        var tmp = file + ".tmp";
        File.WriteAllText(tmp, Tags.Js.Json(doc));
        File.Move(tmp, file, overwrite: true);
    }

    /* A Buffer as JSON.stringify writes one: { type: "Buffer", data: [...] }. */
    private static Tags.JsObj BlobJson(byte[] b)
    {
        var o = new Tags.JsObj();
        o["type"] = "Buffer";
        o["data"] = b.Select(x => (object?)(double)x).ToList();
        return o;
    }

    /*
     * The database made, or brought up to date (db.js open, up to the point it
     * starts answering; and the Features constructor's tables).
     */
    public static Made Bring(string dataDir, Action<string> log)
    {
        Directory.CreateDirectory(dataDir);
        var file = Path.Combine(dataDir, "musicd.db");
        var existed = File.Exists(file);
        string? aside = null;
        var c = Open(file);
        try
        {
            if (Incompatible(c))
            {
                c.Dispose();
                aside = Path.Combine(dataDir, $"musicd.old-{(long)NowMs()}.db");
                foreach (var suffix in new[] { "", "-wal", "-shm" })
                    if (File.Exists(file + suffix)) File.Move(file + suffix, aside + suffix);
                log($"[musicd] {file} was made by something else (another program or an older version); moved it to {aside} and starting a fresh library");
                c = Open(file);
            }
            Exec(c, "PRAGMA journal_mode = WAL");
            Exec(c, "PRAGMA foreign_keys = ON");
            Exec(c, "PRAGMA synchronous = NORMAL");
            Exec(c, Tables);
            AddColumns(c);
            if (UserVersion(c) < Version) Exec(c, $"PRAGMA user_version = {Version}");
            if (aside != null) CarryOver(c, aside, log);
            ImportEdits(c, dataDir, log);
            // Edits made before the backup file existed get one now.
            try { if (Count(c, "album_edits") > 0 && !File.Exists(Path.Combine(dataDir, EditsFile))) ExportEdits(c, dataDir); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or SqliteException) { /* best effort */ }
            Exec(c, FeatureTables);
            if (!existed) log($"[musicd] new database at {file}");
            return new Made(existed, aside);
        }
        finally { c.Dispose(); }
    }

    /* `mandarin-server db <data folder>`: the log lines, then { ok, existed, aside, version }. */
    public static int Command(string dataDir)
    {
        try
        {
            var made = Bring(Path.GetFullPath(dataDir), Console.WriteLine);
            Console.WriteLine(new JsonObject { ["ok"] = true, ["existed"] = made.Existed, ["aside"] = made.Aside, ["version"] = Version }.ToJsonString());
            return 0;
        }
        catch (Exception e) when (e is SqliteException or IOException or UnauthorizedAccessException)
        {
            Console.WriteLine(new JsonObject { ["ok"] = false, ["error"] = e.Message }.ToJsonString());
            return 1;
        }
    }
}
