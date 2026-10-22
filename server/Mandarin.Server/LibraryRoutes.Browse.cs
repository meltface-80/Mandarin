// LibraryRoutes.Browse.cs — finding albums (v0.8.4; out of LibraryRoutes.cs in
// v0.9.2): search, artists and the albums they're on, genres and decades,
// hearts and Listen later.
using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class Library
{
    // ----------------------------------------------------------------- search

    private static int ConsecutivePrefixStart(string[] tokens, string[] q)
    {
        int last = tokens.Length - q.Length;
        for (int i = 0; i <= last; i++)
        {
            bool ok = true;
            for (int k = 0; k < q.Length; k++) if (!tokens[i + k].StartsWith(q[k], StringComparison.Ordinal)) { ok = false; break; }
            if (ok) return i;
        }
        return -1;
    }
    private static bool AllTokensPrefixSomewhere(string[] tokens, string[] q)
    {
        var used = new bool[tokens.Length];
        foreach (var qt in q)
        {
            bool found = false;
            for (int i = 0; i < tokens.Length; i++)
                if (!used[i] && tokens[i].StartsWith(qt, StringComparison.Ordinal)) { used[i] = true; found = true; break; }
            if (!found) return false;
        }
        return true;
    }
    private static bool IsSubsequence(string q, string s)
    {
        int i = 0;
        for (int j = 0; j < s.Length && i < q.Length; j++) if (s[j] == q[i]) i++;
        return i == q.Length;
    }

    private static int ScoreAlbum(Album al, string q, string[] qt, string qj, bool single)
    {
        int s = 0;
        if (al.NTitle == q) return 1000;
        if (al.NTitle.StartsWith(q, StringComparison.Ordinal)) s = Math.Max(s, 920 - Math.Min(al.NTitle.Length - q.Length, 60));
        {
            var start = ConsecutivePrefixStart(al.TTitle, qt);
            if (start == 0) s = Math.Max(s, 900 - Math.Min(al.TTitle.Length, 40));
            else if (start > 0 && !single) s = Math.Max(s, 820 - start * 4);
        }
        if (al.JTitle.StartsWith(qj, StringComparison.Ordinal)) s = Math.Max(s, 870 - Math.Min(al.JTitle.Length - qj.Length, 60));
        if (!single)
        {
            if (s < 760 && qt.Length > 1 && AllTokensPrefixSomewhere(al.TTitle, qt)) s = Math.Max(s, 760);
            if (s < 650 && al.NTitle.Contains(q, StringComparison.Ordinal)) s = Math.Max(s, 650 - Math.Min(al.NTitle.IndexOf(q, StringComparison.Ordinal), 40));
            if (s < 700 && qt.Length > 1 && AllTokensPrefixSomewhere([.. al.TTitle, .. al.TArtist], qt)) s = Math.Max(s, 700);
        }
        if (al.NArtist.Length > 0)
        {
            if (al.NArtist == q) s = Math.Max(s, 770);
            if (al.NArtist.StartsWith(q, StringComparison.Ordinal)) s = Math.Max(s, 740 - Math.Min(al.NArtist.Length - q.Length, 60));
            {
                var start = ConsecutivePrefixStart(al.TArtist, qt);
                if (start == 0) s = Math.Max(s, 720 - Math.Min(al.TArtist.Length, 40));
                else if (start > 0 && !single) s = Math.Max(s, 660 - start * 4);
            }
            if (al.JArtist.StartsWith(qj, StringComparison.Ordinal)) s = Math.Max(s, 700 - Math.Min(al.JArtist.Length - qj.Length, 60));
            if (!single)
            {
                if (s < 600 && qt.Length > 1 && AllTokensPrefixSomewhere(al.TArtist, qt)) s = Math.Max(s, 600);
                if (s < 520 && al.NArtist.Contains(q, StringComparison.Ordinal)) s = Math.Max(s, 520 - Math.Min(al.NArtist.IndexOf(q, StringComparison.Ordinal), 40));
            }
        }
        if (s == 0 && !single && qj.Length >= 4)
        {
            if (IsSubsequence(qj, al.JTitle)) s = 300;
            else if (IsSubsequence(qj, al.JArtist)) s = 260;
        }
        return s;
    }

    /* library.search(query, limit): the albums whose names hold the words, best first. */
    private static List<(Album Al, int Score)> SearchHits(Snapshot s, string raw, int limit)
    {
        var q = Names.Fold(raw);
        if (q.Length == 0) return [];
        var qt = q.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var qj = q.Replace(" ", "");
        var single = qj.Length <= 1;
        var hits = new List<(Album Al, int Score)>();
        foreach (var al in s.Albums) { var sc = ScoreAlbum(al, q, qt, qj, single); if (sc > 0) hits.Add((al, sc)); }
        hits = Sorted(hits, (a, b) => Or(b.Score - a.Score, () => Or(Lc(a.Al.NTitle, b.Al.NTitle), () => Kc(a.Al.NArtistKey, b.Al.NArtistKey))));
        return hits.Take(limit).ToList();
    }

    private static Task<bool> Search(HttpContext ctx, Snapshot s, LibState st)
    {
        var raw = Q(ctx, "q") ?? "";
        var limit = (int)Math.Max(1, Math.Min(100, IntOr(Q(ctx, "limit") is { Length: > 0 } l ? l : "60", 60)));
        if (Names.JsTrim(raw).Length == 0)
            return Send(ctx, new JsonObject { ["query"] = raw, ["results"] = new JsonArray(), ["artists"] = new JsonArray(), ["labels"] = new JsonArray(), ["indexed"] = s.Count });
        if (st.Building)
            return Send(ctx, new JsonObject { ["query"] = raw, ["results"] = new JsonArray(), ["artists"] = new JsonArray(), ["labels"] = new JsonArray(), ["building"] = true, ["progress"] = st.Progress?.DeepClone() });

        var q = Names.Fold(raw);
        var results = new JsonArray();
        foreach (var h in SearchHits(s, raw, limit)) results.Add(AlbumJson(s, h.Al, new JsonObject { ["score"] = h.Score }));

        // Labels (only while they're on) and artists whose names hold the words.
        var labels = new JsonArray();
        if (s.LabelsOn && q.Length > 0)
        {
            var qn = q.Replace(" ", "");
            var found = new List<(string Display, int Count, string N)>();
            foreach (var g in s.LabelGroups.Values)
            {
                var n = Names.Fold(g.Title);
                var merged = g.MergedFrom.Any(x => Names.Fold(x.Display).Contains(q, StringComparison.Ordinal));
                if (n.Contains(q, StringComparison.Ordinal) || g.Key.Contains(qn, StringComparison.Ordinal) || merged) found.Add((g.Title, g.Albums.Count, n));
            }
            foreach (var x in Sorted(found, (a, b) => Or((a.N.StartsWith(q, StringComparison.Ordinal) ? 0 : 1) - (b.N.StartsWith(q, StringComparison.Ordinal) ? 0 : 1), () => b.Count - a.Count)).Take(10))
                labels.Add(new JsonObject { ["display"] = x.Display, ["albumCount"] = x.Count, ["logo_url"] = null });
        }
        var artists = new JsonArray();
        if (q.Length > 0)
        {
            var seen = new Dictionary<string, (string Name, int Count)>();
            var order = new List<string>();
            foreach (var al in s.Albums)
                foreach (var (name, n) in al.ArtistNames)
                {
                    if (!n.Contains(q, StringComparison.Ordinal)) continue;
                    if (seen.TryGetValue(n, out var e)) seen[n] = (e.Name, e.Count + 1);
                    else { seen[n] = (name, 1); order.Add(n); }
                }
            foreach (var n in Sorted(order, (a, b) => Or((a.StartsWith(q, StringComparison.Ordinal) ? 0 : 1) - (b.StartsWith(q, StringComparison.Ordinal) ? 0 : 1), () => seen[b].Count - seen[a].Count)).Take(8))
                artists.Add(new JsonObject { ["name"] = seen[n].Name, ["n"] = n, ["count"] = seen[n].Count, ["albumCount"] = seen[n].Count });
        }
        return Send(ctx, new JsonObject { ["query"] = raw, ["count"] = results.Count, ["indexed"] = s.Count, ["results"] = results, ["labels"] = labels, ["artists"] = artists });
    }

    // ---------------------------------------------------------------- artists

    private static Task<bool> Artists(HttpContext ctx, Snapshot s, LibState st)
    {
        var sort = Q(ctx, "sort") is { Length: > 0 } so ? so : "az";
        var seed = ToUint32(IntOr(Q(ctx, "seed"), 1));
        var m = new Dictionary<string, (string Name, int Count, string Image, string SortName)>();
        var order = new List<string>();
        foreach (var al in s.Albums)
        {
            if (al.Compilation) continue;
            foreach (var (name, n) in al.ArtistNames)
            {
                if (m.TryGetValue(n, out var e)) m[n] = (e.Name, e.Count + 1, e.Image, e.SortName);
                else { m[n] = (name, 1, al.ImageKey, Names.SortName(name)); order.Add(n); }
            }
        }
        // Found by a part of the name (the Artists wall's find, bug list item 130): accents, case and punctuation aside.
        var find = Names.Fold(Q(ctx, "q") ?? "");
        if (find.Length > 0) order = order.Where(n => n.Contains(find, StringComparison.Ordinal)).ToList();
        var keys = sort == "random" ? null : order.ToDictionary(n => n, n => SortKey(m[n].SortName));
        var list = sort switch
        {
            "random" => Sorted(order, (a, b) => Math.Sign((long)SeededRank(a, seed) - SeededRank(b, seed))),
            "albums" => Sorted(order, (a, b) => Or(m[b].Count - m[a].Count, () => Kc(keys![a], keys[b]))),
            _ => Sorted(order, (a, b) => Kc(keys![a], keys[b])),
        };
        var offset = (int)Math.Min(int.MaxValue, Math.Max(0, IntOr(Q(ctx, "offset"), 0)));
        var limit = (int)Math.Max(1, Math.Min(500, IntOr(Q(ctx, "limit"), 120)));
        // Each act's own picture where one has been found (bug list item 129), beside its first album's cover; none said otherwise.
        var photos = Credits.CreditStore.Photos();
        JsonNode Act(string n)
        {
            var o = new JsonObject { ["name"] = m[n].Name, ["albumCount"] = m[n].Count, ["image_key"] = m[n].Image };
            if (Credits.CreditRules.PhotoKey(photos.GetValueOrDefault(Names.ArtistKey(m[n].Name))) is { } photo) o["photo_key"] = photo;
            return o;
        }
        return Send(ctx, new JsonObject
        {
            ["artists"] = new JsonArray(list.Skip(offset).Take(limit).Select(Act).ToArray()),
            ["offset"] = offset, ["total"] = list.Count
        });
    }

    [GeneratedRegex(@"^the\s+", RegexOptions.IgnoreCase)] private static partial Regex ThePrefix();

    private static Task<bool> ArtistAlbums(HttpContext ctx, Snapshot s, LibState st)
    {
        var artist = Names.JsTrim(Q(ctx, "artist") ?? "");
        if (artist.Length == 0) return Send(ctx, new JsonObject { ["error"] = "artist required" }, 400);
        var (primary, featured) = ArtistAlbumsOf(s, artist);
        return Send(ctx, new JsonObject { ["artist"] = artist, ["primary"] = AlbumList(s, primary), ["featured"] = AlbumList(s, featured) });
    }

    /* library.artistAlbums(name): the albums credited to the act first, then those it is on (Last.fm's tiles too, LastfmRoutes.cs). */
    private static (List<Album> Primary, List<Album> Featured) ArtistAlbumsOf(Snapshot s, string artist)
    {
        var q = Names.ArtistKey(artist);
        var primary = new List<Album>();
        var featured = new List<Album>();
        if (q.Length > 0)
        {
            foreach (var al in s.Albums)
            {
                var whole = Names.ArtistKey(al.Artist);
                var names = al.ArtistNames.Select(x => Names.ArtistKey(x.Name)).ToList();
                if (whole != q && !names.Contains(q)) continue;
                if (whole == q || names[0] == q) primary.Add(al); else featured.Add(al);
            }
            // A track credit on an album credited to someone else.
            using var c = Db.Open();
            foreach (var r in Rows(c, "SELECT DISTINCT album_id FROM tracks WHERE lower(artist) IN (lower($1), lower($2), lower($3)) LIMIT 200",
                         artist, ThePrefix().Replace(artist, "", 1), TheStart().IsMatch(artist) ? artist : "The " + artist))
                if (s.ById.TryGetValue((long)r[0]!, out var al) && !primary.Contains(al) && !featured.Contains(al)) featured.Add(al);
            int ByYear(Album a, Album b) => Or(Math.Sign((a.Year ?? 9999) - (b.Year ?? 9999)), () => Kc(a.SortTitleKey, b.SortTitleKey));
            primary = Sorted(primary, ByYear);
            featured = Sorted(featured, ByYear);
        }
        return (primary, featured);
    }

    // ------------------------------------------------------- genres, decades

    private static List<(string Title, int Count)> GenreCounts(Snapshot s)
    {
        var m = new Dictionary<string, int>();
        var order = new List<string>();
        foreach (var al in s.Albums)
            foreach (var g in al.Genres)
                if (m.TryGetValue(g, out var n)) m[g] = n + 1; else { m[g] = 1; order.Add(g); }
        return Sorted(order, (a, b) => m[b] - m[a]).Select(g => (g, m[g])).ToList();
    }
    private static string AlbumsWord(int n) => n.ToString("N0", CultureInfo.InvariantCulture) + (n == 1 ? " album" : " albums");

    private static Task<bool> GenresRoute(HttpContext ctx, Snapshot s, LibState st) =>
        Send(ctx, new JsonObject { ["genres"] = new JsonArray(GenreCounts(s).Select(g => (JsonNode)new JsonObject { ["title"] = g.Title, ["subtitle"] = AlbumsWord(g.Count) }).ToArray()) });

    private static Task<bool> DecadesRoute(HttpContext ctx, Snapshot s, LibState st)
    {
        if (st.Building) return NotReady(ctx);
        var m = new Dictionary<long, int>();
        var order = new List<long>();
        foreach (var al in s.Albums)
        {
            if (al.Year == null) continue;
            var d = (long)Math.Floor(al.Year.Value / 10.0) * 10;
            if (m.TryGetValue(d, out var n)) m[d] = n + 1; else { m[d] = 1; order.Add(d); }
        }
        return Send(ctx, new JsonObject
        {
            ["decades"] = new JsonArray(Sorted(order, (a, b) => Math.Sign(b - a)).Select(d => (JsonNode)new JsonObject { ["title"] = d + "s", ["subtitle"] = AlbumsWord(m[d]) }).ToArray())
        });
    }

    [GeneratedRegex(@"(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))pop(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))", RegexOptions.IgnoreCase)]
    private static partial Regex PopWord();
    private const string WB = @"(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))";
    [GeneratedRegex(WB + @"(soft\s*rock|folk[\s-]?rock|country[\s-]?rock|adult\s*contemporary|easy\s*listening|singer[\s/-]*songwriter|new\s*age|lounge|smooth\s*jazz|yacht\s*rock)" + WB, RegexOptions.IgnoreCase)]
    private static partial Regex Soft();
    [GeneratedRegex(WB + @"(metal|metalcore|thrash|sludge|doom|hard\s*rock|album\s*rock|classic\s*rock|blues[\s-]?rock|southern\s*rock|stoner|post[\s-]?rock|prog|art\s*rock|krautrock|psychedel|britpop|grunge|punk|hardcore|emo|shoegaze|indie|alternative|garage|rockabilly|surf|glam|goth|industrial|ska|rock)" + WB, RegexOptions.IgnoreCase)]
    private static partial Regex Hard();
    [GeneratedRegex(WB + @"(pop|dance|disco|synth|new\s*wave|electropop|r&b|rhythm\s*&\s*blues|soul|motown|funk)" + WB, RegexOptions.IgnoreCase)]
    private static partial Regex PopFamily();

    /* Home's "Browse by genre": Pop, and Rock/Metal. */
    private static Task<bool> GenreGroups(HttpContext ctx, Snapshot s, LibState st)
    {
        var pop = new JsonArray();
        var rock = new JsonArray();
        foreach (var (title, count) in GenreCounts(s))
        {
            JsonNode entry = new JsonObject { ["title"] = title, ["count"] = count };
            if (PopWord().IsMatch(title)) pop.Add(entry);
            else if (Soft().IsMatch(title)) continue;
            else if (Hard().IsMatch(title)) rock.Add(entry);
            else if (PopFamily().IsMatch(title)) pop.Add(entry);
        }
        return Send(ctx, new JsonObject { ["parent"] = null, ["pop"] = pop, ["rockmetal"] = rock, ["flat"] = true });
    }

    // ------------------------------------------------- hearts, Listen later

    private static Task<bool> Favourites(HttpContext ctx, Snapshot s, LibState st) => Marked(ctx, s, s.Marks.Fav);
    private static Task<bool> ListenLater(HttpContext ctx, Snapshot s, LibState st) => Marked(ctx, s, s.Marks.Later);
    /* Newest first. */
    private static Task<bool> Marked(HttpContext ctx, Snapshot s, Dictionary<string, long> keys) =>
        Send(ctx, new JsonObject { ["albums"] = AlbumList(s, Sorted(s.Albums.Where(al => keys.ContainsKey(al.Key)), (a, b) => Math.Sign(keys[b.Key] - keys[a.Key]))) });
}
