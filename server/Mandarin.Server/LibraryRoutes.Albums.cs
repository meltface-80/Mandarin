// LibraryRoutes.Albums.cs — the Library wall's routes (v0.8.4; out of LibraryRoutes.cs
// in v0.9.2): the counts, the album list and its facets, the view the wall
// filters and sorts, random albums, and an album's page.
using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Library
{
    // ------------------------------------------------------------ the routes

    private static Task<bool> Stats(HttpContext ctx, Snapshot s, LibState st)
    {
        using var c = Db.Open();
        var tracks = (long)Rows(c, "SELECT COUNT(*) AS n FROM tracks")[0][0]!;
        return Send(ctx, new JsonObject { ["albums"] = s.Count, ["tracks"] = tracks, ["building"] = st.Building });
    }

    private static Task<bool> Albums(HttpContext ctx, Snapshot s, LibState st)
    {
        if (st.Building) return NotReady(ctx);
        var view = View(name => Values(ctx, name), s);
        int total = view.Count;
        var offset = (int)Math.Max(0, Math.Min(total, IntOr(Q(ctx, "offset") is { Length: > 0 } o ? o : "0", 0)));
        var count = (int)Math.Max(1, Math.Min(200, IntOr(Q(ctx, "count") is { Length: > 0 } n ? n : "60", 60)));
        return Send(ctx, new JsonObject
        {
            ["albums"] = AlbumList(s, view.Skip(offset).Take(count)),
            ["offset"] = offset, ["total"] = total
        });
    }

    private sealed record FacetDef(string Id, string Label, string? Sort, Func<string, string>? Labels, Func<Album, List<string>> Values);

    private static List<FacetDef> FacetDefs(Snapshot s)
    {
        var now = Now;
        var defs = new List<FacetDef>
        {
            new("genre", "Genre", null, null, al => al.Genres),
            new("decade", "Decade", "numeric-desc", v => v + "s",
                al => al.Year != null ? [((long)Math.Floor(al.Year.Value / 10.0) * 10).ToString(CultureInfo.InvariantCulture)] : []),
        };
        if (s.LabelsOn) defs.Add(new("label", "Record label", null, null, al => s.LabelOf(al) is { } l ? [l] : []));
        defs.Add(new("format", "Format", null, null, al => al.Container != null ? [al.Container] : []));
        defs.Add(new("rate", "Sample rate", "numeric-asc", v => (PInt(v) is long hz ? RateLabel(hz) : null) ?? v,
            al => al.Rate != null ? [al.Rate.Value.ToString(CultureInfo.InvariantCulture)] : []));
        defs.Add(new("bits", "Bit depth", "numeric-asc", v => v + "-bit",
            al => al.Bits != null ? [al.Bits.Value.ToString(CultureInfo.InvariantCulture)] : []));
        defs.Add(new("letter", "Starts with", null, null, al =>
        {
            if (al.SortTitle.Length == 0) return [];
            var c = al.SortTitle[..1].ToUpperInvariant();
            return [c.Any(ch => ch is >= 'A' and <= 'Z') ? c : "#"];
        }));
        defs.Add(new("added", "Added in the last", "none", v => AddedWindows.FirstOrDefault(w => w.Value == v).Label ?? v, al =>
        {
            if (al.Added == null) return [];
            var age = now - al.Added.Value;
            return AddedWindows.Where(w => age <= w.Days * Day).Select(w => w.Value).ToList();
        }));
        return defs;
    }

    /* parseFloat */
    private static double PFloat(string v)
    {
        var m = Regex.Match(Names.JsTrim(v), @"^[+-]?(?:Infinity|[0-9]+\.?[0-9]*(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?)");
        if (!m.Success) return double.NaN;
        if (m.Value.EndsWith("Infinity", StringComparison.Ordinal)) return m.Value[0] == '-' ? double.NegativeInfinity : double.PositiveInfinity;
        return double.Parse(m.Value, NumberStyles.Float, CultureInfo.InvariantCulture);
    }
    // a - b as a comparator gives it: NaN is "equal".
    private static int Diff(double a, double b) => double.IsNaN(a - b) ? 0 : Math.Sign(a - b);

    private static Task<bool> Facets(HttpContext ctx, Snapshot s, LibState st)
    {
        if (st.Building) return NotReady(ctx);
        var defs = FacetDefs(s);
        var counts = defs.Select(_ => (Order: new List<string>(), N: new Dictionary<string, int>())).ToList();
        foreach (var al in s.Albums)
            for (int i = 0; i < defs.Count; i++)
                foreach (var v in defs[i].Values(al))
                {
                    if (counts[i].N.TryGetValue(v, out var n)) counts[i].N[v] = n + 1;
                    else { counts[i].N[v] = 1; counts[i].Order.Add(v); }
                }
        var facets = new JsonArray();
        for (int i = 0; i < defs.Count; i++)
        {
            var def = defs[i];
            var m = counts[i].N;
            var values = counts[i].Order;
            values = def.Sort switch
            {
                "numeric-desc" => Sorted(values, (a, b) => Diff(PFloat(b), PFloat(a))),
                "numeric-asc" => Sorted(values, (a, b) => Diff(PFloat(a), PFloat(b))),
                "none" => AddedWindows.Select(w => w.Value).Where(m.ContainsKey).ToList(),
                _ => Sorted(values, (a, b) => Or(m[b] - m[a], () => Lc(a, b)))
            };
            if (values.Count == 0) continue;
            facets.Add(new JsonObject
            {
                ["id"] = def.Id, ["label"] = def.Label, ["total_values"] = values.Count,
                ["values"] = new JsonArray(values.Take(ChipMax).Select(v => (JsonNode)new JsonObject
                {
                    ["value"] = v, ["label"] = def.Labels != null ? def.Labels(v) : v, ["count"] = m[v]
                }).ToArray())
            });
        }
        int CountWith(string id) { var d = defs.First(x => x.Id == id); return s.Albums.Count(al => d.Values(al).Count > 0); }
        bool hasPlays = false;
        try { using var c = Db.Open(); hasPlays = Rows(c, "SELECT 1 FROM plays LIMIT 1").Count > 0; } catch (SqliteException) { /* no table yet */ }
        return Send(ctx, new JsonObject
        {
            ["total"] = s.Count,
            ["facets"] = facets,
            ["coverage"] = new JsonObject { ["decade"] = CountWith("decade"), ["genre"] = CountWith("genre"), ["format"] = CountWith("format"), ["added"] = CountWith("added") },
            ["sources_derived"] = false,
            ["played"] = new JsonArray(Played.Select(p => (JsonNode)p).ToArray()),
            ["hasPlays"] = hasPlays
        });
    }

    private static bool FacetMatch(List<string> selected, List<string> values)
    {
        bool wanted = false, sawInclude = false;
        foreach (var sel in selected)
        {
            if (sel.StartsWith('!')) { if (values.Contains(sel[1..])) return false; }
            else { sawInclude = true; if (values.Contains(sel)) wanted = true; }
        }
        return !sawInclude || wanted;
    }

    /* library.view(q): the Library wall, filtered and sorted. */
    private static List<Album> View(Func<string, List<string>?> ask, Snapshot s)
    {
        string? Q(HttpContext? _, string name) => ask(name) is { } v ? string.Join(",", v) : null;
        List<string>? Values(HttpContext? _, string name) => ask(name);
        HttpContext? ctx = null;
        var sortQ = Q(ctx, "sort") ?? "";
        var sort = Sorts.Contains(sortQ) ? sortQ : "album";
        var desc = (Q(ctx, "dir") is { Length: > 0 } d ? d : "asc") == "desc";
        var seed = IntOr(Q(ctx, "seed"), 1);
        var played = Q(ctx, "played") is { Length: > 0 } pl ? pl : "any";
        var defs = FacetDefs(s);
        var picked = defs.Select(def => (Def: def, Sel: (Values(ctx, def.Id) ?? []).Where(v => v.Length > 0).ToList())).Where(x => x.Sel.Count > 0).ToList();
        var prefix = Names.Fold(Q(ctx, "prefix") ?? "");
        if (prefix.Length > 40) prefix = prefix[..40];
        var sig = string.Join("|", new[] { sort, desc ? "1" : "0", seed.ToString(CultureInfo.InvariantCulture), played, prefix }
            .Concat(picked.Select(x => x.Def.Id + "=" + string.Join(",", x.Sel.OrderBy(v => v, StringComparer.Ordinal)))));
        var usesPlays = played != "any" || sort == "plays" || sort == "lastplayed";
        if (!usesPlays && prefix.Length == 0) lock (s.ViewCache) if (s.ViewCache.TryGetValue(sig, out var hit)) return hit;

        IEnumerable<Album> list = s.Albums;
        foreach (var (def, sel) in picked) list = list.Where(al => FacetMatch(sel, def.Values(al))).ToList();
        if (prefix.Length > 0)
            list = list.Where(al => al.SortTitle.StartsWith(prefix, StringComparison.Ordinal) || al.NTitle.StartsWith(prefix, StringComparison.Ordinal) ||
                al.NArtist.StartsWith(prefix, StringComparison.Ordinal) || al.ArtistNames.Any(a => a.N.StartsWith(prefix, StringComparison.Ordinal))).ToList();
        using var c = (played != "any" || sort is "plays" or "lastplayed") ? Db.Open() : null;
        if (played != "any")
        {
            var months = PInt(played);
            double since = played is "never" or "played" ? 0
                : Now - (months is long mo && mo > 0 ? mo : 6) * 30.0 * Day;
            var seen = new HashSet<long>(Rows(c!, "SELECT DISTINCT album_id FROM plays WHERE ts >= $1 AND album_id IS NOT NULL", since).Select(r => (long)r[0]!));
            var want = played == "played";
            list = list.Where(al => seen.Contains(al.Id) == want).ToList();
        }
        Dictionary<long, (long N, long T)>? stats = null;
        if (sort is "plays" or "lastplayed")
        {
            stats = [];
            foreach (var r in Rows(c!, "SELECT album_id, COUNT(*) AS n, MAX(ts) AS t FROM plays WHERE album_id IS NOT NULL GROUP BY album_id"))
                stats[(long)r[0]!] = ((long)r[1]!, Convert.ToInt64(r[2] ?? 0L, CultureInfo.InvariantCulture));
        }
        var useed = ToUint32(seed);
        Comparison<Album> cmp = sort switch
        {
            "artist" => (a, b) => Or(Kc(a.SortArtistKey, b.SortArtistKey), () => Or(Math.Sign((a.Year ?? 0) - (b.Year ?? 0)), () => Kc(a.SortTitleKey, b.SortTitleKey))),
            "year" => (a, b) => Or(Math.Sign(string.CompareOrdinal(a.DateKey, b.DateKey)), () => Kc(a.SortTitleKey, b.SortTitleKey)),
            "added" => (a, b) => Or(Math.Sign(a.Added!.Value - b.Added!.Value), () => Kc(a.SortTitleKey, b.SortTitleKey)),
            "plays" => (a, b) => Or(Math.Sign((stats!.TryGetValue(a.Id, out var x) ? x.N : 0) - (stats.TryGetValue(b.Id, out var y) ? y.N : 0)), () => Kc(a.SortTitleKey, b.SortTitleKey)),
            "lastplayed" => (a, b) => Or(Math.Sign((stats!.TryGetValue(a.Id, out var x) ? x.T : 0) - (stats.TryGetValue(b.Id, out var y) ? y.T : 0)), () => Kc(a.SortTitleKey, b.SortTitleKey)),
            "random" => (a, b) => Math.Sign((long)SeededRank(a.NTitle + a.NArtist, useed) - SeededRank(b.NTitle + b.NArtist, useed)),
            _ => (a, b) => Or(Kc(a.SortTitleKey, b.SortTitleKey), () => Kc(a.NArtistKey, b.NArtistKey)),
        };
        List<Album> outList;
        if (sort is "year" or "added")
        {
            var known = new List<Album>();
            var unknown = new List<Album>();
            foreach (var al in list) ((sort == "year" ? al.Year != null : al.Added != null) ? known : unknown).Add(al);
            known = Sorted(known, cmp);
            if (desc) known.Reverse();
            outList = Sorted(unknown, (a, b) => Kc(a.SortTitleKey, b.SortTitleKey));
            outList.InsertRange(0, known);
        }
        else
        {
            outList = Sorted(list, cmp);
            if (desc) outList.Reverse();
        }
        if (!usesPlays && prefix.Length == 0)
            lock (s.ViewCache)
            {
                if (s.ViewCache.Count > 64) s.ViewCache.Remove(s.ViewCache.Keys.First());
                s.ViewCache[sig] = outList;
            }
        return outList;
    }

    private static Task<bool> RandomAlbums(HttpContext ctx, Snapshot s, LibState st)
    {
        if (st.Building) return NotReady(ctx);
        var count = (int)Math.Max(1, Math.Min(96, IntOr(Q(ctx, "count") is { Length: > 0 } cq ? cq : "30", 30)));
        // parseFilter: a genre, tag or decade, and its value.
        var ftype = Names.JsTrim(Q(ctx, "filter_type") ?? "");
        var fvalue = Names.JsTrim(Q(ctx, "filter_value") ?? "");
        bool filtered = ftype.Length > 0 && fvalue.Length > 0 && ftype is "genre" or "tag" or "decade";
        long? seed = Q(ctx, "seed") is { } sq ? PInt(sq) : null;
        List<Album> pool = s.Albums;
        if (filtered)
        {
            var v = Names.Fold(fvalue);
            if (ftype == "genre") pool = s.Albums.Where(al => al.Genres.Any(g => Names.Fold(g) == v)).ToList();
            else if (ftype == "decade")
            {
                var dd = PInt(fvalue);
                pool = dd is long dec ? s.Albums.Where(al => al.Year != null && al.Year >= dec && al.Year < dec + 10).ToList() : [];
            }
            else pool = [];
        }
        int n = Math.Min(count, pool.Count);
        List<Album> albums;
        if (seed is long sd)
        {
            var us = ToUint32(sd);
            albums = Sorted(pool, (a, b) => Math.Sign((long)SeededRank(a.NTitle + a.NArtist, us) - SeededRank(b.NTitle + b.NArtist, us))).Take(n).ToList();
        }
        else
        {
            var chosen = new List<int>();
            var seen = new HashSet<int>();
            while (chosen.Count < n) { var i = Random.Shared.Next(pool.Count); if (seen.Add(i)) chosen.Add(i); }
            albums = chosen.Select(i => pool[i]).ToList();
        }
        return Send(ctx, new JsonObject { ["albums"] = AlbumList(s, albums), ["total"] = pool.Count, ["filtered"] = filtered });
    }

    private sealed record TrackRow(long Id, string Title, string Artist, long? Disc, long? No, double Duration, bool Lossless, long? Bits, long? Rate, string NamesFrom, string? Path = null);

    /* library.tracks(id): in playing order, corrected titles laid over the tagged ones. */
    private static List<TrackRow> Tracks(SqliteConnection c, Snapshot s, Album al)
    {
        const string sql = "SELECT * FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path";
        var col = Columns(c, sql, al.Id);
        object? F(object?[] r, string name) => col.TryGetValue(name, out var i) ? r[i] : null;
        s.TrackEdits.TryGetValue(al.Key, out var edits);
        var rows = Rows(c, sql, al.Id);
        var list = new List<TrackRow>(rows.Count);
        for (int i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var disc = Long(F(r, "disc_no"));
            var no = Long(F(r, "track_no"));
            var title = Convert.ToString(F(r, "title"), CultureInfo.InvariantCulture) ?? "";
            if (edits != null && edits.TryGetValue($"{disc ?? 1}-{(no != null ? no.Value.ToString(CultureInfo.InvariantCulture) : "p" + (i + 1))}", out var t) && t.Length > 0) title = t;
            list.Add(new TrackRow((long)F(r, "id")!, title, Text(F(r, "artist")) ?? "", disc, no,
                F(r, "duration") is { } du ? Convert.ToDouble(du, CultureInfo.InvariantCulture) : 0, Truthy(F(r, "lossless")),
                Long(F(r, "bits")), Long(F(r, "sample_rate")), Text(F(r, "names_from")) ?? "", F(r, "path") as string));
        }
        return list;
    }

    private static long JsRound(double x) => (long)Math.Floor(x + 0.5);
    private static string FmtLen(double sec)
    {
        var n = Math.Max(0, JsRound(double.IsNaN(sec) ? 0 : sec));
        if (n == 0) return "";
        return $"{n / 60}:{(n % 60).ToString(CultureInfo.InvariantCulture).PadLeft(2, '0')}";
    }

    [GeneratedRegex(@"(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))(artist|album)(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))")]
    private static partial Regex NamesFromFolders();

    private static async Task<bool> AlbumPage(HttpContext ctx, Snapshot s, LibState st)
    {
        var al = s.Find(Num(Q(ctx, "offset")));
        if (al == null) return await Send(ctx, new JsonObject { ["error"] = "That album is no longer in the library — rescan to refresh" }, 409);
        // A streamed album's page asks the service too (v0.8.44, ServiceRoutes.cs).
        Tags.JsObj? service = null;
        if (al.Service != null)
        {
            if (CatalogueOf(al.Service) is not { } svc) return false;
            service = await ServiceFields(svc, al, st);
        }
        using var c = Db.Open();
        var tracks = Tracks(c, s, al);
        var discs = tracks.Select(t => t.Disc ?? 1).Distinct().Count();
        var albumKey = Names.ArtistKey(al.Artist);
        var rows = new JsonArray(tracks.Select(t =>
        {
            var disc = discs > 1 ? $"Disc {t.Disc ?? 1}" : "";
            var credit = t.Artist.Length > 0 && Names.ArtistKey(t.Artist) != albumKey ? t.Artist : "";
            string? fmt = null;
            if (t.Lossless && t.Bits != null && t.Rate != null) fmt = $"{t.Bits}/{RateShort(t.Rate.Value)}";
            var row = new JsonObject
            {
                ["title"] = t.Title,
                ["subtitle"] = string.Join(" · ", new[] { credit, disc, FmtLen(t.Duration) }.Where(x => x.Length > 0)),
                ["length"] = JsRound(t.Duration),
                ["track_id"] = t.Id,
                ["quality"] = fmt
            };
            // A set's tracks say which disc, as a number (v0.8.27: Shelf's back of the case heads each disc).
            if (discs > 1) row["disc"] = t.Disc is long d && d != 0 ? d : 1;
            return (JsonNode)row;
        }).ToArray());
        var album = AlbumJson(s, al);
        album["year"] = al.Year;
        album["genres"] = new JsonArray(al.Genres.Select(g => (JsonNode)g).ToArray());
        // Object.assign(library.json(al), { year, genres }, the service's, label): in that order.
        if (service != null) foreach (var k in service.Keys) album[k] = JsonNode.Parse(Tags.Js.Json(service[k])!);
        if (s.LabelOf(al) is { } label) album["label"] = label;
        var boxAlbums = new JsonArray();
        if (al.Box != null)
            foreach (var id in al.Box.Ids)
                if (id != al.Id && s.ById.TryGetValue(id, out var x))
                    boxAlbums.Add(AlbumJson(s, x, new JsonObject { ["disc"] = x.Box?.Disc }));
        return await Send(ctx, new JsonObject
        {
            ["album"] = album,
            ["tracks"] = rows,
            ["actions"] = new JsonArray(
                new JsonObject { ["kind"] = "play_now", ["title"] = "Play Now" },
                new JsonObject { ["kind"] = "queue", ["title"] = "Queue" },
                new JsonObject { ["kind"] = "play_next", ["title"] = "Play Next" },
                new JsonObject { ["kind"] = "shuffle", ["title"] = "Shuffle" },
                new JsonObject { ["kind"] = "radio", ["title"] = "Start Radio" }),
            ["offset"] = al.Id,
            ["artists"] = new JsonArray((al.Compilation ? [al.Artist] : Names.SplitArtists(al.Artist)).Select(a => (JsonNode)a).ToArray()),
            ["library_moved"] = false,
            ["partial"] = false,
            ["names_from_folders"] = !al.Edited && tracks.Any(t => NamesFromFolders().IsMatch(t.NamesFrom)),
            ["box_albums"] = boxAlbums,
            ["declared_tracks"] = tracks.Count
        });
    }
}
