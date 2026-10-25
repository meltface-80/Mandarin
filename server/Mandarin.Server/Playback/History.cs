// History.cs — the parts of lib/server/features.js that listen (v0.8.49,
// stage 6): each track that plays long enough to count written to the plays
// table with its album's id (a real id, so two artists' "Greatest Hits" never
// share a play count), Listen later's album coming off the list once every
// track has played, and Random Album Radio: another whole album on the end of
// the queue, never one the radio played in the last six months, and of those
// one not heard in 60 days when there is one. Smart Picks and the taste graph
// read the same table where they are (Extras/Taste.cs).
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Playback;

using AJs = Mandarin.Server.Js;

internal static class History
{
    private const double Day = 86400000;
    private static readonly HashSet<string> radioBusy = [];
    private static RadioMemory? memory;
    private static readonly object gate = new();

    /* The radio's memory, kept in radio_played: read once, written as it changes. */
    private static RadioMemory Memory()
    {
        lock (gate)
        {
            return memory ??= new RadioMemory(() =>
            {
                var o = new JsObj();
                using var c = Db.Open();
                foreach (var r in Library.Rows(c, "SELECT key, ts FROM radio_played")) o[(string)r[0]!] = r[1] is long l ? l : Jv.Num(r[1]);
                return o;
            }, played =>
            {
                using var c = Db.Open();
                using var tx = c.BeginTransaction();
                using (var del = c.CreateCommand()) { del.CommandText = "DELETE FROM radio_played"; del.ExecuteNonQuery(); }
                foreach (var k in played.Keys)
                {
                    using var put = c.CreateCommand();
                    put.CommandText = "INSERT INTO radio_played(key, ts) VALUES($k, $t)";
                    put.Parameters.AddWithValue("$k", k);
                    put.Parameters.AddWithValue("$t", (long)Jv.Num(played[k]));
                    put.ExecuteNonQuery();
                }
                tx.Commit();
            }, null);
        }
    }

    /* features.wire(): the hub's hooks. */
    public static void Wire(Hub hub)
    {
        hub.OnPlayed += (zoneId, st) => _ = RecordPlay(hub, zoneId, st).ContinueWith(t => hub.Log($"[history] {t.Exception?.InnerException?.Message}"), TaskContinuationOptions.OnlyOnFaulted);
        hub.OnQueueLow += (zoneId, st) => _ = RadioTopUp(hub, zoneId).ContinueWith(t => { if (t.Exception != null) hub.Log($"[radio] {t.Exception.InnerException?.Message}"); }, TaskContinuationOptions.OnlyOnFaulted);
    }

    // ------------------------------------------------------------- history

    private static async Task RecordPlay(Hub hub, string zoneId, ZoneState e)
    {
        try
        {
            var s = await Library.CurrentCopy();
            using var c = Db.Open();
            var t = e.TrackId != null && s != null ? Tracks.Of(c, s, e.TrackId.Value) : null;
            var al = t != null && s != null ? s.Find(t.AlbumId) : null;
            using var cmd = c.CreateCommand();
            cmd.CommandText = "INSERT INTO plays(album_id, track_id, title, artist, album, zone, ts) VALUES($a, $t, $title, $artist, $album, $zone, $ts)";
            cmd.Parameters.AddWithValue("$a", al != null ? al.Id : DBNull.Value);
            cmd.Parameters.AddWithValue("$t", t != null ? t.Id : DBNull.Value);
            cmd.Parameters.AddWithValue("$title", t?.Title is { Length: > 0 } tt ? tt : e.Title);
            cmd.Parameters.AddWithValue("$artist", t?.Artist is { Length: > 0 } ta ? ta : e.Artist);
            cmd.Parameters.AddWithValue("$album", al?.Title is { Length: > 0 } at ? at : e.Album);
            cmd.Parameters.AddWithValue("$zone", zoneId);
            cmd.Parameters.AddWithValue("$ts", (long)Hub.Now());
            cmd.ExecuteNonQuery();
            // Listen later: the album comes off the list once every track has played.
            if (al != null && s != null && LaterPlayed(c, s, al)) hub.Log($"[later] played through: {al.Title}");
        }
        catch (Exception ex) when (ex is SqliteException or IOException) { hub.Log($"[history] {ex.Message}"); }
    }

    /*
     * A play was recorded for a track of this album: once every track has a
     * play since the album was put aside, the album comes off the list. An
     * album left part way stays.
     */
    private static bool LaterPlayed(SqliteConnection c, Snapshot s, Album al)
    {
        if (!s.Marks.Later.TryGetValue(al.Key, out var since)) return false;
        var played = Library.Rows(c, "SELECT DISTINCT track_id FROM plays WHERE album_id = $1 AND ts >= $2 AND track_id IS NOT NULL", al.Id, since).Select(r => (long)r[0]!).ToHashSet();
        var tracks = Tracks.OfAlbum(c, s, al.Id);
        if (tracks.Count == 0 || tracks.Any(t => !played.Contains(t.Id))) return false;
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "DELETE FROM listen_later WHERE key = $k";
            cmd.Parameters.AddWithValue("$k", al.Key);
            cmd.ExecuteNonQuery();
        }
        _ = Library.Tell(new JsonObject { ["marks"] = true });
        return true;
    }

    /* When Mandarin first played anything (ms), or null. */
    public static double? FirstPlay(SqliteConnection c)
    {
        var r = Library.Rows(c, "SELECT MIN(ts) AS ts FROM plays");
        return r.Count > 0 && r[0][0] is long l && l != 0 ? l : null;
    }

    /* features.unplayed(count, months): albums not heard in `months`, once there is that much history; else none. */
    public static (List<Album> Albums, int Total, bool NoHistory) Unplayed(SqliteConnection c, Snapshot s, int count, int months)
    {
        var first = FirstPlay(c);
        var since = Hub.Now() - months * 30 * Day;
        if (first == null || first > since) return ([], 0, true);
        var heard = Tracks.PlayedAlbumIdsSince(c, since);
        var pool = s.Albums.Where(al => !heard.Contains(al.Id)).ToList();
        var want = Math.Min(count, pool.Count);
        var picked = new List<Album>();
        var seen = new HashSet<int>();
        while (picked.Count < want)
        {
            var i = Random.Shared.Next(pool.Count);
            if (seen.Add(i)) picked.Add(pool[i]);
        }
        return (picked, pool.Count, false);
    }

    // --------------------------------------------------------------- radio

    public static HashSet<string> RadioZones(SqliteConnection c) =>
        Db.Setting(c, "radioZones") is JsonArray a ? a.Select(x => AJs.Str(x)).ToHashSet() : [];
    public static bool RadioEnabled(SqliteConnection c, string zoneId) => RadioZones(c).Contains(zoneId);
    public static void SetRadio(SqliteConnection c, string zoneId, bool on)
    {
        var s = RadioZones(c);
        if (on) s.Add(zoneId); else s.Remove(zoneId);
        QueueStore.SetSetting(c, "radioZones", new JsonArray(s.Select(x => (JsonNode)x).ToArray()));
    }

    /*
     * Another whole album on the end of the queue: never one the radio itself
     * played in the last six months, and of those one not heard in 60 days.
     */
    public static async Task<Album?> RadioTopUp(Hub hub, string zoneId, bool force = false)
    {
        using (var c = Db.Open())
        {
            if (!force && !RadioEnabled(c, zoneId)) return null;
        }
        lock (gate) { if (!radioBusy.Add(zoneId)) return null; }
        // Let go on every way out (item 185): an empty library kept the room busy, and its radio dead until a restart.
        try
        {
            Album? al;
            using (var c = Db.Open())
            {
                var s = await Library.CurrentCopy();
                if (s == null || s.Count == 0) return null;
                var recent = Tracks.PlayedAlbumIdsSince(c, Hub.Now() - 60 * Day);
                var i = Memory().Pick(s.Albums, a => RadioMemory.RadioKey(AlbumJs(a)), a => recent.Contains(a.Id), Random.Shared.NextDouble);
                al = i < 0 ? null : s.Albums[i];
            }
            if (al == null) return null;
            await Items.PlayAlbum(hub, zoneId, al.Id, "queue");
            // Used up only once the room has taken it: a failed add costs nothing.
            Memory().Note(RadioMemory.RadioKey(AlbumJs(al)));
            hub.Log($"[radio] {zoneId}: queued \"{al.Title}\" by {al.Artist}");
            return al;
        }
        finally { lock (gate) radioBusy.Remove(zoneId); }
    }

    private static JsObj AlbumJs(Album al) => Jv.Obj(("title", al.Title), ("artist", al.Artist));
}
