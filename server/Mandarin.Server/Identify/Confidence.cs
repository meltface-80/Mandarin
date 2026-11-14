// Confidence.cs — how sure the scan is of a match, 0 to 100, and why, in plain words (bug list item 414b). Built from
// all the evidence a verdict has, not the names' distance alone (Score.cs, which stays one input):
//   - how it was found: the release id in the files, the barcode, the catalogue number, the ISRCs (what share of
//     those sampled), the tracks' lengths as a CD's table of contents, a search by name, or iTunes;
//   - whether the copy has the release's tracks, one for one, and how many of their lengths agree (within the
//     scorer's fifteen seconds);
//   - whether the title and the artist agree, the track names, the year;
//   - the pack or musicbrainz.org, another release that fits as well, the kind of edition chosen before.
//
// The number: how alike the names and lengths are (the page's similarity); found by what the files carry, with every
// track there and every length agreeing, at least that way's floor (the release id 95, the barcode 92, a CD's table of
// contents 92, the catalogue number 90, the ISRCs 85 and up by their share); found by what the files carry otherwise,
// five more; ten less when another release fits as well.
//
// It decides only where it adds evidence (Identifier.Review.cs): found by what the files carry with every track and
// length agreeing, a match is applied though its names are further off than Score's 85 % (they may be another
// language's, or a rip's "Track 01"s); a near miss whose every track and length agree is proposed rather than left
// unidentified. Every verdict applied or proposed before still is.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal static class Confidence
{
    /* A verdict's confidence and its reasons. */
    public sealed record Judged(int Value, List<string> Reasons);

    // The least a match found by what the files carry is worth, every track and length agreeing.
    private static readonly Dictionary<string, int> Floor = new(StringComparer.Ordinal)
    {
        ["musicbrainz-id"] = 95, ["barcode"] = 92, ["disc-lengths"] = 92, ["catalogue-number"] = 90, ["isrc"] = 85
    };

    /* The near miss proposed rather than left unidentified when every track and length agree. */
    public const int ProposeFrom = 60;

    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static string S(object? v) => Js.IsNullish(v) || Js.IsUndef(v) ? "" : Js.Str(v);
    private static double N(object? v) => v is double d ? d : 0;

    /* Found by what the files carry (not by name, not by iTunes's search). */
    public static bool ById(string? by) => by != null && Floor.ContainsKey(by);

    /*
     * How many of the copy's tracks ([album]'s) have the length of the release track each paired with, and of how
     * many: a candidate scored against one disc of a set ([s]'s parts.disc) pairs with that disc's tracks alone.
     */
    public static (int Agree, int Of) Lengths(JsObj album, Score.Scored s)
    {
        var mine = L(album["tracks"]).OfType<JsObj>().ToList();
        var theirs = L(s.Candidate["tracks"]).OfType<JsObj>().ToList();
        if (s.Parts["disc"] is double dn) theirs = theirs.Where(t => Js.StrictEq(t["disc"], dn)).ToList();
        var agree = 0;
        for (var i = 0; i < mine.Count && i < s.Pairs.Count; i++)
        {
            if (s.Pairs[i] is not double j || j < 0 || j >= theirs.Count) continue;
            var a = mine[i]["length"];
            var b = theirs[(int)j]["length"];
            if (!Js.IsNullish(a) && !Js.IsNullish(b) && Score.LengthDist(a, b) == 0) agree++;
        }
        return (agree, mine.Count);
    }

    /* Every track of the copy paired, none of the release's left over, every length known and agreeing; two tracks or more. */
    public static bool Agrees(JsObj album, Score.Scored s)
    {
        var p = s.Parts;
        if (Js.Truthy(p["no_lengths"]) || N(p["missing_tracks"]) != 0 || N(p["extra_tracks"]) != 0) return false;
        var (agree, of) = Lengths(album, s);
        return of >= 2 && agree == of;
    }

    /* Found by what the files carry ([by]), every track and length agreeing: applied, whatever the names say. */
    public static bool Strong(JsObj album, Score.Scored s, string? by) => ById(by) && Agrees(album, s);

    /* The share of the sampled ISRCs found on the release, from its "isrc_of" ("2/3"); 1 when not said. */
    private static (double N, double Of) IsrcShare(JsObj c)
    {
        var parts = S(c["isrc_of"]).Split('/');
        return parts.Length == 2 && double.TryParse(parts[0], System.Globalization.CultureInfo.InvariantCulture, out var n)
            && double.TryParse(parts[1], System.Globalization.CultureInfo.InvariantCulture, out var of) && of > 0 ? (n, of) : (1, 1);
    }

    /* How the match was found, in words. */
    public static string HowFound(JsObj c)
    {
        var by = S(c["matched_by"]);
        var manual = S(c["manual"]);
        var pack = Js.Truthy(c["from_pack"]) ? ", in the MusicBrainz pack" : "";
        if (manual == "edition") return "you chose this edition";
        if (manual == "barcode") return "you matched it by its barcode";
        if (manual == "link") return "you matched it by a MusicBrainz link";
        if (manual.Length > 0) return "you chose it";
        if (S(c["source"]) == "itunes") return by == "barcode" ? "found on iTunes by its barcode" : "found on iTunes by name";
        switch (by)
        {
            case "musicbrainz-id": return "found by the MusicBrainz ID in its files" + pack;
            case "barcode": return "found by its barcode" + pack;
            case "catalogue-number": return "found by its catalogue number";
            case "isrc":
                var (n, of) = IsrcShare(c);
                return $"found by its ISRCs ({Js.Num(n)} of {Js.Num(of)})";
            case "disc-lengths":
                var year = S(c["release_year"]);
                return "the tracks' lengths match the " + (year.Length > 0 ? year + " CD" : "CD");
            default: return "found by name only";
        }
    }

    private static string Tracks(double n) => n == 1 ? "one track" : Js.Num(n) + " tracks";

    /*
     * The confidence in [s] as the match of [album] (its tracks for the lengths; null for a verdict kept before item
     * 414b, read from what its row keeps), and why: plain words, the most telling first.
     */
    public static Judged Of(JsObj? album, Score.Scored s, bool ambiguous)
    {
        var c = s.Candidate;
        var p = s.Parts;
        var reasons = new List<string> { HowFound(c) };
        var by = S(c["matched_by"]);
        var manual = Js.Truthy(c["manual"]);
        var (agree, of) = album != null ? Lengths(album, s) : (p["track_lengths"] is double tl && tl == 0 ? s.Pairs.Count(x => x != null) : 0, s.Pairs.Count);
        var noLengths = Js.Truthy(p["no_lengths"]);
        if (noLengths) reasons.Add(S(c["source"]) == "itunes" ? "iTunes has no track lengths" : "MusicBrainz has no track lengths");
        else if (of > 0) reasons.Add($"{Js.Num(agree)} of {Js.Num(of)} tracks' lengths agree");
        var missing = N(p["missing_tracks"]);
        var extra = N(p["extra_tracks"]);
        // A track more or fewer than the release; tracks on both sides that pair with nothing, said once.
        if (missing > 0 && extra > 0) reasons.Add(Tracks(extra) + " here match none of this edition's");
        else if (missing > 0) reasons.Add(Tracks(missing) + " fewer than this edition");
        else if (extra > 0) reasons.Add(Tracks(extra) + " more than this edition");
        var titleOk = p["album"] is double al && al <= 0.05;
        var artistOk = p["artist"] is not double ar || ar == 0;
        // A row kept with no parts (one written by hand, or a test's) says nothing of the names.
        if (p["album"] is double) reasons.Add(titleOk && artistOk ? (p["artist"] is double ? "title and artist agree" : "the title agrees")
            : titleOk ? "the title agrees, the artist is spelt differently" : artistOk && p["artist"] is double ? "the artist agrees, the title differs" : "the title differs");
        if (p["track_titles"] is double tt && tt > 0.05) reasons.Add("track names differ");
        if (p["year"] is double y && y == 1) reasons.Add("the year differs");
        if (p["note"] is double nt && nt == 1) reasons.Add("MusicBrainz marks it as another version");
        if (ambiguous) reasons.Add("another release fits as well");
        if (Js.Truthy(c["preferred_kind"])) reasons.Add("you chose this kind of edition for " + S(c["artist"]) + " before");
        if (Js.Truthy(c["declined_before"])) reasons.Add("you turned down another release for it");

        var value = Score.Similarity(s.Distance);
        var all = !noLengths && missing == 0 && extra == 0 && of >= 2 && agree == of;
        if (!manual && ById(by))
        {
            var floor = Floor[by];
            if (by == "isrc") { var (n, k) = IsrcShare(c); floor = 85 + (int)Js.Round(10 * n / k); }
            value = all ? Math.Max(value, floor) : Math.Min(100, value + 5);
        }
        if (ambiguous) value -= 10;
        return new Judged((int)Math.Max(0, Math.Min(100, value)), reasons);
    }

    /* A verdict kept before item 414b (its candidate as album_matches has it): judged from what the row keeps. */
    public static Judged OfKept(JsObj c, double distance)
    {
        var s = new Score.Scored(c, distance, c["parts"] as JsObj ?? new JsObj(), L(c["pairs"]));
        return Of(null, s, Js.Truthy(c["ambiguous"]));
    }

    /* The confidence and reasons a kept candidate carries, or worked out from it. */
    public static Judged Read(JsObj c, double distance)
    {
        if (c["confidence"] is double v && c["reasons"] is List<object?> rs) return new Judged((int)v, rs.Select(S).Where(x => x.Length > 0).ToList());
        return OfKept(c, distance);
    }
}
