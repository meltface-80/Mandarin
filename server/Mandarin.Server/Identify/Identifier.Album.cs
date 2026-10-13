// Identifier.Album.cs — one album, as the scan sees it (v0.8.19; out of
// Identifier.cs in v0.9.2): its tracks, what its files and folders say it is,
// the search and the releases fetched in full.
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Identifier
{
    // ------------------------------------------------------------ one album

    private sealed record TrackRow(object? Id, string? Path, object? Title, object? EditTitle, object? Duration, object? Disc, object? No);

    /* library.trackPos: "disc-number", or "disc-p<index>" for a file with no track number. */
    public static string TrackPos(object? disc, object? no, int i) =>
        $"{(Js.Truthy(disc) ? Js.Str(disc) : "1")}-{(Js.Truthy(no) ? Js.Str(no) : "p" + (i + 1))}";

    /* An album's tracks in playing order, with the corrected titles laid over them (library.tracks). */
    private static List<TrackRow> Tracks(SqliteConnection c, Album al)
    {
        var edits = new Dictionary<string, object?>();
        foreach (var r in Rows(c, "SELECT pos, title FROM track_edits WHERE key = $1 AND title IS NOT NULL", al.Key)) edits[Js.Str(r[0])] = r[1];
        var rows = Rows(c, "SELECT id, path, title, duration, disc_no, track_no FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path", (double)al.Id);
        var list = new List<TrackRow>(rows.Count);
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            edits.TryGetValue(TrackPos(r[4], r[5], i), out var edit);
            list.Add(new TrackRow(r[0], r[1] as string, r[2], Js.Truthy(edit) ? edit : null, r[3], r[4], r[5]));
        }
        return list;
    }

    /* What the scorer sees of an album: the names its files carry and each track's title and length. */
    private JsObj Input(SqliteConnection c, Album al)
    {
        var rows = Tracks(c, al);
        var tracks = new List<object?>();
        foreach (var t in rows)
        {
            // t.scanned_title || t.title || "": the tagged title, or what's laid over an untitled one.
            var title = Js.Truthy(t.Title) ? t.Title : t.EditTitle ?? t.Title;
            var o = new JsObj();
            o["title"] = Score.Tidy(Js.Truthy(title) ? title : "");
            o["length"] = Js.Truthy(t.Duration) ? t.Duration : null;
            tracks.Add(o);
        }
        var input = new JsObj();
        input["title"] = Score.Tidy(al.ScannedTitle.Length > 0 ? al.ScannedTitle : al.Title);
        input["artist"] = Score.Tidy(al.ScannedArtist.Length > 0 ? al.ScannedArtist : al.Artist);
        input["year"] = (al.ScannedYear ?? al.Year) is long y ? (double)y : null;
        input["tracks"] = tracks;
        input["ids"] = IdsOf(c, al);
        input["context"] = ContextOf(c, al, rows);
        return input;
    }

    [GeneratedRegex("[cC][oO][mM][mM][eE][nN][tT]|[vV][eE][rR][sS][iI][oO][nN]|[sS][uU][bB][tT][iI][tT][lL][eE]|[dD][eE][sS][cC][rR][iI][pP][tT][iI][oO][nN]|[rR][eE][mM][iI][xX]|[mM][iI][xX][eE][rR]|[eE][dD][iI][tT][iI][oO][nN]")]
    private static partial Regex EditionTag();

    /* What else says which version of a record this is: its folders, its box set, and the tags that name an edition. */
    private static string ContextOf(SqliteConnection c, Album al, List<TrackRow> tracks)
    {
        var bits = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        void Add(string s) { if (seen.Add(s)) bits.Add(s); }
        foreach (var t in tracks)
        {
            if (string.IsNullOrEmpty(t.Path)) continue;
            Add(NodePath.Basename(NodePath.Dirname(t.Path)));
            Add(NodePath.Basename(NodePath.Dirname(NodePath.Dirname(t.Path))));
        }
        if (al.Box != null) Add(al.Box.Name);
        try
        {
            foreach (var r in Rows(c, "SELECT g.tags FROM track_tags g JOIN tracks t ON t.id = g.track_id WHERE t.album_id = $1 LIMIT 40", (double)al.Id))
            {
                if (JsJson.Parse(Js.Truthy(r[0]) ? Js.Str(r[0]) : "{}") is not JsObj tags) continue;
                foreach (var k in tags.Keys)
                {
                    if (!EditionTag().IsMatch(k)) continue;
                    var v = tags[k];
                    foreach (var x in v is List<object?> l ? l : [v])
                    {
                        var s = Js.Str(x);
                        Add(s.Length > 200 ? s[..200] : s);
                    }
                }
            }
        }
        catch (Exception) { /* tags are a help, not a need */ }
        return string.Join(" · ", bits);
    }

    /* What the files themselves say the release is: its release id, barcode, catalogue number and label, and a few ISRCs. */
    private static JsObj IdsOf(SqliteConnection c, Album al)
    {
        var o = new JsObj();
        try
        {
            var r = Rows(c, "SELECT barcode, catno, mb_album, label FROM albums WHERE id = $1", (double)al.Id).FirstOrDefault() ?? new object?[4];
            var isrcs = Rows(c, "SELECT DISTINCT isrc FROM tracks WHERE album_id = $1 AND isrc IS NOT NULL ORDER BY COALESCE(disc_no, 1), COALESCE(track_no, 9999) LIMIT 3", (double)al.Id)
                .Select(x => x[0]).ToList();
            o["mbid"] = Js.Truthy(r[2]) ? r[2] : null;
            o["barcode"] = Js.Truthy(r[0]) ? r[0] : null;
            o["catno"] = Js.Truthy(r[1]) ? r[1] : null;
            o["label"] = Js.Truthy(r[3]) ? r[3] : null;
            o["isrcs"] = isrcs;
        }
        catch (Exception) { o = new JsObj(); o["isrcs"] = new List<object?>(); }
        return o;
    }

    private static JsObj With(JsObj o, string k, object? v)
    {
        var c = new JsObj();
        foreach (var key in o.Keys) c[key] = o[key];
        c[k] = v;
        return c;
    }

    /* The verdict, applied: the best match's candidate marked with how it was found. */
    private static Score.Verdict Applied(Score.Verdict v, string by)
    {
        var best = v.Best! with { Candidate = With(v.Best!.Candidate, "matched_by", by) };
        var list = v.ScoredList.Select(s => ReferenceEquals(s, v.Best) ? best : s).ToList();
        return v with { Status = "applied", Best = best, ScoredList = list };
    }

    private sealed record Resolved(List<JsObj> Cands, Score.Verdict Verdict, string? By);

    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static double TracksIn(JsObj input) => L(input["tracks"]).Count;

    /*
     * The release the files name, found by what they carry — before any search
     * by name — in order of certainty: the release id, the barcode, the
     * catalogue number (with the label), the ISRCs. Applied when it fits
     * within "proposed".
     */
    private async Task<Resolved?> IdResolve(JsObj input, IReleases mb)
    {
        var ids = input["ids"] as JsObj ?? new JsObj();
        var have = new HashSet<string>();
        Resolved? Settle(List<JsObj> cands, string by, bool always = false)
        {
            if (cands.Count == 0) return null;
            var verdict = Score.Decide(input, cands);
            var best = verdict.Best;
            if (best == null || (!always && best.Distance > Score.Propose)) return null;
            return new Resolved(cands, Applied(verdict, by), by);
        }
        if (Js.Truthy(ids["mbid"]))
        {
            JsObj? rel;
            try { rel = await mb.Release(Js.Str(ids["mbid"])); } catch (Exception) { rel = null; }
            var r = rel != null ? Settle([rel], "musicbrainz-id", true) : null;
            if (r != null) return r;
        }
        if (Js.Truthy(ids["barcode"]))
        {
            List<JsObj> found;
            try { found = await mb.ByBarcode(ids["barcode"]); } catch (Exception) { found = []; }
            var r = Settle(await FetchBest(found, input, have, 3, mb), "barcode");
            if (r != null) return r;
        }
        if (Js.Truthy(ids["catno"]))
        {
            List<JsObj> found;
            try { found = await mb.ByCatno(ids["catno"], ids["label"]); } catch (Exception) { found = []; }
            if (found.Count == 0 && Js.Truthy(ids["label"])) { try { found = await mb.ByCatno(ids["catno"]); } catch (Exception) { found = []; } }
            var r = Settle(await FetchBest(found, input, have, 3, mb), "catalogue-number");
            if (r != null) return r;
        }
        var isrcs = L(ids["isrcs"]);
        if (isrcs.Count > 0)
        {
            // The releases most of the sampled recordings appear on.
            var counts = new List<(string Mbid, JsObj F, double N)>();
            foreach (var code in isrcs)
            {
                List<JsObj> found;
                try { found = await mb.ByIsrc(code); } catch (Exception) { found = []; }
                foreach (var f in found)
                {
                    var id = Js.Str(f["mbid"]);
                    var i = counts.FindIndex(x => x.Mbid == id);
                    if (i < 0)
                    {
                        var copy = new JsObj();
                        copy["n"] = 0.0;
                        foreach (var k in f.Keys) copy[k] = f[k];
                        counts.Add((id, copy, 1));
                    }
                    else counts[i] = (counts[i].Mbid, counts[i].F, counts[i].N + 1);
                }
            }
            var most = counts.Count > 0 ? Math.Max(0, counts.Max(x => x.N)) : 0;
            var shared = counts.Where(x => x.N == most).Select(x =>
            {
                var c = With(x.F, "n", x.N);
                c["score"] = x.N;
                return c;
            }).ToList();
            var r = Settle(await FetchBest(shared, input, have, 4, mb), "isrc");
            if (r != null) return r;
        }
        return null;
    }

    /* found.sort: the nearest track count first, then MusicBrainz's own score. */
    private static List<JsObj> ByNearest(List<JsObj> found, JsObj input, bool score = true)
    {
        var n = TracksIn(input);
        double Off(JsObj f) => Math.Abs((Js.Truthy(f["track_count"]) ? Js.ToNumber(f["track_count"]) : 0) - n);
        return Library.Sorted(found, (a, b) =>
        {
            var d = Off(a) - Off(b);
            if (d != 0 && !double.IsNaN(d)) return d < 0 ? -1 : 1;
            return score ? Lookups.Sgn(Js.ToNumber(b["score"]) - Js.ToNumber(a["score"])) : 0;
        });
    }

    /* The likeliest few of a search's results fetched in full; none fetched twice. */
    private static async Task<List<JsObj>> FetchBest(List<JsObj> found, JsObj input, HashSet<string> have, int max, IReleases mb)
    {
        var outList = new List<JsObj>();
        foreach (var f in ByNearest(found, input))
        {
            if (outList.Count >= max) break;
            var id = Js.Str(f["mbid"]);
            if (!have.Add(id)) continue;
            JsObj? rel;
            try { rel = await mb.Release(id); } catch (Exception) { rel = null; }
            if (rel != null) outList.Add(rel);
        }
        return outList;
    }

    /*
     * The releases that could be this album, and the verdict on them. Three
     * questions at most, each only when the one before fell short: the album's
     * name (without its edition, with its artist where the tag can be trusted);
     * its words in any order with no artist; and when the best fit hasn't the
     * copy's track count, the other pressings of its record.
     */
    private async Task<Resolved> Resolve(JsObj input)
    {
        // What the files say, first.
        Resolved? byIds;
        try { byIds = await IdResolve(input, Mb); } catch (Exception) { byIds = null; }
        if (byIds != null) return byIds;
        var suspect = Score.ArtistSuspect(input["artist"], input["title"]);
        var bare = Score.Bare(input["title"]);
        object? plain = bare.Length > 0 ? bare : input["title"];
        var have = new HashSet<string>();
        var cands = await FetchBest(await Mb.Search(plain, suspect ? "" : input["artist"], null, SearchLimit), input, have, FetchMax, Mb);
        var verdict = Score.Decide(input, cands);
        if (verdict.Best == null || verdict.Best.Distance > Score.Propose)
        {
            var found = await Mb.Search(plain, "", null, SearchLimit, loose: true);
            cands = [.. cands, .. await FetchBest(found, input, have, FetchMax, Mb)];
            verdict = Score.Decide(input, cands);
        }
        var best = verdict.Best;
        if (best != null && Js.Truthy(best.Candidate["group_mbid"]) && (Js.Truthy(best.Parts["missing_tracks"]) || Js.Truthy(best.Parts["extra_tracks"])))
        {
            // The pressings with the copy's count, or within one of it: the nearest count fetched first.
            List<JsObj> group;
            try { group = await Mb.GroupReleases(best.Candidate["group_mbid"]); } catch (Exception) { group = []; }
            var n = TracksIn(input);
            var others = group.Where(r => Math.Abs((Js.Truthy(r["track_count"]) ? Js.ToNumber(r["track_count"]) : 0) - n) <= 1 && !have.Contains(Js.Str(r["mbid"]))).ToList();
            if (others.Count > 0)
            {
                cands = [.. cands, .. await FetchBest(others, input, have, WidenMax, Mb)];
                verdict = Score.Decide(input, cands);
            }
        }
        return new Resolved(cands, verdict, null);
    }

    /*
     * iTunes's albums for this one, and the verdict on them: the barcode
     * first, then by artist and title (the title alone when the artist tag
     * can't be trusted, or when that finds nothing); the two nearest in track
     * count fetched in full.
     */
    private async Task<Score.Verdict> ITunesResolve(JsObj input)
    {
        var it = ITunes!;
        var ids = input["ids"] as JsObj;
        var code = ids?["barcode"];
        if (Js.Truthy(code))
        {
            JsObj? c;
            try { c = await it.ByUpc(code); }
            catch (LookupError e) when (!e.Paused) { c = null; }
            catch (Exception e) when (e is not LookupError) { c = null; }
            if (c != null)
            {
                var v = Score.Decide(input, [c]);
                if (v.Best != null && v.Best.Distance <= Score.Propose) return Applied(v, "barcode");
            }
        }
        var suspect = Score.ArtistSuspect(input["artist"], input["title"]);
        var bare = Score.Bare(input["title"]);
        object? plain = bare.Length > 0 ? bare : input["title"];
        var found = await it.Search(plain, suspect ? "" : input["artist"]);
        if (found.Count == 0 && !suspect) found = await it.Search(plain, "");
        found = ByNearest(found, input, score: false);
        var cands = new List<JsObj>();
        foreach (var f in found.Take(2))
        {
            JsObj? c;
            try { c = await it.Album(f["id"]); }
            catch (LookupError e) when (!e.Paused) { c = null; }
            catch (Exception e) when (e is not LookupError) { c = null; }
            if (c != null) cands.Add(c);
        }
        return Score.Decide(input, cands);
    }
}
