// HomeRoutes.cs — Home's rows (v0.8.6), from lib/server/api-library.js and
// lib/server/features.js: Album of the day, Label of the week, Recently played
// and Not played lately. The day and the week are the Node server's (its time
// zone), told with the library's state, so both servers turn over together.
using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Library
{
    public static uint Fnv1a(string s)
    {
        uint h = 0x811c9dc5;
        foreach (var c in s) { h ^= c; h = unchecked(h * 0x01000193); }
        return h;
    }

    /*
     * The day's album: chosen at the first ask of the day and kept in the
     * database (the setting album_of_the_day), so it stays the day's album
     * through scans and restarts, whichever server is asked.
     */
    private static Album? DayAlbum(SqliteConnection c, Snapshot s, LibState st)
    {
        if (s.Albums.Count == 0) return null;
        if (Db.Setting(c, "album_of_the_day") is JsonObject kept && kept["day"] is JsonValue dv && dv.TryGetValue<string>(out var kd) && kd == st.Day)
        {
            Album? al = null;
            var key = kept["key"] is JsonValue kv && kv.TryGetValue<string>(out var ks) ? ks : null;
            if (!string.IsNullOrEmpty(key)) al = s.Albums.FirstOrDefault(a => a.Key == key);
            if (al == null && kept["id"] is JsonValue iv && iv.TryGetValue<double>(out var id) && id == Math.Floor(id)) s.ById.TryGetValue((long)id, out al);
            if (al != null) return al;
        }
        var sorted = s.Albums.OrderBy(a => a.Id).ToList();
        var pick = sorted[(int)(Fnv1a(st.Day) % (uint)sorted.Count)];
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$k", "album_of_the_day");
        cmd.Parameters.AddWithValue("$v", new JsonObject { ["day"] = st.Day, ["key"] = pick.Key, ["id"] = pick.Id, ["at"] = Now }.ToJsonString(Out));
        cmd.ExecuteNonQuery();
        return pick;
    }

    private static Task<bool> AlbumOfTheDay(HttpContext ctx, Snapshot s, LibState st)
    {
        if (st.Day.Length == 0) return Task.FromResult(false);   // a Node server too old to say which day it is
        using var c = Db.Open();
        var al = DayAlbum(c, s, st);
        if (al == null) return Send(ctx, new JsonObject { ["album"] = null, ["day"] = st.Day });
        // Gone from Home once played today (since 00:01).
        var played = Rows(c, "SELECT 1 FROM plays WHERE album_id = $1 AND ts >= $2 LIMIT 1", al.Id, st.DayStart).Count > 0;
        if (played) return Send(ctx, new JsonObject { ["album"] = null, ["played"] = true, ["day"] = st.Day });
        return Send(ctx, new JsonObject { ["album"] = AlbumJson(s, al), ["played"] = false, ["day"] = st.Day });
    }

    /* One label a week, from those with three albums or more. */
    private static Task<bool> LabelOfTheWeek(HttpContext ctx, Snapshot s, LibState st)
    {
        if (st.Week.Length == 0) return Task.FromResult(false);
        LabelGroup? g = null;
        if (s.LabelsOn)
        {
            var keys = s.LabelGroups.Values.Where(x => x.Albums.Count >= 3).Select(x => x.Key).OrderBy(k => k, StringComparer.Ordinal).ToList();
            if (keys.Count > 0) g = s.LabelGroups[keys[(int)(Fnv1a(st.Week) % (uint)keys.Count)]];
        }
        if (g == null) return Send(ctx, new JsonObject { ["label"] = null, ["albums"] = new JsonArray() });
        return Send(ctx, new JsonObject { ["label"] = g.Title, ["albums"] = AlbumList(s, g.Albums.Take(24)) });
    }

    /* The albums played in the last 30 days, the latest first. */
    private static Task<bool> History(HttpContext ctx, Snapshot s, LibState st)
    {
        var count = (int)Math.Min(60, Math.Max(1, IntOr(Q(ctx, "count"), 60)));
        using var c = Db.Open();
        var rows = Rows(c, "SELECT album_id, MAX(ts) AS ts FROM plays WHERE ts >= $1 AND album_id IS NOT NULL GROUP BY album_id ORDER BY ts DESC LIMIT $2",
            Now - 30 * Day, count);
        var albums = rows.Select(r => s.ById.TryGetValue((long)r[0]!, out var al) ? al : null).Where(a => a != null).Select(a => a!);
        return Send(ctx, new JsonObject { ["albums"] = AlbumList(s, albums), ["days"] = 30 });
    }

    /* Albums not played in [months]: only once Mandarin has that much listening behind it. */
    private static Task<bool> Unplayed(HttpContext ctx, Snapshot s, LibState st)
    {
        var months = PInt(Q(ctx, "months")) is long mo && mo > 0 && mo <= 60 ? mo : 6;
        var count = PInt(Q(ctx, "count")) is long co && co > 0 && co <= 96 ? (int)co : 12;
        using var c = Db.Open();
        var firstRow = Rows(c, "SELECT MIN(ts) AS ts FROM plays");
        long? first = firstRow.Count > 0 ? Long(firstRow[0][0]) : null;
        var since = Now - months * 30 * Day;
        if (first == null || first > since)
            return Send(ctx, new JsonObject { ["albums"] = new JsonArray(), ["total"] = 0, ["months"] = months, ["no_history"] = true,
                ["ready_at"] = first != null ? first + months * 30 * Day : null });
        var heard = new HashSet<long>(Rows(c, "SELECT DISTINCT album_id FROM plays WHERE ts >= $1 AND album_id IS NOT NULL", since).Select(r => (long)r[0]!));
        var pool = s.Albums.Where(al => !heard.Contains(al.Id)).ToList();
        var chosen = new List<Album>();
        var seen = new HashSet<long>();
        int want = Math.Min(count, pool.Count);
        while (chosen.Count < want) { var al = pool[Random.Shared.Next(pool.Count)]; if (seen.Add(al.Id)) chosen.Add(al); }
        return Send(ctx, new JsonObject { ["albums"] = AlbumList(s, chosen), ["total"] = pool.Count, ["months"] = months, ["no_history"] = false, ["ready_at"] = null });
    }
}
