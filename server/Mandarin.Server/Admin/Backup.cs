// Backup.cs — Backup & restore (v0.8.22), from lib/backup.js rule for rule.
//
// A backup is one file, mandarin-backup-<date>.tar.gz, holding:
//   manifest.json   what made it, when, and which parts are in it
//   server.json     the server's settings you changed, every player's own
//                   settings, your collection and the API keys, each part if chosen
//   tailscale.json  the server's Tailscale identity, with the keys
//   app.json        the Android app's own settings (from the app only)
//   page.json       one device's screen settings
//   musicd.db       the whole database, if chosen
//
// Written and read exactly as the Node server wrote and read them, so a
// backup it made restores here: the same tar headers, the same JSON
// (JSON.stringify's, one space a level), blobs as { $b64 }. Read as it read
// one: a file that isn't gzip, or is cut short, is refused in zlib's words;
// each JSON part 64 MB at most; the database copy to a file of its own.
// Restoring the whole database stages it, swapped in when the server starts
// again (Admin/Restore.cs), today's account, sign-ins and Tailscale identity kept.
using System.Globalization;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Admin;

using Js = Mandarin.Server.Tags.Js;

internal static partial class Backup
{
    public const int Format = 1;
    public static readonly string[] Parts = ["settings", "devices", "collection", "keys", "database"];
    public static readonly string[] ServerParts = ["settings", "devices", "collection", "keys"];
    // Settings a person sets, and nothing the server keeps for itself.
    public static readonly string[] SettingsKeys = ["displayEnabled", "displaySeconds", "homeRows", "identify",
        "labelFolderDepth", "labelsEnabled", "mbpack_dir", "music_folders", "radioZones", "replaygain",
        "shareCardReview", "shareReviews", "shareServices", "shelfEnabled", "smartPicksEnabled", "smartPicksHour", "waveformEnabled"];
    public static readonly string[] CollectionKeys = ["userPlaylists", "smartPlaylists"];
    public static readonly string[] CollectionTables = ["favourites", "listen_later", "label_merges", "album_edits", "track_edits", "album_matches"];
    // The Qobuz and Tidal sign-ins travel with the keys: tokens, never a password.
    public static readonly string[] KeyKeys = ["discogsToken", "fanartKey", "lastfmKey", "qobuz", "qobuzSettings", "tidal", "tidalSettings"];
    // Kept from the server being restored, whatever the database brought.
    private static readonly string[] KeepTables = ["account", "devices"];
    private static readonly string[] KeepSettings = ["authSecret", "tailscale"];

    /* An error the page shows, with its HTTP status (400 unless said). */
    public sealed class Refused(string message, int status = 400) : Exception(message)
    {
        public int Status { get; } = status;
    }

    // ------------------------------------------------------------ reading the database

    /* A column as better-sqlite3 gives it to JavaScript: numbers as numbers, blobs as Buffers. */
    private static object? Col(object? v) => v switch
    {
        null or DBNull => null,
        long l => (double)l,
        double d => d,
        string s => s,
        byte[] b => b,
        _ => Convert.ToString(v, CultureInfo.InvariantCulture)
    };

    /* rowOut: a row with its blobs as base64, so it goes into JSON and back. */
    private static JsObj RowOut(SqliteDataReader r)
    {
        var o = new JsObj();
        for (var i = 0; i < r.FieldCount; i++)
        {
            var v = Col(r.IsDBNull(i) ? null : r.GetValue(i));
            if (v is byte[] b) { var x = new JsObj(); x["$b64"] = Convert.ToBase64String(b); o[r.GetName(i)] = x; }
            else o[r.GetName(i)] = v;
        }
        return o;
    }

    private static List<object?> TableRows(SqliteConnection c, string table)
    {
        var rows = new List<object?>();
        try
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = $"SELECT * FROM {table}";
            using var r = cmd.ExecuteReader();
            while (r.Read()) rows.Add(RowOut(r));
        }
        catch (SqliteException) { return []; }
        return rows;
    }

    private static JsObj SettingsOf(SqliteConnection c, string[] keys)
    {
        var o = new JsObj();
        foreach (var k in keys)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT value FROM settings WHERE key = $k";
            cmd.Parameters.AddWithValue("$k", k);
            using var r = cmd.ExecuteReader();
            if (!r.Read()) continue;
            var raw = r.IsDBNull(0) ? "null" : Convert.ToString(r.GetValue(0), CultureInfo.InvariantCulture) ?? "null";
            try { o[k] = JsJson.Parse(raw); } catch (JsError) { /* unreadable: left out */ }
        }
        return o;
    }

    /* snapshot: the server's part of a backup, only the parts asked for. */
    public static JsObj Snapshot(SqliteConnection c, ISet<string> include)
    {
        var s = new JsObj();
        if (include.Contains("settings")) s["settings"] = SettingsOf(c, SettingsKeys);
        if (include.Contains("devices")) s["devices"] = TableRows(c, "audio_devices");
        if (include.Contains("collection"))
        {
            var col = new JsObj();
            col["settings"] = SettingsOf(c, CollectionKeys);
            var tables = new JsObj();
            foreach (var t in CollectionTables) tables[t] = TableRows(c, t);
            col["tables"] = tables;
            s["collection"] = col;
        }
        if (include.Contains("keys")) s["keys"] = SettingsOf(c, KeyKeys);
        return s;
    }

    // ------------------------------------------------------------ applying

    /* rowIn: a row's { $b64 } back to bytes. Object.entries of null throws, as there. */
    private static List<(string Key, object? Value)> RowIn(object? r0)
    {
        if (r0 is null or Undef) throw new Refused("Cannot convert undefined or null to object");
        var o = new List<(string, object?)>();
        if (r0 is JsObj j)
            foreach (var k in j.Keys)
            {
                var v = j[k];
                o.Add((k, v is JsObj b && b["$b64"] is string s ? Convert.FromBase64String(s) : v));
            }
        else if (r0 is string str) for (var i = 0; i < str.Length; i++) o.Add((i.ToString(CultureInfo.InvariantCulture), str[i].ToString()));
        else if (r0 is List<object?> l) for (var i = 0; i < l.Count; i++) o.Add((i.ToString(CultureInfo.InvariantCulture), l[i]));
        return o;
    }

    /* A value bound as better-sqlite3 binds it: numbers as doubles; true, false and objects refused. */
    private static object Bind(object? v) => v switch
    {
        null or Undef => DBNull.Value,
        double d => d,
        string s => s,
        byte[] b => b,
        _ => throw new Refused("SQLite3 can only bind numbers, strings, bigints, buffers, and null")
    };

    private static List<string> ColumnsOf(SqliteConnection c, string table)
    {
        var cols = new List<string>();
        try
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = $"PRAGMA table_info({table})";
            using var r = cmd.ExecuteReader();
            while (r.Read()) cols.Add(r.GetString(1));
        }
        catch (SqliteException) { return []; }
        return cols;
    }

    private static int Run(SqliteConnection c, string sql, params object?[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        for (var i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("$" + (i + 1), Bind(args[i]));
        return cmd.ExecuteNonQuery();
    }

    private static object? Scalar(SqliteConnection c, string sql, params object?[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        for (var i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("$" + (i + 1), Bind(args[i]));
        return cmd.ExecuteScalar();
    }

    private static string Placeholders(int n) => string.Join(",", Enumerable.Range(1, n).Select(i => "$" + i));

    /* The rows of a table in a backup, as JavaScript would walk them: a list's items, a string's characters, else not iterable. */
    private static IEnumerable<object?> Iterate(object? rows) => rows switch
    {
        null or Undef => [],
        List<object?> l => l,
        string s => s.Select(ch => (object?)ch.ToString()),
        _ when !Js.Truthy(rows) => [],
        _ => throw new Refused("rows is not iterable")
    };

    private static int ReplaceTable(SqliteConnection c, string table, object? rows)
    {
        var cols = ColumnsOf(c, table);
        if (cols.Count == 0) return 0;
        Run(c, $"DELETE FROM {table}");
        var n = 0;
        foreach (var r0 in Iterate(rows))
        {
            var r = RowIn(r0);
            var have = r.Select(x => x.Key).ToHashSet();
            var use = cols.Where(have.Contains).ToList();
            if (use.Count == 0) continue;
            var values = use.Select(u => r.Last(x => x.Key == u).Value).ToArray();
            Run(c, $"INSERT OR REPLACE INTO {table}({string.Join(",", use)}) VALUES({Placeholders(use.Count)})", values);
            n++;
        }
        return n;
    }

    private static object? SwapId(object? id, IReadOnlyDictionary<string, string>? map) =>
        map != null && id is not null and not Undef && map.TryGetValue(Js.Str(id), out var to) && to.Length > 0 ? to : id;

    /*
     * apply: the server's part of a backup, applied, in one transaction.
     * `map` swaps a player id for another (this phone's, after the app was
     * reinstalled). Settings the backup doesn't hold go back to their defaults.
     */
    public static List<string> Apply(SqliteConnection c, JsObj server, ISet<string> include, IReadOnlyDictionary<string, string>? map)
    {
        var done = new List<string>();
        void PutAll(string[] keys, object? values)
        {
            foreach (var k in keys)
            {
                if (values is JsObj vo && vo.Has(k))
                {
                    var v = vo[k];
                    if (k == "radioZones" && v is List<object?> zones) v = zones.Select(id => SwapId(id, map)).ToList();
                    Run(c, "INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, Js.Json(v));
                }
                else Run(c, "DELETE FROM settings WHERE key = $1", k);
            }
        }
        using var tx = c.BeginTransaction(System.Data.IsolationLevel.Serializable, deferred: false);
        if (include.Contains("settings") && Js.Truthy(server["settings"])) { PutAll(SettingsKeys, server["settings"]); done.Add("settings"); }
        if (include.Contains("devices") && server["devices"] is List<object?> devices)
        {
            var cols = ColumnsOf(c, "audio_devices");
            foreach (var r0 in devices)
            {
                var r = RowIn(r0);
                object? Get(string k) { for (var i = r.Count - 1; i >= 0; i--) if (r[i].Key == k) return r[i].Value; return Undef.V; }
                var id = SwapId(Get("id"), map);
                if (r.FindIndex(x => x.Key == "id") is var at && at >= 0) r[at] = ("id", id); else r.Add(("id", id));
                var have = Scalar(c, "SELECT id FROM audio_devices WHERE id = $1", id) != null;
                if (have) Run(c, "UPDATE audio_devices SET name = $1, settings = $2 WHERE id = $3",
                    Js.Truthy(Get("name")) ? Get("name") : null, Js.Truthy(Get("settings")) ? Get("settings") : "{}", id);
                else
                {
                    var keys = r.Select(x => x.Key).ToHashSet();
                    var use = cols.Where(keys.Contains).ToList();
                    Run(c, $"INSERT INTO audio_devices({string.Join(",", use)}) VALUES({Placeholders(use.Count)})", use.Select(Get).ToArray());
                }
            }
            done.Add("devices");
        }
        if (include.Contains("collection") && server["collection"] is var col && Js.Truthy(col))
        {
            var cs = col is JsObj co ? co["settings"] : Undef.V;
            PutAll(CollectionKeys, Js.Truthy(cs) ? cs : new JsObj());
            var tables = col is JsObj co2 && Js.Truthy(co2["tables"]) ? co2["tables"] : new JsObj();
            foreach (var t in CollectionTables)
            {
                var rows = tables is JsObj to ? to[t] : Undef.V;
                ReplaceTable(c, t, Js.Truthy(rows) ? rows : new List<object?>());
            }
            done.Add("collection");
        }
        if (include.Contains("keys") && Js.Truthy(server["keys"])) { PutAll(KeyKeys, server["keys"]); done.Add("keys"); }
        tx.Commit();
        return done;
    }
}
