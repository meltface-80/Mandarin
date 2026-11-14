// Identifier.Review.cs — what item 414b added to a verdict, joined to the steps before it (Identifier.Verdict.cs):
//   - its confidence and reasons (Confidence.cs), kept in its album_matches row's candidate with the other releases
//     near enough to pick instead ("others"), for the To confirm folder and Edit album;
//   - where the confidence adds evidence, the verdict it gives: a near miss whose every track and length agree is
//     proposed rather than left unidentified (a match found by what the files carry is applied in Settle and
//     Pressings already, Confidence.Strong);
//   - what you said before: a release you turned down for an album ("Not this", or another applied in its place) is
//     never proposed for it again, nor anything applied to it unasked; the kind of edition you chose for an artist's
//     album (its country, its edition words, its label) preferred for that artist's others when nothing else tells two
//     pressings apart;
//   - a new MusicBrainz pack in place (PackStore.Installed): the albums unidentified or proposed looked at again, as
//     a month's wait would (never one declined, nor one matched or edited by hand).
using Microsoft.Data.Sqlite;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Identifier
{
    private const int OthersKept = 4;     // the other releases kept with a verdict not applied, to pick instead

    // What you said, kept beside album_matches (which "Check again" empties for an album): made on first use.
    private const string ReviewTables = """
        CREATE TABLE IF NOT EXISTS album_declines (key TEXT NOT NULL, mbid TEXT NOT NULL, declined_at INTEGER NOT NULL, PRIMARY KEY (key, mbid));
        CREATE TABLE IF NOT EXISTS edition_choices (artist TEXT PRIMARY KEY, kind TEXT NOT NULL, chosen_at INTEGER NOT NULL);
        """;

    private static void EnsureReview(SqliteConnection c, SqliteTransaction? tx = null) => Exec(c, tx, ReviewTables);

    private static string Str(object? v) => Js.IsNullish(v) || Js.IsUndef(v) ? "" : Js.Str(v);

    /* The releases turned down for the album [key]. */
    private static List<object?> DeclinedFor(SqliteConnection c, string key)
    {
        EnsureReview(c);
        return Rows(c, "SELECT mbid FROM album_declines WHERE key = $1 ORDER BY declined_at", key).Select(r => r[0]).ToList();
    }

    /* A release turned down for the album [key]; none when [mbid] is none. */
    private static void Decline(SqliteConnection c, SqliteTransaction? tx, string key, object? mbid)
    {
        if (Str(mbid).Length == 0) return;
        EnsureReview(c, tx);
        Exec(c, tx, "INSERT INTO album_declines(key, mbid, declined_at) VALUES($1, $2, $3) ON CONFLICT(key, mbid) DO UPDATE SET declined_at = excluded.declined_at",
            key, Str(mbid), (double)Now);
    }

    /* A release chosen by hand for the album [key] is no longer turned down for it. */
    private static void Undecline(SqliteConnection c, SqliteTransaction? tx, string key, object? mbid)
    {
        EnsureReview(c, tx);
        Exec(c, tx, "DELETE FROM album_declines WHERE key = $1 AND mbid = $2", key, Str(mbid));
    }

    // ------------------------------------------------------------ the kind of edition

    private static readonly string[] KindWords = ["deluxe", "remaster", "expanded", "anniversary", "mono", "stereo", "special", "limited", "bonus", "collector", "super", "japan", "reissue"];

    private static string Folded(object? v) => ScanNames.Fold(Str(v)).Replace(" ", "", StringComparison.Ordinal);

    /* A pressing's kind: its country, the edition words in its name and note, its label. */
    public static JsObj KindOf(JsObj c)
    {
        var words = ScanNames.Fold(Str(c["edition"]) + " " + Str(c["release_title"]));
        var o = new JsObj();
        o["country"] = Folded(c["country"]);
        o["words"] = KindWords.Where(w => words.Contains(w, StringComparison.Ordinal)).Select(w => (object?)w).ToList();
        o["label"] = Folded(c["label"]);
        return o;
    }

    /* How much of [kind] a pressing has: the same country, each edition word they share (less each it has that kind hasn't), the same label. */
    public static int Fits(JsObj kind, JsObj c)
    {
        var mine = KindOf(c);
        var n = 0;
        if (Str(kind["country"]).Length > 0 && Str(kind["country"]) == Str(mine["country"])) n++;
        if (Str(kind["label"]).Length > 0 && Str(kind["label"]) == Str(mine["label"])) n++;
        var want = L(kind["words"]).Select(Str).ToHashSet();
        foreach (var w in L(mine["words"]).Select(Str)) n += want.Contains(w) ? 1 : -1;
        return n;
    }

    /* The kinds of edition chosen, by the folded name of the artist they were chosen for. */
    private static JsObj Preferences(SqliteConnection c)
    {
        EnsureReview(c);
        var o = new JsObj();
        foreach (var r in Rows(c, "SELECT artist, kind FROM edition_choices"))
            if (JsJson.Parse(Str(r[1])) is JsObj k) o[Str(r[0])] = k;
        return o;
    }

    /* The kind of [chosen] remembered for its artist's other albums. */
    private static void Learn(SqliteConnection c, SqliteTransaction? tx, JsObj chosen)
    {
        var artist = ScanNames.Fold(Str(chosen["artist"]));
        if (artist.Length == 0) return;
        EnsureReview(c, tx);
        Exec(c, tx, "INSERT INTO edition_choices(artist, kind, chosen_at) VALUES($1, $2, $3) ON CONFLICT(artist) DO UPDATE SET kind = excluded.kind, chosen_at = excluded.chosen_at",
            artist, Js.Json(KindOf(chosen)), (double)Now);
    }

    /*
     * Between pressings nothing else tells apart ([tied], [top] first among them): the one most of the kind chosen
     * before for their artist (Input's "prefer"), marked so its reasons say so; null when that changes nothing.
     */
    private static Score.Scored? Liked(JsObj input, List<Score.Scored> tied, Score.Scored top)
    {
        if (tied.Count < 2 || input["prefer"] is not JsObj prefer || prefer[ScanNames.Fold(Str(top.Candidate["artist"]))] is not JsObj kind) return null;
        var best = tied.OrderByDescending(s => Fits(kind, s.Candidate)).First();
        if (ReferenceEquals(best, top) || Fits(kind, best.Candidate) <= Fits(kind, top.Candidate)) return null;
        return best with { Candidate = With(best.Candidate, "preferred_kind", true) };
    }

    // ------------------------------------------------------------ the verdict judged

    /* A release as the To confirm folder offers it in place of the one proposed. */
    private static JsObj OtherOf(Score.Scored s)
    {
        var c = s.Candidate;
        var o = new JsObj();
        o["mbid"] = c["mbid"];
        o["artist"] = Str(c["artist"]);
        o["title"] = Score.Clean(c["title"]);
        foreach (var k in new[] { "year", "edition", "country", "release_year", "track_count" }) o[k] = Js.IsUndef(c[k]) || !Js.Truthy(c[k]) ? null : c[k];
        o["source"] = Js.Truthy(c["source"]) ? c["source"] : "musicbrainz";
        o["similarity"] = Score.Similarity(s.Distance);
        return o;
    }

    /*
     * The verdict as item 414b has it: what you turned down for the album set aside, its confidence and reasons, a
     * near miss whose every track and length agree proposed, and the other releases near enough kept to pick instead.
     */
    internal static Score.Verdict Judge(JsObj input, Score.Verdict v)
    {
        var declined = L(input["declined"]).Select(Str).Where(x => x.Length > 0).ToHashSet();
        var scored = v.ScoredList.Where(s => !declined.Contains(Str(s.Candidate["mbid"]))).ToList();
        var best = v.Best;
        var status = v.Status;
        var ambiguous = v.Ambiguous;
        if (best != null && declined.Contains(Str(best.Candidate["mbid"])))
        {
            // Not that one: the nearest left, proposed at most.
            best = scored.FirstOrDefault();
            ambiguous = false;
            status = best != null && best.Distance <= Score.Propose ? "proposed" : "unidentified";
        }
        if (best == null) return new Score.Verdict("unidentified", null, scored, false);
        // Once you've turned one down, nothing is applied to the album unasked.
        if (declined.Count > 0 && status == "applied" && !Js.Truthy(best.Candidate["manual"])) status = "proposed";
        var cand = declined.Count > 0 ? With(best.Candidate, "declined_before", true) : best.Candidate;
        var judged = Confidence.Of(input, best with { Candidate = cand }, ambiguous);
        if (status == "unidentified" && Confidence.Agrees(input, best) && judged.Value >= Confidence.ProposeFrom) status = "proposed";
        cand = With(With(cand, "confidence", (double)judged.Value), "reasons", judged.Reasons.Select(x => (object?)x).ToList());
        if (status != "applied")
        {
            var editions = L(cand["editions"]).OfType<JsObj>().Select(e => Str(e["mbid"])).ToHashSet();
            cand["others"] = scored.Where(s => !Js.StrictEq(s.Candidate["mbid"], best.Candidate["mbid"]) && !editions.Contains(Str(s.Candidate["mbid"])))
                .Take(OthersKept).Select(s => (object?)OtherOf(s)).ToList();
        }
        var was = best;
        best = best with { Candidate = cand };
        return v with { Status = status, Best = best, Ambiguous = ambiguous, ScoredList = [.. scored.Select(s => ReferenceEquals(s, was) ? best : s)] };
    }

    /* A release you chose (ApplyChosen, [how]) with its confidence and reasons, as the scan's own are kept. */
    private static Score.Scored Chosen(JsObj input, Score.Scored best, string how)
    {
        best = best with { Candidate = With(best.Candidate, "manual", how) };
        var judged = Confidence.Of(input, best, false);
        return best with { Candidate = With(With(best.Candidate, "confidence", (double)judged.Value), "reasons", judged.Reasons.Select(x => (object?)x).ToList()) };
    }

    /*
     * What choosing [chosen] by hand ([how]) says for the album [key], whose verdict was [prev]: chosen, it is no
     * longer turned down; the scan's own choice it replaces is (the release, not another edition of it, when you chose
     * an edition); and another edition of the same record chosen teaches the kind for its artist.
     */
    private static void Remember(SqliteConnection c, SqliteTransaction tx, string key, MatchRow? prev, JsObj chosen, string how)
    {
        Undecline(c, tx, key, chosen["mbid"]);
        var was = prev != null && Js.Truthy(prev.Candidate) ? JsJson.Parse(Js.Str(prev.Candidate)) as JsObj : null;
        var sameRecord = was != null && Js.Truthy(was["group_mbid"]) && Js.StrictEq(was["group_mbid"], chosen["group_mbid"]);
        if (was != null && !Js.Truthy(was["manual"]) && prev!.Status is "proposed" or "applied" && !sameRecord && !Js.StrictEq(was["mbid"], chosen["mbid"]))
            Decline(c, tx, key, was["mbid"]);
        if (how == "edition" || (how == "pick" && sameRecord)) Learn(c, tx, chosen);
    }

    /*
     * A new MusicBrainz pack in place: the albums unidentified or proposed looked at again (their verdicts kept until
     * then, the scan's month run out); never one declined, nor one you matched by hand. → how many.
     */
    public Task<int> PackUpdated() => Writing(async () =>
    {
        await Task.CompletedTask;
        using var c = Db.Open();
        var n = Exec(c, null, "UPDATE album_matches SET checked_at = 0 WHERE status IN ('unidentified', 'proposed')");
        lock (state) packTried.Clear();
        AlbumProgress.Forget();
        if (n > 0) log($"[identify] a new MusicBrainz pack: {n} album{(n == 1 ? "" : "s")} looked at again");
        return (n, false);
    });

    /* Unidentified or proposed, and a new pack in place since (PackUpdated): looked at again. */
    private static bool Requeued(MatchRow? r) => r != null && r.Status is "unidentified" or "proposed" && r.Checked == 0;
}
