// ShelfFacts.cs — what the Shelf's spines and album view say of an album beyond
// its names (item 206, Rouen's Shelf v1.9.67 to v1.9.69-t1 brought across):
//   - the kinds of release it is (album, EP, single, compilation, live,
//     soundtrack, remix, other), as the identification scan's applied MusicBrainz
//     match says of its release group ("Album + Live") and, where that says
//     nothing, the scan's compilation flag — lib/release-facts.js's vocabulary,
//     sent to the page with the list so it keeps no copy;
//   - the format of its files ("FLAC 24/96", "FLAC 44.1 kHz", "MP3") or the
//     service it streams from and what it states ("Qobuz 24/96", "TIDAL") —
//     lib/album-quality.js albumFormatLabel; nothing when nothing is known;
//   - the version its title ends with ("Deluxe Edition", "2011 Remaster"),
//     taken off the end part by part while each names an edition —
//     lib/album-version.js splitVersion; anything else in brackets is the
//     record's own and stays.
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class ShelfFacts
{
    /* What a release can be: its id, its name, and its name for many, in the order the Types tiles show them. */
    public static readonly (string Id, string One, string Many)[] Kinds =
    [
        ("album", "Album", "Albums"), ("ep", "EP", "EPs"), ("single", "Single", "Singles"), ("compilation", "Compilation", "Compilations"),
        ("live", "Live", "Live"), ("soundtrack", "Soundtrack", "Soundtracks"), ("remix", "Remix", "Remixes"), ("other", "Other", "Other")
    ];

    /* The kinds as the page is sent them: [{ id, one, many }]. */
    public static JsonArray KindsJson() =>
        new(Kinds.Select(k => (JsonNode)new JsonObject { ["id"] = k.Id, ["one"] = k.One, ["many"] = k.Many }).ToArray());

    // MusicBrainz's secondary types that say more than the primary, first; then its primary types.
    private static readonly (string Word, string Id)[] Secondary =
        [("compilation", "compilation"), ("soundtrack", "soundtrack"), ("live", "live"), ("remix", "remix"), ("dj-mix", "remix"), ("mixtape", "remix")];
    private static readonly Dictionary<string, string> Primary = new()
        { ["album"] = "album", ["lp"] = "album", ["ep"] = "ep", ["single"] = "single", ["broadcast"] = "other", ["other"] = "other" };

    /* The release type an applied match kept for an album ("Album + Compilation"), read from the match as kept
       (album_matches.candidate, Identify/MusicBrainz.cs's `type`); null when there is none. */
    public static string? TypeOf(string? candidateJson)
    {
        if (string.IsNullOrEmpty(candidateJson)) return null;
        try { return JsonNode.Parse(candidateJson)?["type"] is JsonValue v && v.TryGetValue<string>(out var t) && t.Length > 0 ? t : null; }
        catch (JsonException) { return null; }
    }

    /* The kinds an album is, each once, in Kinds' order; null when nothing says. The compilation flag speaks only
       where the match's type says nothing (lib/release-facts.js releaseTypes). */
    public static List<string>? KindsOf(string? mbType, bool compilation)
    {
        var words = (mbType ?? "").Split(['+', ';', ',', '/'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(w => w.ToLowerInvariant()).ToList();
        var ids = new List<string>();
        foreach (var (word, id) in Secondary) if (words.Contains(word)) ids.Add(id);
        foreach (var w in words) if (Primary.TryGetValue(w, out var id)) ids.Add(id);
        if (ids.Count == 0 && compilation) ids.Add("compilation");
        if (ids.Count == 0) return null;
        var order = Kinds.Select((k, i) => (k.Id, i)).ToDictionary(x => x.Id, x => x.i);
        return ids.Distinct().OrderBy(id => order[id]).ToList();
    }

    private static readonly Dictionary<string, string> Services = new() { ["qobuz"] = "Qobuz", ["tidal"] = "TIDAL" };

    /* A sample rate as people say it: 44.1, 48, 96, 192. */
    public static string RateShort(long hz)
    {
        var k = hz / 1000.0;
        return Math.Abs(k - Math.Round(k)) < 1e-9 ? ((long)Math.Round(k)).ToString(CultureInfo.InvariantCulture)
            : (Math.Round(k * 10) / 10).ToString(CultureInfo.InvariantCulture);
    }

    /* The format a spine shows: a lossless file's container and numbers ("FLAC 24/96", "FLAC 44.1 kHz", or the
       container alone when no numbers are known), a lossy file's container alone ("MP3"); a streamed album's service
       and what it states ("Qobuz 24/96"), or the service alone; null when nothing is known. */
    public static string? FormatOf(Album al)
    {
        string? q = null;
        if (al.Lossless)
        {
            if (al.Bits != null && al.Rate != null) q = al.Bits + "/" + RateShort(al.Rate.Value);
            else if (al.Rate != null) q = RateShort(al.Rate.Value) + " kHz";
        }
        if (al.Service != null && Services.TryGetValue(al.Service, out var svc)) return q != null ? svc + " " + q : svc;
        var box = string.IsNullOrEmpty(al.Container) ? null : al.Container;
        if (!al.Lossless || q == null) return box;
        return box == null ? q : box + " " + q;
    }

    // Words that make a trailing part an edition. Whole words, any case. "Live" is a kind, not a version.
    [GeneratedRegex(@"\b(deluxe|edition|editions|remaster|remastered|remasters|remastering|expanded|anniversary|limited|special|collector'?s|bonus|reissue|reissued|version|mono|stereo|legacy|centenary|definitive|super|box\s+set|hi-?res|24[- ]?bit|bit|mqa|sacd|vinyl)\b", RegexOptions.IgnoreCase)]
    private static partial Regex VersionWords();
    [GeneratedRegex(@"\s*(?:\(([^()]*)\)|\[([^\[\]]*)\])\s*$")] private static partial Regex Bracketed();
    [GeneratedRegex(@"\s+[-–—]\s+([^-–—]+)$")] private static partial Regex Dashed();

    /* The title without its version, and the version ("Deluxe Edition · Remastered"), when the title ends with one:
       a trailing (…), […] or " - …" naming an edition, up to four of them; null when it names none, or is only one. */
    public static (string Base, string Version)? SplitVersion(string? title)
    {
        var rest = (title ?? "").Trim();
        var parts = new List<string>();
        for (int k = 0; k < 4; k++)
        {
            var m = Bracketed().Match(rest);
            if (!m.Success) m = Dashed().Match(rest);
            if (!m.Success) break;
            var inner = (m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value).Trim();
            if (inner.Length == 0 || !VersionWords().IsMatch(inner)) break;
            parts.Insert(0, inner);
            rest = rest[..m.Index].Trim();
        }
        return parts.Count == 0 || rest.Length == 0 ? null : (rest, string.Join(" · ", parts));
    }
}
