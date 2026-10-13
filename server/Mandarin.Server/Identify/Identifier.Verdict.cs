// Identifier.Verdict.cs — an album looked up, decided and recorded (v0.8.19;
// out of Identifier.cs in v0.9.2): applied when it's near enough, proposed or
// left unidentified otherwise, and the release you name written whatever its
// score. Every write goes through one gate, one at a time.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Identifier
{
    /* Look one album up, decide, record — and apply when it's near enough. */
    private async Task<MatchRow?> Identify(Album al)
    {
        JsObj input;
        MatchRow? prev;
        using (var c = Db.Open()) { input = Input(c, al); prev = Row(c, al.Key); }
        // Unidentified already, iTunes not asked yet: only iTunes is asked.
        var only = ITunesOnly(prev);
        var verdict = only ? null : (await Resolve(input)).Verdict;
        string? itunes = null;
        if ((verdict == null || verdict.Status == "unidentified") && ITunesUsable())
        {
            try
            {
                var v = await ITunesResolve(input);
                itunes = "asked";
                // iTunes's answer when it has one; else whichever came nearer, for the page to name.
                var nearer = v.Best != null && (verdict == null || verdict.Best == null || v.Best.Distance < verdict.Best.Distance);
                if (v.Status != "unidentified" || (!only && nearer)) verdict = v;
            }
            catch (Exception e)
            {
                // Too busy, or not answering: asked again later; iTunes rests a while either way.
                itunes = "skipped";
                if (!(e is LookupError { Paused: true }) && ITunes != null) ITunes.PausedUntil = Now + 10 * 60 * 1000;
            }
        }
        if (verdict == null || (only && verdict.Status == "unidentified"))
        {
            // Nothing new: the MusicBrainz verdict stands, and its month runs on.
            if (prev != null && itunes != null)
                await Writing(async () => { using var c = Db.Open(); Exec(c, null, "UPDATE album_matches SET itunes = $1 WHERE key = $2", itunes, al.Key); await Task.CompletedTask; return false; });
            return prev;
        }
        return await Record(al, verdict, itunes);
    }

    /*
     * An album the pack alone can place, while musicbrainz.org isn't answering:
     * its release id, else its barcode, from the pack; a fit is applied as any
     * match is. Anything less waits for musicbrainz.org.
     */
    private async Task<MatchRow?> IdentifyFromPack(Album al)
    {
        var p = pack();
        lock (state) packTried.Add(al.Key);
        if (p == null) return null;
        JsObj input;
        using (var c = Db.Open()) input = Input(c, al);
        var r = await IdResolve(input, new PackOnly(p));
        return r != null ? await Record(al, r.Verdict, null) : null;
    }

    /* Everything written here goes through this: one at a time, the Node server told when it's done. */
    private async Task<T> Writing<T>(Func<Task<(T Result, bool Edits)>> work)
    {
        await writing.WaitAsync();
        try
        {
            var (result, edits) = await work();
            if (edits) await Library.Tell(new JsonObject { ["edits"] = true });
            return result;
        }
        finally { writing.Release(); }
    }
    private Task<bool> Writing(Func<Task<bool>> work) => Writing(async () => { var e = await work(); return (true, e); });

    /* The page reads the verdicts while nothing is half written. */
    public async Task<T> Reading<T>(Func<T> read)
    {
        await writing.WaitAsync();
        try { return read(); }
        finally { writing.Release(); }
    }

    /* A verdict written: applied (with what was there kept for Undo), proposed or not found. */
    private Task<MatchRow> Record(Album al, Score.Verdict verdict, string? itunes) => Writing(async () =>
    {
        await Task.CompletedTask;
        var best = verdict.Best;
        var now = (double)Now;
        var row = new MatchRow
        {
            Key = al.Key,
            Mbid = best != null ? best.Candidate["mbid"] : null,
            Distance = best?.Distance,
            Status = verdict.Status,
            Candidate = best != null ? Js.Json(Score.Kept(best, ("ambiguous", verdict.Ambiguous))) : null,
            Before = null, CheckedAt = now, AppliedAt = null, ITunes = itunes
        };
        if (row.Mbid is Undef) row.Mbid = null;
        using var c = Db.Open();
        if (verdict.Status == "applied")
        {
            using var tx = c.BeginTransaction();
            row.Before = Js.Json(Snapshot(c, tx, al));
            row.AppliedAt = row.CheckedAt;
            Put(c, tx, row);
            // With its pairs: a copy missing a track takes each name from the track it paired with.
            Apply(c, tx, al, With(best!.Candidate, "pairs", best.Pairs));
            tx.Commit();
            var cand = best.Candidate;
            log($"[identify] {al.Artist} — {al.Title} → {Js.Str(cand["artist"])} — {Js.Str(cand["title"])} ({Js.Num(Js.Round((1 - best.Distance) * 100))} %"
                + (Js.StrictEq(cand["source"], "itunes") ? ", iTunes" : "")
                + (Js.Truthy(cand["matched_by"]) ? ", by " + Js.Str(cand["matched_by"]) + (Js.Truthy(cand["from_pack"]) ? " (pack)" : "") : "") + ")");
            return (row, true);
        }
        Put(c, null, row);
        return (row, false);
    });

    /*
     * The releases that could be this album, scored, best first — for the
     * album editor's Find match, where you choose. Nothing is written.
     */
    public async Task<JsObj?> Suggest(Album al)
    {
        JsObj input;
        using (var c = Db.Open()) input = Input(c, al);
        var verdict = (await Resolve(input)).Verdict;
        if (verdict.Status == "unidentified" && ITunesUsable())
        {
            Score.Verdict? v;
            try { v = await ITunesResolve(input); } catch (Exception) { v = null; }
            if (v != null && v.ScoredList.Count > 0)
            {
                var scored = Library.Sorted(verdict.ScoredList.Concat(v.ScoredList), (a, b) => Lookups.Sgn(a.Distance - b.Distance));
                verdict = v.Status != "unidentified" ? v with { ScoredList = scored } : verdict with { ScoredList = scored };
            }
        }
        var o = new JsObj();
        o["verdict"] = verdict.Status;
        o["ambiguous"] = verdict.Ambiguous;
        o["candidates"] = verdict.ScoredList.Select(s =>
        {
            var c = s.Candidate;
            var x = new JsObj();
            x["mbid"] = c["mbid"];
            x["title"] = Score.Clean(c["title"]);
            x["artist"] = c["artist"];
            x["year"] = c["year"];
            x["release_title"] = Js.Truthy(c["release_title"]) ? c["release_title"] : null;
            x["release_year"] = Js.Truthy(c["release_year"]) ? c["release_year"] : null;
            x["edition"] = Js.Truthy(c["edition"]) ? c["edition"] : null;
            x["country"] = Js.Truthy(c["country"]) ? c["country"] : null;
            x["type"] = Js.Truthy(c["type"]) ? c["type"] : null;
            x["track_count"] = c["track_count"];
            x["source"] = Js.Truthy(c["source"]) ? c["source"] : "musicbrainz";
            x["similarity"] = Js.Round((1 - s.Distance) * 100);
            x["distance"] = s.Distance;
            x["missing_tracks"] = Js.Truthy(s.Parts["missing_tracks"]) ? s.Parts["missing_tracks"] : 0.0;
            x["extra_tracks"] = Js.Truthy(s.Parts["extra_tracks"]) ? s.Parts["extra_tracks"] : 0.0;
            return (object?)x;
        }).ToList();
        return o;
    }

    [GeneratedRegex("^itunes:[0-9]+\\z")]
    private static partial Regex ITunesId();

    /*
     * A match you name: a barcode off the sleeve, or a MusicBrainz release or
     * release-group link. The release is scored so the page can say how alike
     * it is, then applied whatever the score — you said so.
     */
    public async Task<MatchRow?> Match(Album al, string? barcode, string? mbid, string? group, string? how)
    {
        JsObj input;
        using (var c = Db.Open()) input = Input(c, al);
        if (mbid != null && ITunesId().IsMatch(mbid))
        {
            if (ITunes == null) throw new IdentifyError("iTunes isn't available", 409);
            JsObj? c;
            try { c = await ITunes.Album(mbid[7..]); } catch (Exception) { c = null; }
            if (c == null) throw new IdentifyError("iTunes didn't give that album", 502);
            return await ApplyChosen(al, input, [c], how ?? "pick");
        }
        List<JsObj> found;
        if (!string.IsNullOrEmpty(mbid))
        {
            var f = new JsObj();
            f["mbid"] = mbid;
            f["track_count"] = 0.0;
            f["score"] = 0.0;
            found = [f];
        }
        else if (!string.IsNullOrEmpty(group)) found = await Mb.GroupReleases(group);
        else found = await Mb.ByBarcode(barcode);
        if (found.Count == 0) throw new IdentifyError(!string.IsNullOrEmpty(barcode) ? "No release on MusicBrainz carries that barcode" : "Nothing at that MusicBrainz link", 404);
        var cands = new List<JsObj>();
        foreach (var f in ByNearest(found, input).Take(3))
        {
            JsObj? rel;
            try { rel = await Mb.Release(Js.Str(f["mbid"])); } catch (Exception) { rel = null; }
            if (rel != null) cands.Add(rel);
        }
        if (cands.Count == 0) throw new IdentifyError("MusicBrainz didn't give that release", 502);
        return await ApplyChosen(al, input, cands, how ?? (!string.IsNullOrEmpty(barcode) ? "barcode" : "link"));
    }

    /* The release you chose written to the album, whatever its score. */
    private Task<MatchRow?> ApplyChosen(Album al, JsObj input, List<JsObj> cands, string how) => Writing<MatchRow?>(async () =>
    {
        await Task.CompletedTask;
        var verdict = Score.Decide(input, cands);
        var best = verdict.Best!;
        using var c = Db.Open();
        using var tx = c.BeginTransaction();
        var prev = Row(c, al.Key);
        if (prev != null && prev.Status == "applied") Undo(c, tx, al, prev);
        var now = (double)Now;
        Put(c, tx, new MatchRow
        {
            Key = al.Key, Mbid = best.Candidate["mbid"] is Undef ? null : best.Candidate["mbid"], Distance = best.Distance, Status = "applied",
            Candidate = Js.Json(Score.Kept(best, ("manual", how))),
            Before = Js.Json(Snapshot(c, tx, al)), CheckedAt = now, AppliedAt = now,
            ITunes = prev != null ? (Js.Truthy(prev.ITunes) ? prev.ITunes : null) : null
        });
        Apply(c, tx, al, With(best.Candidate, "pairs", best.Pairs));
        tx.Commit();
        log($"[identify] {al.Artist} — {al.Title} → {Js.Str(best.Candidate["artist"])} — {Js.Str(best.Candidate["title"])} (by {how}, {Js.Num(Js.Round((1 - best.Distance) * 100))} %)");
        return (Row(c, al.Key), true);
    });
}
