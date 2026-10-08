// Taste.cs — what you listen to, and what it suggests (v0.8.20): the parts of
// lib/server/features.js that learn from your plays, rule for rule, with the
// Deezer lookups of the share card's suggestions (api-library.js).
//
//  - The taste graph: the related lists of your most-played acts folded into
//    one map of act → nearness (Similar.cs), built once a day; the related
//    lists are kept a week, so the daily rebuild is usually no network at all.
//  - Smart Picks: five records you own and haven't been playing, by acts next
//    to the ones you have, steady for the day; with no history yet (or no
//    network) the least-played corners of the library.
//  - The share card's three acts: Deezer's related acts for the one playing
//    (kept a day), weighted by the taste graph, steered away from what was
//    shown lately (a month), each with a record (kept a week).
//
// Deezer is asked without a key. The plays themselves are still written, and
// thinned out, by the Node server, which plays.
using System.Globalization;
using System.Text.Json.Nodes;
using Mandarin.Server.Identify;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal sealed class Taste(string? deezerBase, Action<string> log)
{
    public const string DeezerBase = "https://api.deezer.com";
    private const double Day = 86400000;

    private readonly string deezer = (string.IsNullOrEmpty(deezerBase) ? DeezerBase : deezerBase).TrimEnd('/');
    private readonly object gate = new();
    /* Whether this server may go on (the Node server has handed the work over). */
    public Func<bool> Ready { get; init; } = () => true;

    private static double NowMs => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /* features.js dayKey(): the day on this machine's clock, "2026-10-08". */
    public static string DayKey(DateTime? d = null) => (d ?? DateTime.Now).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private Task<object?> Deezer(string path) => Lookups.Json(deezer + "/" + path, [], 8000);

    // ------------------------------------------------------------ the cache table

    /* db.cacheGet(ns, key, maxAgeMs): undefined when there's none, it's older, or it won't parse. */
    public static object? CacheGet(string ns, string key, double maxAgeMs)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value, ts FROM cache WHERE ns = $n AND key = $k";
        cmd.Parameters.AddWithValue("$n", ns);
        cmd.Parameters.AddWithValue("$k", key);
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return Undef.V;
        if (maxAgeMs > 0 && NowMs - (r.IsDBNull(1) ? 0 : r.GetDouble(1)) > maxAgeMs) return Undef.V;
        try { return JsJson.Parse(r.GetString(0)); } catch (Exception) { return Undef.V; }
    }
    public static void CachePut(string ns, string key, object? value)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO cache(ns, key, value, ts) VALUES($n, $k, $v, $t) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts";
        cmd.Parameters.AddWithValue("$n", ns);
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", Js.Json(value) ?? "null");
        cmd.Parameters.AddWithValue("$t", NowMs);
        cmd.ExecuteNonQuery();
    }

    // ------------------------------------------------------------ related acts

    /* An act's related acts, [{ name, id }] (three at most), kept a week. */
    public async Task<List<object?>> RelatedActs(string name)
    {
        var key = Names.Fold(name);
        var hit = CacheGet("related", key, 7 * Day);
        if (Js.Truthy(hit)) return hit as List<object?> ?? [];
        var search = await Deezer("search/artist?limit=" + Similar.SearchRows + "&q=" + Lookups.Encode(name));
        var acts = new List<object?>();
        foreach (var c in Similar.ReadDeezerArtists(search, name).Take(Similar.Candidates))
        {
            var rel = await Deezer("artist/" + Lookups.Encode(c.Id) + "/related?limit=25");
            acts = Similar.ReadDeezerRelated(rel).Select(a =>
            {
                var o = new JsObj();
                o["name"] = a.Name;
                o["id"] = a.Id;
                return (object?)o;
            }).ToList();
            if (acts.Count > 0) break;
        }
        CachePut("related", key, acts);
        return acts;
    }

    /* The plays since a time, as playedArtists ranks them: { artist, ts }. */
    private static List<(object? Artist, object? Ts)> Plays(double since)
    {
        var rows = new List<(object?, object?)>();
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT artist, ts FROM plays WHERE ts >= $t AND artist != ''";
        cmd.Parameters.AddWithValue("$t", since);
        using var r = cmd.ExecuteReader();
        while (r.Read()) rows.Add((r.IsDBNull(0) ? null : Convert.ToString(r.GetValue(0), CultureInfo.InvariantCulture), r.IsDBNull(1) ? null : Convert.ToDouble(r.GetValue(1), CultureInfo.InvariantCulture)));
        return rows;
    }

    private static string Split(object? artist) => ShareLinks.PrimaryArtist(artist);

    // ------------------------------------------------------------ the taste graph

    public sealed record Built(string? Day, Dictionary<string, Similar.Near> Graph, HashSet<string> Played, HashSet<string> Heavy);
    private static readonly Built Nothing = new(null, [], [], []);
    private volatile Built? built;
    private Task? building;

    /* The graph for today: built in the background when it isn't; until then, yesterday's (or nothing). */
    public Built Current()
    {
        var b = built;
        if (b == null || b.Day != DayKey()) Build();
        return built ?? Nothing;
    }

    public Task Build()
    {
        lock (gate)
        {
            if (building != null) return building;
            var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            building = done.Task;
            _ = Task.Run(async () =>
            {
                try { await BuildNow(); }
                catch (Exception e) { log($"[taste] {e.Message}"); }
                finally
                {
                    lock (gate) building = null;
                    done.SetResult();
                }
            });
            return building;
        }
    }

    /* Built again now (one already building finishes first): the graph as it stands after. */
    public async Task<Built> Rebuild()
    {
        Task? running;
        lock (gate) running = building;
        if (running != null) await running;
        await Build();
        return built ?? Nothing;
    }

    private async Task BuildNow()
    {
        // limit: Infinity is not a number playedArtists takes: its forty.
        var all = Similar.PlayedArtists(Plays(NowMs - 180 * Day), Split, 40);
        var seeds = all.Take(40).ToList();
        var rel = new Dictionary<string, List<object?>>();
        foreach (var s in seeds)
        {
            try { rel[s.Name] = await RelatedActs(s.Name); }
            catch (Exception) { rel[s.Name] = []; }
        }
        // The acts you play most — five or more days of them — need no introduction.
        var heavy = seeds.Where(s => s.Days >= 5).Take(5).Select(s => Similar.Normalize(s.Name)).ToHashSet();
        var graph = Similar.TasteGraph(seeds, n => rel.TryGetValue(n, out var l) ? l : null, NowMs);
        built = new Built(DayKey(), graph, all.Select(s => Similar.Normalize(s.Name)).ToHashSet(), heavy);
        if (seeds.Count > 0) log($"[taste] {graph.Count} acts near the {seeds.Count} you play");
    }

    // ------------------------------------------------------------ the share card's acts

    private readonly Dictionary<string, List<object?>> poolMemo = [];
    private readonly List<string> poolOrder = [];

    /* Deezer's related acts for the act playing, with what the scoring needs: kept a day. */
    public async Task<List<object?>> SimilarPool(string primary)
    {
        var key = Similar.Normalize(primary);
        List<object?>? pool;
        lock (poolMemo) pool = poolMemo.TryGetValue(key, out var m) ? m : null;
        if (pool != null) return pool;
        var hit = CacheGet("similar-pool", key, Day);
        if (Js.Truthy(hit)) return hit as List<object?> ?? [];
        pool = [];
        try
        {
            var search = await Deezer("search/artist?limit=" + Similar.SearchRows + "&q=" + Lookups.Encode(primary));
            foreach (var cand in Similar.ReadDeezerArtists(search, primary).Take(Similar.Candidates))
            {
                pool = Similar.ReadDeezerPool(await Deezer("artist/" + Lookups.Encode(cand.Id) + "/related?limit=" + Similar.RelatedRows)).Select(a => (object?)a.PoolJson()).ToList();
                if (pool.Count > 0) break;
            }
            CachePut("similar-pool", key, pool);
        }
        // Deezer away: nothing this time, and asked again next time (not remembered as nothing).
        catch (Exception) { return []; }
        lock (poolMemo)
        {
            if (!poolMemo.ContainsKey(key)) poolOrder.Add(key);
            poolMemo[key] = pool;
            if (poolOrder.Count > 200) { poolMemo.Remove(poolOrder[0]); poolOrder.RemoveAt(0); }
        }
        return pool;
    }

    /* An act's best-known record and its albums: kept a week. */
    public async Task<(JsObj? Top, List<object?> Albums)> ActRecords(Act act)
    {
        if (CacheGet("similar-act", act.Id, 7 * Day) is JsObj hit && Js.Truthy(hit))
            return (hit["top"] as JsObj, hit["albums"] as List<object?> ?? []);
        JsObj? top = null;
        List<object?> albums = [];
        try { top = Similar.ReadDeezerTop(await Deezer("artist/" + Lookups.Encode(act.Id) + "/top?limit=10")); } catch (Exception) { top = null; }
        try { albums = Similar.ReadDeezerAlbumList(await Deezer("artist/" + Lookups.Encode(act.Id) + "/albums?limit=50")); } catch (Exception) { albums = []; }
        if (top != null || albums.Count > 0)
        {
            var v = new JsObj();
            v["top"] = top;
            v["albums"] = albums;
            CachePut("similar-act", act.Id, v);
        }
        return (top, albums);
    }

    // ------------------------------------------------------------ Smart Picks

    /* { enabled, hour, auto_add, service_ready }, as kept (enabled and hour as they were saved). */
    public static (object? Enabled, object? Hour) SmartSettings()
    {
        var on = Labels.Setting("smartPicksEnabled");
        var hour = Labels.Setting("smartPicksHour");
        return (on is Undef ? true : on, hour is Undef ? 4.0 : hour);
    }

    private sealed record PickRow(double Rank, double? AlbumId, string? Reason);

    private static List<PickRow> ReadPicks(string day)
    {
        var rows = new List<PickRow>();
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT rank, album_id, reason FROM smart_picks WHERE day = $d ORDER BY rank";
        cmd.Parameters.AddWithValue("$d", day);
        using var r = cmd.ExecuteReader();
        while (r.Read())
            rows.Add(new PickRow(r.IsDBNull(0) ? 0 : r.GetDouble(0), r.IsDBNull(1) ? null : r.GetDouble(1), r.IsDBNull(2) ? null : Convert.ToString(r.GetValue(2), CultureInfo.InvariantCulture)));
        return rows;
    }

    private Task? smartBuilding;
    public bool SmartBuilding { get { lock (gate) return smartBuilding != null; } }

    /* Today's picks made, unless they are (or forced: made again). */
    public void Kick(Snapshot s, bool force)
    {
        var (enabled, _) = SmartSettings();
        lock (gate)
        {
            if (!Js.Truthy(enabled) || smartBuilding != null || s.Count == 0) return;
            var day = DayKey();
            if (!force && ReadPicks(day).Count > 0) return;
            var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            smartBuilding = done.Task;
            _ = Task.Run(async () =>
            {
                try { await BuildPicks(s, day); }
                catch (Exception e) { log($"[smart] {e.Message}"); }
                finally
                {
                    lock (gate) smartBuilding = null;
                    done.SetResult();
                }
            });
        }
    }

    /*
     * Five records you OWN and have not been playing, by acts next to the ones
     * you have: their neighbours from Deezer's related lists, seeded by what you
     * played over the last three months; the rest from the least-played corners.
     */
    private async Task BuildPicks(Snapshot s, string day)
    {
        if (s.Count == 0) return;
        var blocked = new HashSet<string>();
        var recent = new HashSet<long>();
        var count = new Dictionary<long, double>();
        using (var c = Db.Open())
        {
            using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = "SELECT canon FROM smart_blocks";
                using var r = cmd.ExecuteReader();
                while (r.Read()) if (!r.IsDBNull(0)) blocked.Add(Convert.ToString(r.GetValue(0), CultureInfo.InvariantCulture)!);
            }
            using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = "SELECT DISTINCT album_id FROM plays WHERE ts >= $t AND album_id IS NOT NULL";
                cmd.Parameters.AddWithValue("$t", NowMs - 180 * Day);
                using var r = cmd.ExecuteReader();
                while (r.Read()) recent.Add(Convert.ToInt64(r.GetValue(0), CultureInfo.InvariantCulture));
            }
        }
        bool Eligible(Album al) => !recent.Contains(al.Id) && !al.ArtistNames.Any(n => blocked.Contains(n.N)) && !al.Compilation;
        var picks = new List<(long AlbumId, string Reason)>();
        var used = new HashSet<long>();
        var seeds = Similar.PlayedArtists(Plays(NowMs - 90 * Day), Split, 8);
        foreach (var seed in seeds)
        {
            if (picks.Count >= 5 || !Ready()) break;
            List<object?> acts;
            try { acts = await RelatedActs(seed.Name); } catch (Exception) { acts = []; }
            foreach (var a0 in acts)
            {
                if (picks.Count >= 5) break;
                var q = Names.Fold(a0 is JsObj a && !Js.IsNullish(a["name"]) ? Js.Str(a["name"]) : "");
                var owned = s.Albums.Where(al => Eligible(al) && !used.Contains(al.Id) && (al.NArtist == q || al.ArtistNames.Any(n => n.N == q))).ToList();
                if (owned.Count == 0) continue;
                var al = owned[(int)(Library.Seeded(day + string.Join(",", owned.Select(x => x.Id.ToString(CultureInfo.InvariantCulture))), 7) % (uint)owned.Count)];
                used.Add(al.Id);
                picks.Add((al.Id, $"Because you have been playing {seed.Name}"));
            }
        }
        // Fill with the least-played corners of the library.
        if (picks.Count < 5)
        {
            using (var c = Db.Open())
            using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = "SELECT album_id, COUNT(*) AS n FROM plays WHERE album_id IS NOT NULL GROUP BY album_id";
                using var r = cmd.ExecuteReader();
                while (r.Read()) count[Convert.ToInt64(r.GetValue(0), CultureInfo.InvariantCulture)] = Convert.ToDouble(r.GetValue(1), CultureInfo.InvariantCulture);
            }
            double N(Album al) => count.TryGetValue(al.Id, out var n) ? n : 0;
            var pool = Library.Sorted(s.Albums.Where(al => Eligible(al) && !used.Contains(al.Id)), (a, b) =>
            {
                var d = Lookups.Sgn(N(a) - N(b));
                return d != 0 ? d : Math.Sign((long)Library.Seeded(day + a.NTitle, 3) - Library.Seeded(day + b.NTitle, 3));
            });
            var bottom = pool.Take(Math.Max(40, (int)Math.Ceiling(pool.Count / 4.0))).ToList();
            bottom = Library.Sorted(bottom, (a, b) => Math.Sign((long)Library.Seeded(day + a.NTitle + a.NArtist, 11) - Library.Seeded(day + b.NTitle + b.NArtist, 11)));
            foreach (var al in bottom)
            {
                if (picks.Count >= 5) break;
                used.Add(al.Id);
                var n = N(al);
                picks.Add((al.Id, n > 0 ? $"Played {Js.Num(n)} time{(n == 1 ? "" : "s")}, and not for a while" : "Never played here"));
            }
        }
        using (var c = Db.Open())
        {
            using var tx = c.BeginTransaction();
            void Exec(string sql, params (string, object)[] ps)
            {
                using var cmd = c.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = sql;
                foreach (var (k, v) in ps) cmd.Parameters.AddWithValue(k, v);
                cmd.ExecuteNonQuery();
            }
            Exec("DELETE FROM smart_picks WHERE day = $d", ("$d", day));
            for (var i = 0; i < picks.Count; i++)
                Exec("INSERT OR REPLACE INTO smart_picks(day, rank, album_id, reason) VALUES($d, $r, $a, $why)", ("$d", day), ("$r", (double)i), ("$a", (double)picks[i].AlbumId), ("$why", picks[i].Reason));
            Exec("DELETE FROM smart_picks WHERE day < $d", ("$d", DayKey(DateTimeOffset.FromUnixTimeMilliseconds((long)(NowMs - 7 * Day)).LocalDateTime)));
            tx.Commit();
        }
        log($"[smart] {day}: {picks.Count} picks from {seeds.Count} seed artists");
    }

    /* GET /api/smart-picks: today's, made if they aren't. */
    public JsObj PicksJson(Snapshot s)
    {
        var day = DayKey();
        var rows = ReadPicks(day);
        if (rows.Count == 0) Kick(s, false);
        var (enabled, hour) = SmartSettings();
        var o = new JsObj();
        o["day"] = day;
        o["enabled"] = enabled;
        o["service_ready"] = true;
        o["auto_add"] = false;
        o["hour"] = hour;
        o["building"] = rows.Count == 0 && SmartBuilding;
        var picks = new List<object?>();
        foreach (var r in rows)
        {
            var al = r.AlbumId is { } id ? s.Find(id) : null;
            if (al == null) continue;
            var p = new JsObj();
            p["artist"] = al.Artist;
            p["album"] = al.Title;
            p["image"] = $"/api/image/{Lookups.Encode(al.ImageKey)}?size=400";
            p["reason"] = r.Reason;
            p["offset"] = (double)al.Id;
            p["library_title"] = al.Title;
            p["library_subtitle"] = al.Artist;
            p["image_key"] = al.ImageKey;
            picks.Add(p);
        }
        o["picks"] = picks;
        return o;
    }

    /* Never this artist again in Smart Picks; today's picks of theirs taken off. */
    public static void Block(Snapshot s, string artist)
    {
        var canon = Names.Fold(artist);
        if (canon.Length == 0) throw new JsError("unrecognisable artist name");
        using var c = Db.Open();
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "INSERT OR REPLACE INTO smart_blocks(canon, artist, ts) VALUES($c, $a, $t)";
            cmd.Parameters.AddWithValue("$c", canon);
            cmd.Parameters.AddWithValue("$a", artist);
            cmd.Parameters.AddWithValue("$t", NowMs);
            cmd.ExecuteNonQuery();
        }
        var day = DayKey();
        foreach (var r in ReadPicks(day))
        {
            var al = r.AlbumId is { } id ? s.Find(id) : null;
            if (al == null || !al.ArtistNames.Any(n => n.N == canon)) continue;
            using var del = c.CreateCommand();
            del.CommandText = "DELETE FROM smart_picks WHERE day = $d AND rank = $r";
            del.Parameters.AddWithValue("$d", day);
            del.Parameters.AddWithValue("$r", r.Rank);
            del.ExecuteNonQuery();
        }
    }

    // ------------------------------------------------------------ every ten minutes

    private Timer? timer;

    /* features.js maintenance: today's picks once the hour has come, and the taste graph kept to the day. */
    public void Start()
    {
        timer = new Timer(_ => _ = Maintain(), null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(10));
    }

    private async Task Maintain()
    {
        try
        {
            if (!Ready() || await Library.CurrentCopy() is not { } s) return;
            var (enabled, hour) = SmartSettings();
            if (Js.Truthy(enabled) && DateTime.Now.Hour >= Js.ToNumber(hour)) Kick(s, false);
            if (s.Count > 0) Current();
        }
        catch (Exception e) { log($"[smart] {e.GetType().Name}: {e.Message}"); }
    }

    public void Stop() => timer?.Dispose();
}
