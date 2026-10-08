// ReleaseDays.cs — the day each album came out, where its tags stop at the
// year (v0.8.20): lib/library/dates.js, rule for rule.
//
// The Release date sort orders by the day, and a year alone sorts at the
// start of its year, so the albums known only to the year (or month) are
// looked up on MusicBrainz after each library scan, newest year first,
// twenty to a request. A day is used only from a release group whose title
// and artist match the album's and whose year IS the album's year; what's
// found (or not) is kept in the cache table (ns "mbday", by album key) and a
// miss is asked about again after a month. Each day found is told to the
// Node server, which keeps the library (/internal/library/changed { days }).
//
// The day an album page wants at once (its "now") stays with the Node server,
// with the rest of the album's page.
using System.Globalization;
using System.Text.RegularExpressions;
using System.Text.Json.Nodes;
using Mandarin.Server.Identify;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class ReleaseDays(string? mbBase, string version, Action<string> log)
{
    public const int Batch = 20;
    private const double RetryMissMs = 30.0 * 86400000;

    private readonly string baseUrl = (string.IsNullOrEmpty(mbBase) ? MusicBrainz.DefaultBase : mbBase).TrimEnd('/');
    private readonly string userAgent = $"Mandarin/{version} ( https://github.com/meltface-80/Mandarin )";
    private readonly object gate = new();
    private Task<int>? running;
    private volatile bool stopped;

    /* Whether this server may go on (the Node server has handed the pass over). */
    public Func<bool> Ready { get; init; } = () => true;

    // /\s*[([][^)\]]*[)\]]\s*$/
    [GeneratedRegex(ScanNames.Ws + "*[(\\[][^)\\]]*[)\\]]" + ScanNames.Ws + "*\\z")]
    private static partial Regex Bracketed();
    [GeneratedRegex("[+\\-&|!(){}\\[\\]^\"~*?:\\\\/]")]
    private static partial Regex Special();

    /* META.normalize: String(s || ""), folded as similar.js folds. */
    private static string Normalize(object? s) => Similar.Normalize(Js.Truthy(s) ? Js.Str(s) : "");

    /* "Album (Deluxe Edition)" and "Album [Remastered]" are the same album as "Album". */
    public static string BaseTitle(object? s)
    {
        var plain = Normalize(Bracketed().Replace(Js.Truthy(s) ? Js.Str(s) : "", "", 1));
        return plain.Length > 0 ? plain : Normalize(s);
    }

    private static string MbQuote(string s) => Special().Replace(s, m => "\\" + m.Value);

    /* One clause per album, any of them matching. */
    public static string QueryFor(IEnumerable<(string Title, string Artist)> albums) =>
        string.Join(" OR ", albums.Select(al => $"(releasegroup:\"{MbQuote(al.Title)}\" AND artist:\"{MbQuote(al.Artist)}\")"));

    /*
     * Each album's day, from one search's release groups: the earliest first-
     * release date of a group matching the album, of the album's own year, more
     * precise than what the album has. null where nothing qualifies.
     */
    public static Dictionary<string, string?> MatchDays(IEnumerable<(string Key, string Title, string Artist, string Year, string? Date)> albums, List<object?>? groups)
    {
        var outMap = new Dictionary<string, string?>();
        foreach (var al in albums)
        {
            var t = BaseTitle(al.Title);
            var y = al.Year;
            string? best = null;
            foreach (var g in groups ?? [])
            {
                var rg = g as JsObj ?? new JsObj();
                var d = Js.Truthy(rg["first-release-date"]) ? Js.Str(rg["first-release-date"]) : "";
                if (!d.StartsWith(y, StringComparison.Ordinal) || d.Length <= (!string.IsNullOrEmpty(al.Date) ? al.Date : y).Length) continue;
                if (BaseTitle(rg["title"]) != t) continue;
                var credit = string.Concat((rg["artist-credit"] as List<object?> ?? []).Select(c0 =>
                {
                    var c = c0 as JsObj ?? new JsObj();
                    var name = Js.Truthy(c["name"]) ? c["name"] : c["artist"] is JsObj a && Js.Truthy(a["name"]) ? a["name"] : "";
                    return Js.Str(name) + (Js.Truthy(c["joinphrase"]) ? Js.Str(c["joinphrase"]) : "");
                }));
                if (!Similar.NamesOverlap(credit, al.Artist)) continue;
                if (best == null || string.CompareOrdinal(d, best) < 0 || (Seven(d) == Seven(best) && d.Length > best.Length)) best = d;
            }
            outMap[al.Key] = best;
        }
        return outMap;
    }
    private static string Seven(string s) => s.Length > 7 ? s[..7] : s;

    private static string YearText(Album al) => al.Year!.Value.ToString(CultureInfo.InvariantCulture);

    /* Albums still wanting a day: known to a year, not to the day, not asked about lately. */
    private static List<Album> Wanting(Snapshot s)
    {
        var rows = new Dictionary<string, (string Value, double Ts)>();
        using (var c = Db.Open())
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT key, value, ts FROM cache WHERE ns = 'mbday'";
            using var r = cmd.ExecuteReader();
            while (r.Read()) rows[r.GetString(0)] = (r.GetString(1), r.IsDBNull(2) ? 0 : r.GetDouble(2));
        }
        var now = (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var outList = new List<Album>();
        foreach (var al in s.Albums)
        {
            if (al.Year is not { } year || year == 0 || (al.Date != null && al.Date.Length >= 10)) continue;
            if (rows.TryGetValue(al.Key, out var row))
            {
                object? hit;
                try { hit = JsJson.Parse(row.Value); } catch (Exception) { hit = Undef.V; }
                if (hit is not Undef)
                {
                    if (hit is JsObj o && Js.Truthy(o["date"])) continue;                  // found before (and of another year's)
                    if (now - row.Ts <= RetryMissMs) continue;                               // missed lately
                }
            }
            outList.Add(al);
        }
        return Library.Sorted(outList, (a, b) => Lookups.Sgn((double)(b.Year!.Value - a.Year!.Value)));
    }

    /* Ask about a batch of albums; keeps what's found, and tells the Node server. → how many found. */
    private async Task<int> Lookup(List<Album> albums)
    {
        var url = baseUrl + "/release-group/?query=" + Lookups.Encode(QueryFor(albums.Select(a => (a.Title, a.Artist)))) + "&fmt=json&limit=100";
        if (baseUrl == MusicBrainz.DefaultBase) await Lookups.MbWait();
        var j = await Lookups.Json(url, [("User-Agent", userAgent)], 10000);
        var days = MatchDays(albums.Select(a => (a.Key, a.Title, a.Artist, YearText(a), a.Date)), (j as JsObj)?["release-groups"] as List<object?>);
        var found = new JsonArray();
        var now = (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        using (var c = Db.Open())
        {
            using var tx = c.BeginTransaction();
            foreach (var al in albums)
            {
                var day = days.TryGetValue(al.Key, out var d) && !string.IsNullOrEmpty(d) ? d : null;
                var v = new JsObj();
                v["date"] = day;
                using var cmd = c.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = "INSERT INTO cache(ns, key, value, ts) VALUES('mbday', $k, $v, $t) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts";
                cmd.Parameters.AddWithValue("$k", al.Key);
                cmd.Parameters.AddWithValue("$v", Js.Json(v));
                cmd.Parameters.AddWithValue("$t", now);
                cmd.ExecuteNonQuery();
                if (day != null) found.Add(new JsonArray(al.Key, day));
            }
            tx.Commit();
        }
        if (found.Count > 0) await Library.Tell(new JsonObject { ["days"] = found });
        return found.Count;
    }

    /* The pass: every album wanting a day, a batch at a time. One at a time; a second asked for joins the first. */
    public Task<int> Run()
    {
        lock (gate)
        {
            if (running != null) return running;
            var done = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
            running = done.Task;
            _ = Task.Run(async () =>
            {
                var found = 0;
                try { found = await Pass(); }
                catch (Exception e) { log($"[dates] {e.GetType().Name}: {e.Message}"); }
                finally
                {
                    lock (gate) running = null;
                    done.SetResult(found);
                }
            });
            return running;
        }
    }

    private async Task<int> Pass()
    {
        if (!Ready() || await Library.CurrentCopy() is not { } s) return 0;
        var list = Wanting(s);
        if (list.Count == 0) return 0;
        int found = 0, failures = 0;
        for (var i = 0; i < list.Count && !stopped && Ready(); i += Batch)
        {
            try
            {
                found += await Lookup(list.GetRange(i, Math.Min(Batch, list.Count - i)));
                failures = 0;
            }
            catch (Exception e)
            {
                // MusicBrainz down or unreachable: try again after the next scan.
                if (++failures >= 3) { log($"[dates] MusicBrainz isn't answering ({e.Message}); trying again later"); break; }
            }
        }
        if (found > 0) log($"[dates] found the release day of {found} album(s) on MusicBrainz");
        return found;
    }

    public void Stop() => stopped = true;
}
