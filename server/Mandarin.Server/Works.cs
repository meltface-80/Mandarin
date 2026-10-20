// Works.cs — an album's tracks set out as works and movements (bug list item
// 48), as Roon sets a classical album out: a work with its movements under it,
// a one-track work as its own row, and the rest of the tracks as they are.
//
// From the tags where the files carry them (WORK, MOVEMENTNAME and the number,
// Tags/Classical.cs): consecutive tracks of a disc with the same WORK are one
// work, each a movement named by its MOVEMENTNAME, or by its title with the
// work's name taken off the front, with the roman numeral put on where the
// number is known and the name lacks it. From the titles where they don't:
// consecutive tracks of a disc whose titles share the part before the first
// ": " or " - " are one work, named by that part, when the rest of each title
// is numbered (I., II., 1., 2., No. 1) or the tracks name a composer; so
// "Symphony No. 5: I. Allegro con brio" groups, and a compilation's
// "Oasis - Wonderwall" does not. The album's composers, conductors and
// performers are gathered from the tracks for the page's head.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class Works
{
    public sealed record Track(string Title, string Artist, long? Disc, double Length, string? Composer, string? Conductor, string? Work, string? Movement, long? MovementNo, string? Performers);
    public sealed record Movement(int Track, string Title);
    /* A work (Title) with its movements, or a plain track (Title null, one movement with the track's own title). */
    public sealed record Entry(string? Title, string? Composer, string? Conductor, List<string> Performers, long? Disc, double Length, List<Movement> Movements);
    public sealed record Result(List<Entry> Groups, List<string> Composers, List<string> Conductors, List<string> Performers)
    {
        public bool AnyWork => Groups.Any(g => g.Title != null);
    }

    public static Result Group(IReadOnlyList<Track> tracks, string albumArtist)
    {
        var tagged = tracks.Any(t => !string.IsNullOrEmpty(t.Work));
        var groups = new List<Entry>();
        string? last = null; long? lastDisc = null;
        for (var i = 0; i < tracks.Count; i++)
        {
            var t = tracks[i];
            var (work, movement) = tagged ? FromTags(t) : FromTitle(t, tracks, i);
            if (work != null && groups.Count > 0 && last == work && lastDisc == t.Disc)
            {
                var g = groups[^1];
                g.Movements.Add(new Movement(i, movement));
                groups[^1] = g with { Length = g.Length + t.Length, Performers = Union(g.Performers, PerformersOf(t, albumArtist)), Composer = g.Composer ?? Blank(t.Composer), Conductor = g.Conductor ?? Blank(t.Conductor) };
            }
            else groups.Add(new Entry(work, Blank(t.Composer), Blank(t.Conductor), PerformersOf(t, albumArtist), t.Disc, t.Length, [new Movement(i, work != null ? movement : t.Title)]));
            last = work; lastDisc = t.Disc;
        }
        // The head's lines: every composer and conductor named, and who performs when the album is set out by composer.
        var composers = Distinct(tracks.SelectMany(t => Names.SplitArtists(t.Composer)));
        var conductors = Distinct(tracks.SelectMany(t => Names.SplitArtists(t.Conductor)));
        var performers = composers.Count > 0 ? Distinct(groups.SelectMany(g => g.Performers)) : [];
        return new Result(groups, composers, conductors, performers);
    }

    /* The work and the movement's name from the tags: a track without a WORK is its own. */
    private static (string? Work, string Movement) FromTags(Track t)
    {
        if (string.IsNullOrEmpty(t.Work)) return (null, t.Title);
        var name = Blank(t.Movement) ?? AfterPrefix(t.Title, t.Work) ?? t.Title;
        if (t.MovementNo is > 0 and <= 30 && !Numbered().IsMatch(name)) name = Roman((int)t.MovementNo.Value) + ". " + name;
        return (t.Work, name);
    }

    /* The work from the title's front, shared with the track before or after on the same disc, and numbered or by a composer. */
    private static (string? Work, string Movement) FromTitle(Track t, IReadOnlyList<Track> tracks, int i)
    {
        var m = Split().Match(t.Title);
        if (!m.Success) return (null, t.Title);
        var work = m.Groups[1].Value.Trim();
        var rest = m.Groups[2].Value.Trim();
        bool Shares(int j) => j >= 0 && j < tracks.Count && tracks[j].Disc == t.Disc && Split().Match(tracks[j].Title) is { Success: true } n
            && string.Equals(n.Groups[1].Value.Trim(), work, StringComparison.OrdinalIgnoreCase);
        if (!Shares(i - 1) && !Shares(i + 1)) return (null, t.Title);
        if (!Numbered().IsMatch(rest) && string.IsNullOrEmpty(t.Composer)) return (null, t.Title);
        return (work, rest);
    }

    /* The title with the work's name and its separator taken off the front, or null where it doesn't start so. */
    private static string? AfterPrefix(string title, string work)
    {
        if (!title.StartsWith(work, StringComparison.OrdinalIgnoreCase)) return null;
        var rest = Separator().Replace(title[work.Length..], "", 1).Trim();
        return rest.Length > 0 && rest.Length < title.Length ? rest : null;
    }

    /* Who performs a track: its PERFORMER tags; without any, its own artist where that isn't the album's or its composer. */
    private static List<string> PerformersOf(Track t, string albumArtist)
    {
        var list = (t.Performers ?? "").Split(';').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
        var artist = t.Artist.Trim();
        if (list.Count == 0 && artist.Length > 0 && Names.ArtistKey(artist) != Names.ArtistKey(albumArtist) && (t.Composer == null || Names.ArtistKey(artist) != Names.ArtistKey(t.Composer))) list.Add(artist);
        return Distinct(list);
    }

    private static List<string> Union(List<string> a, List<string> b) => Distinct(a.Concat(b));
    private static List<string> Distinct(IEnumerable<string> names)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        return names.Select(n => n.Trim()).Where(n => n.Length > 0 && seen.Add(Names.ArtistKey(n))).ToList();
    }
    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static readonly string[] Romans = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
        "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX"];
    public static string Roman(int n) => n >= 1 && n <= Romans.Length ? Romans[n - 1] : n.ToString(System.Globalization.CultureInfo.InvariantCulture);

    // "Work: I. Movement", "Work - I. Movement" (a hyphen or dash with a space either side); the first such break.
    [GeneratedRegex(@"^(.{2,}?)(?::\s+|\s+[-–—]\s+)(.+)$")]
    private static partial Regex Split();
    [GeneratedRegex(@"^\s*(?::|[-–—])\s*")]
    private static partial Regex Separator();
    // A movement's numbering: "I.", "IV:", "1.", "2)", "No. 3", "Nr. 3".
    [GeneratedRegex(@"^(?:(?:[IVXLCivxlc]+|\d{1,2})\s*[.):]\s*\S|(?:No|Nr)\.?\s*\d)")]
    private static partial Regex Numbered();

    /* The page's and the app's JSON: each group with its movements, the track's place in the album's list. */
    public static JsonArray Json(Result r) => new(r.Groups.Select(g => (JsonNode)new JsonObject
    {
        ["title"] = g.Title,
        ["composer"] = g.Composer,
        ["conductor"] = g.Conductor,
        ["performers"] = new JsonArray(g.Performers.Select(p => (JsonNode)p).ToArray()),
        ["disc"] = g.Disc,
        ["length"] = Math.Round(g.Length),
        ["movements"] = new JsonArray(g.Movements.Select(m => (JsonNode)new JsonObject { ["track"] = m.Track, ["title"] = m.Title }).ToArray())
    }).ToArray());

    /* The score command's "works" (Identify/ScoreCommand.cs): { artist, tracks: [{ title, artist, disc, length, composer, conductor, work, movement, movement_no, performers }] }. */
    public static Tags.JsObj Command(Tags.JsObj job)
    {
        var tracks = (job["tracks"] as List<object?> ?? []).OfType<Tags.JsObj>().Select(t => new Track(
            Tags.Js.Str(t["title"]), Tags.Js.IsNullish(t["artist"]) ? "" : Tags.Js.Str(t["artist"]),
            Tags.Js.IsNullish(t["disc"]) ? null : (long)Tags.Js.ToNumber(t["disc"]), Tags.Js.IsNullish(t["length"]) ? 0 : Tags.Js.ToNumber(t["length"]),
            Opt(t["composer"]), Opt(t["conductor"]), Opt(t["work"]), Opt(t["movement"]),
            Tags.Js.IsNullish(t["movement_no"]) ? null : (long)Tags.Js.ToNumber(t["movement_no"]), Opt(t["performers"]))).ToList();
        var r = Group(tracks, Tags.Js.IsNullish(job["artist"]) ? "" : Tags.Js.Str(job["artist"]));
        var o = new Tags.JsObj();
        o["works"] = Scan.JsJson.Parse(Json(r).ToJsonString());
        o["composers"] = r.Composers.Select(x => (object?)x).ToList();
        o["conductors"] = r.Conductors.Select(x => (object?)x).ToList();
        o["performers"] = r.Performers.Select(x => (object?)x).ToList();
        return o;
    }
    private static string? Opt(object? v) => Tags.Js.IsNullish(v) ? null : Tags.Js.Str(v);
}
