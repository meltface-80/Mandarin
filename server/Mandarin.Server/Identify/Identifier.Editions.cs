// Identifier.Editions.cs — the steps item 414 added to the scan, each joining the ones before it:
//   - the album tidied first: a compilation whose tag names one of its artists is looked up as Various Artists, so
//     that artist is never searched for (the disc folders of one album are one album already, Scan/Scanner.Discs.cs);
//   - its tracks' exact lengths asked of MusicBrainz as a CD's table of contents (DiscToc.cs), after what the files
//     carry and before the search by name — for an album that could be a CD rip;
//   - once a step has found the record, the pressing of it that fits the copy best chosen from its release group (the
//     track count and lengths, then the barcode and catalogue number, then the country and the year), and the other
//     pressings near enough kept with the verdict, for the page's one-tap switch.
using Microsoft.Data.Sqlite;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Identifier
{
    private const string Various = "Various Artists";
    private const int EditionsKept = 6;           // the other pressings kept with a verdict, for the page's switch
    private const int EditionsMax = 4;            // pressings of the copy's own count fetched once found: a few seconds an album, not WidenMax's

    private static readonly string[] Joins = [" feat", " ft.", " featuring", " & ", " and ", " x ", " vs", " with ", ", ", " / ", ";"];

    /* "Artist A feat. B" → "artist a": the act a track is first by. */
    private static string Lead(object? artist)
    {
        var a = Js.Lower(Js.Truthy(artist) ? Js.Str(artist) : "");
        foreach (var j in Joins) { var i = a.IndexOf(j, StringComparison.Ordinal); if (i > 0) a = a[..i]; }
        return ScanNames.Fold(a);
    }

    /*
     * A compilation filed under one of its acts (each track's album-artist tag its own, the first one's taken): three
     * acts or more lead its tracks and none leads more than half of them.
     */
    private static bool Compilation(SqliteConnection c, Album al)
    {
        var leads = Rows(c, "SELECT artist FROM tracks WHERE album_id = $1", (double)al.Id).Select(r => Lead(r[0])).Where(a => a.Length > 0).ToList();
        if (leads.Count < 3) return false;
        var acts = leads.GroupBy(a => a).Select(g => g.Count()).ToList();
        return acts.Count >= 3 && acts.Max() * 2 <= leads.Count;
    }

    /*
     * The tracks' lengths asked as a CD's table of contents, disc by disc (an album that could be a CD rip: Input's
     * "tocs"), the releases with a disc near it scored as any found by what the files carry. musicbrainz.org only: the
     * pack holds no tables of contents. Not asking (the pack alone, MusicBrainz resting) is no answer.
     */
    private static async Task<(List<JsObj> Cands, Resolved? Found)> DiscResolve(JsObj input, IReleases mb, HashSet<string> have, Func<List<JsObj>, string, Resolved?> settle)
    {
        var online = mb as MusicBrainz ?? (mb as PackFirst)?.Mb;
        var found = new List<JsObj>();
        if (online == null) return (found, null);
        foreach (var toc in L(input["tocs"]).OfType<string>())
        {
            List<JsObj> rels;
            try { rels = await online.ByToc(toc); } catch (Exception) { rels = []; }
            foreach (var r in ByNearest(rels, input, score: false))
                if (found.Count < FetchMax && have.Add(Js.Str(r["mbid"]))) found.Add(r);
            var r1 = settle(found, "disc-lengths");
            if (r1 != null) return (found, r1);
        }
        return (found, null);
    }

    /*
     * The other pressings of the record found (the widening of v0.6.x, and item 414's edition): when the copy's track
     * count is off, the group's pressings nearest it in count; else those with its count. Fetched (none twice), scored
     * with the rest, and the nearest kept — between equals, the one the files' barcode, catalogue number, country or
     * year names. Asked only once a step has found the record or its count is off; a release the files name by its id
     * is theirs to keep.
     */
    private async Task<Resolved> Pressings(JsObj input, Resolved r)
    {
        var best = r.Verdict.Best;
        if (best == null || !Js.Truthy(best.Candidate["group_mbid"]) || r.By == "musicbrainz-id") return r;
        var off = Js.Truthy(best.Parts["missing_tracks"]) || Js.Truthy(best.Parts["extra_tracks"]);
        if (!off && best.Distance > Score.Propose) return r;
        List<JsObj> group;
        try { group = await Mb.GroupReleases(best.Candidate["group_mbid"]); } catch (Exception) { group = []; }
        var n = TracksIn(input);
        var have = new HashSet<string>(r.Cands.Select(c => Js.Str(c["mbid"])));
        double Count(JsObj x) => Js.Truthy(x["track_count"]) ? Js.ToNumber(x["track_count"]) : 0;
        var others = group.Where(x => !have.Contains(Js.Str(x["mbid"])) && (off ? Math.Abs(Count(x) - n) <= 1 : Count(x) == n)).ToList();
        var cands = r.Cands;
        var verdict = r.Verdict;
        if (others.Count > 0)
        {
            cands = [.. cands, .. await FetchBest(others, input, have, off ? WidenMax : EditionsMax, Mb)];
            verdict = Score.Decide(input, cands);
        }
        verdict = WithEditions(Preferred(input, verdict));
        if (r.By != null && verdict.Best != null && verdict.Best.Distance <= Score.Propose) verdict = Applied(verdict, r.By);
        return new Resolved(cands, verdict, r.By);
    }

    /* Between pressings as near as the best: the one the files' barcode, catalogue number, country or year names. */
    private static Score.Verdict Preferred(JsObj input, Score.Verdict v)
    {
        var best = v.Best;
        if (best == null) return v;
        var ids = input["ids"] as JsObj ?? new JsObj();
        string Digits(object? x) => new([.. (Js.Truthy(x) ? Js.Str(x) : "").Where(char.IsAsciiDigit)]);
        string Fold(object? x) => ScanNames.Fold(Js.Truthy(x) ? Js.Str(x) : "").Replace(" ", "", StringComparison.Ordinal);
        bool Same(string a, string b) => a.Length > 0 && a == b;
        int Rank(Score.Scored s)
        {
            var c = s.Candidate;
            var rank = 0;
            if (Same(Digits(ids["barcode"]).TrimStart('0'), Digits(c["barcode"]).TrimStart('0'))) rank += 8;
            if (Same(Fold(ids["catno"]), Fold(c["catno"]))) rank += 4;
            if (Same(Fold(ids["country"]), Fold(c["country"]))) rank += 2;
            if (Js.Truthy(input["year"]) && Js.StrictEq(c["release_year"], input["year"])) rank += 1;
            return rank;
        }
        var equals = v.ScoredList.Where(s => s.Distance - best.Distance < 1e-9).ToList();
        var top = equals.OrderByDescending(Rank).First();   // a stable sort: Decide's order between equal ranks
        if (ReferenceEquals(top, best)) return v;
        return v with { Best = top, ScoredList = [top, .. v.ScoredList.Where(s => !ReferenceEquals(s, top))] };
    }

    /* The best with the record's other pressings near enough beside it (its "editions"), nearest first. */
    private static Score.Verdict WithEditions(Score.Verdict v)
    {
        var best = v.Best;
        if (best == null || !Js.Truthy(best.Candidate["group_mbid"])) return v;
        var others = v.ScoredList.Where(s => !ReferenceEquals(s, best) && s.Distance <= Score.Propose
                && Js.StrictEq(s.Candidate["group_mbid"], best.Candidate["group_mbid"]) && !Js.StrictEq(s.Candidate["mbid"], best.Candidate["mbid"]))
            .Take(EditionsKept).Select(s => (object?)EditionOf(s.Candidate, s.Distance)).ToList();
        if (others.Count == 0) return v;
        var kept = best with { Candidate = With(best.Candidate, "editions", others) };
        return v with { Best = kept, ScoredList = [.. v.ScoredList.Select(s => ReferenceEquals(s, best) ? kept : s)] };
    }

    /* A pressing as the page offers it: what tells it apart, and how alike it is. */
    private static JsObj EditionOf(JsObj c, double distance)
    {
        var o = new JsObj();
        foreach (var k in new[] { "mbid", "release_title", "edition", "country", "release_year", "track_count", "barcode", "catno" })
            o[k] = Js.IsUndef(c[k]) || !Js.Truthy(c[k]) ? null : c[k];
        o["distance"] = distance;
        o["similarity"] = Js.Round((1 - distance) * 100);
        return o;
    }

    /*
     * The pressings to switch between once another is chosen (how "edition"): the one that was applied takes the
     * chosen one's place among them.
     */
    private static List<object?> Switched(MatchRow? prev, object? chosen)
    {
        if (prev == null || JsJson.Parse(Js.Truthy(prev.Candidate) ? Js.Str(prev.Candidate) : "null") is not JsObj was) return [];
        var list = L(was["editions"]).OfType<JsObj>().Where(e => !Js.StrictEq(e["mbid"], chosen)).Select(e => (object?)e).ToList();
        if (!Js.StrictEq(was["mbid"], chosen)) list.Insert(0, EditionOf(was, prev.Distance is double d ? d : 0));
        return list;
    }
}
