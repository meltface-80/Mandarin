// CreditRules.cs — who played, sang, wrote and made an album, and who an act
// is (bug list item 129), read from what the files and MusicBrainz say. No
// asking here: the answers come in as they were given (a file's raw tags as
// track_tags keeps them, MusicBrainz's release and artist JSON, Wikidata's,
// FanArt.tv's and Deezer's), and what they say comes out as credits, an act's
// facts and its picture's address. CreditFinder.cs asks; CreditStore.cs keeps.
//
// A credit is a name and a role on a track (0: the whole album). The album
// page lists one row a name, its roles in order and the tracks it is on, the
// players and singers first, then the writers, then those who made the record.
using System.Globalization;
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Credits;

using Js = Mandarin.Server.Tags.Js;

/* One name's part on a track: [Track] its place on the album (1 on), 0 for the whole album. */
internal sealed record Credit(int Track, string Name, string? Mbid, string Role, string Source);

/* One row of the album's credits: its roles, and the tracks it is on (none listed: every one). */
internal sealed record AlbumCredit(string Key, string Name, string? Mbid, List<string> Roles, List<int> Tracks, string Source);

/* One stint in a band: the person (a band's member) or the band (a person's), its years and what was played. */
internal sealed record Member(string Name, string? Mbid, string? Begin, string? End, bool Ended, List<string> Roles);

/* What MusicBrainz says of an act: its kind, its years and place, its members or bands, and where else it is written about. */
internal sealed record ArtistFacts(string? Mbid, string Name, string? Type, string? Disambiguation, string? Begin, string? End, bool Ended, string? Area,
    List<Member> Members, List<Member> MemberOf, Dictionary<string, string> Links);

internal static partial class CreditRules
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static JsObj O(object? v) => v as JsObj ?? new JsObj();
    private static string S(object? v) => Js.Truthy(v) ? Js.Trim(Js.Str(v)) : "";
    private static string? N(object? v) => S(v) is { Length: > 0 } s ? s : null;

    /* "drums (drum set)" → "Drums"; "lead vocals" → "Lead vocals". */
    public static string Cap(string s)
    {
        var t = Js.Trim(Paren().Replace(s, ""));
        return t.Length == 0 ? "" : char.ToUpper(t[0], CultureInfo.InvariantCulture) + t[1..];
    }

    [GeneratedRegex(@"\s*\([^()]*\)")]
    private static partial Regex Paren();

    // ---------------------------------------------------------------- the files' own tags

    // The raw tags that name someone, by the role they give: Vorbis's names, ID3's frames, and the end of an iTunes or TXXX name.
    private static readonly Dictionary<string, string> TagRoles = new(StringComparer.Ordinal)
    {
        ["PRODUCER"] = "Producer", ["ENGINEER"] = "Engineer", ["MIXER"] = "Mixing", ["DJMIXER"] = "DJ mix",
        ["ARRANGER"] = "Arranger", ["REMIXER"] = "Remixer", ["TPE4"] = "Remixer", ["LYRICIST"] = "Lyricist", ["TEXT"] = "Lyricist",
        ["WRITER"] = "Writer", ["COMPOSER"] = "Composer", ["TCOM"] = "Composer", ["©WRT"] = "Composer",
        ["CONDUCTOR"] = "Conductor", ["TPE3"] = "Conductor", ["ENSEMBLE"] = "Ensemble", ["ORCHESTRA"] = "Orchestra",
    };

    [GeneratedRegex(@"^(.*?)\s*\(([^()]+)\)\s*$")]
    private static partial Regex NameWithRole();
    [GeneratedRegex(@"\s*(?:,|&|\band\b)\s*")]
    private static partial Regex RoleSplit();
    [GeneratedRegex(@"\s*(?:;|\s/\s)\s*")]
    private static partial Regex NameSplit();

    /* A tag's name as its role is looked up: "----:COM.APPLE.ITUNES:PRODUCER" and "TXXX:PRODUCER" → "PRODUCER". */
    private static string TagName(string key)
    {
        var at = key.LastIndexOf(':');
        return at >= 0 && (key.StartsWith("TXXX", StringComparison.Ordinal) || key.StartsWith("----", StringComparison.Ordinal)) ? key[(at + 1)..] : key;
    }

    /* "Jerome Augustyniak (drums, percussion)" → the name and its roles; no brackets → a performer. */
    private static (string Name, List<string> Roles) Performer(string value)
    {
        var m = NameWithRole().Match(value);
        if (!m.Success) return (Js.Trim(value), new List<string> { "Performer" });
        var roles = RoleSplit().Split(m.Groups[2].Value).Select(Cap).Where(r => r.Length > 0).ToList();
        return (Js.Trim(m.Groups[1].Value), roles.Count > 0 ? roles : new List<string> { "Performer" });
    }

    /* One track's credits from its raw tags ([tags]: name → values, as track_tags keeps them). */
    public static List<Credit> FromTags(int track, JsObj tags)
    {
        var list = new List<Credit>();
        void Add(string name, string role)
        {
            foreach (var n in NameSplit().Split(name).Select(Js.Trim).Where(n => n.Length > 0))
                list.Add(new Credit(track, n, null, role, "tags"));
        }
        foreach (var key in tags.Keys)
        {
            var name = TagName(key);
            foreach (var v in L(tags[key]).Select(S).Where(v => v.Length > 0))
            {
                if (name == "PERFORMER")
                {
                    var (who, roles) = Performer(v);
                    foreach (var r in roles) Add(who, r);
                }
                else if (name is "TMCL" or "TIPL" or "IPLS" && v.StartsWith('{'))
                {
                    // ID3's credit lists, kept as JSON: a role (an instrument in TMCL) and its names.
                    object? pairs;
                    try { pairs = Mandarin.Server.Scan.JsJson.Parse(v); } catch (Exception) { continue; }
                    if (pairs is not JsObj o) continue;
                    foreach (var part in o.Keys)
                        foreach (var who in (o[part] is List<object?> l ? l : new List<object?> { o[part] }).Select(S).Where(x => x.Length > 0))
                            Add(who, Cap(part));
                }
                else if (TagRoles.TryGetValue(name, out var said)) Add(v, said);
            }
        }
        return list;
    }

    // ---------------------------------------------------------------- MusicBrainz's release

    // What a relation's type is called as a role (the instrument and vocal ones say theirs in their attributes); the rest are left out.
    private static readonly Dictionary<string, string> TypeRoles = new(StringComparer.Ordinal)
    {
        ["performer"] = "Performer", ["performing orchestra"] = "Orchestra", ["conductor"] = "Conductor", ["chorus master"] = "Chorus master",
        ["concertmaster"] = "Concertmaster", ["engineer"] = "Engineer", ["audio"] = "Engineer", ["sound"] = "Sound engineer",
        ["recording"] = "Recording engineer", ["mix"] = "Mixing", ["mastering"] = "Mastering", ["balance"] = "Balance engineer",
        ["editor"] = "Editor", ["programming"] = "Programming", ["remixer"] = "Remixer", ["mix-DJ"] = "DJ mix",
        ["arranger"] = "Arranger", ["instrument arranger"] = "Arranger", ["vocal arranger"] = "Vocal arranger", ["orchestrator"] = "Orchestrator",
        ["composer"] = "Composer", ["lyricist"] = "Lyricist", ["writer"] = "Writer", ["librettist"] = "Librettist", ["translator"] = "Translator",
        ["design/illustration"] = "Design", ["design"] = "Design", ["illustration"] = "Illustration", ["graphic design"] = "Graphic design",
        ["photography"] = "Photography", ["art direction"] = "Art direction", ["creative direction"] = "Creative direction", ["liner notes"] = "Liner notes",
    };

    // How a part was played, not what: left off the role.
    private static readonly HashSet<string> Manner = new(StringComparer.Ordinal) { "guest", "solo", "additional", "minor", "original", "founder", "emeritus" };

    /* A relation's roles: the instruments or voices it names, or what its type is called. */
    public static List<string> RolesOf(string type, IEnumerable<string> attributes)
    {
        var said = attributes.Select(a => Js.Trim(a)).Where(a => a.Length > 0).ToList();
        var kinds = said.Where(a => !Manner.Contains(a)).Select(Cap).Where(a => a.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        switch (type)
        {
            case "instrument": return kinds.Count > 0 ? kinds : new List<string> { "Instruments" };
            case "vocal": return kinds.Count > 0 ? kinds : new List<string> { "Vocals" };
            case "producer":
                return [said.Contains("executive") ? "Executive producer" : said.Contains("co") ? "Co-producer" : said.Contains("assistant") ? "Assistant producer" : "Producer"];
            default: return TypeRoles.TryGetValue(type, out var r) ? new List<string> { r } : new List<string>();
        }
    }

    private static void AddRelation(List<Credit> list, int track, object? r0)
    {
        if (r0 is not JsObj r || r["artist"] is not JsObj a) return;
        var name = N(r["target-credit"]) ?? N(a["name"]);
        if (name == null) return;
        foreach (var role in RolesOf(S(r["type"]), L(r["attributes"]).Select(S)))
            list.Add(new Credit(track, name, N(a["id"]), role, "musicbrainz"));
    }

    private static double Position(object? v) => Js.Truthy(v) ? Js.ToNumber(v) : 0;

    /* A release's credits (asked with its recordings' and works' relations): the release's own on 0, each track's by its place. */
    public static List<Credit> FromRelease(JsObj rel)
    {
        var list = new List<Credit>();
        foreach (var r in L(rel["relations"])) AddRelation(list, 0, r);
        var n = 0;
        foreach (var m in L(rel["media"]).Select(O).OrderBy(m => Position(m["position"])))
        {
            foreach (var t in L(m["tracks"]).Select(O).OrderBy(t => Position(t["position"])))
            {
                n++;
                if (t["recording"] is not JsObj rec) continue;
                foreach (var r in L(rec["relations"]))
                {
                    AddRelation(list, n, r);
                    // The work recorded, and its writers.
                    if (r is JsObj wr && wr["work"] is JsObj w) foreach (var x in L(w["relations"])) AddRelation(list, n, x);
                }
            }
        }
        return list;
    }

    /* The acts a release is credited to, with their MusicBrainz ids. */
    public static List<(string Name, string Mbid)> ReleaseActs(JsObj rel) =>
        L(rel["artist-credit"]).Select(O).Select(c => (N(c["name"]) ?? N(O(c["artist"])["name"]), N(O(c["artist"])["id"])))
            .Where(x => x.Item1 != null && x.Item2 != null).Select(x => (x.Item1!, x.Item2!)).ToList();

    // ---------------------------------------------------------------- the album's rows

    private static readonly HashSet<string> Writing = new(StringComparer.Ordinal) { "Composer", "Lyricist", "Writer", "Librettist", "Translator" };
    private static readonly HashSet<string> Making = new(StringComparer.Ordinal)
    {
        "Producer", "Executive producer", "Co-producer", "Assistant producer", "Engineer", "Sound engineer", "Recording engineer", "Mixing",
        "Mastering", "Balance engineer", "Editor", "Programming", "Remixer", "DJ mix", "Arranger", "Vocal arranger", "Orchestrator",
    };
    private static readonly HashSet<string> Art = new(StringComparer.Ordinal)
    {
        "Design", "Illustration", "Graphic design", "Photography", "Art direction", "Creative direction", "Liner notes",
    };

    /* Where a role comes in the list: players and singers 0, writers 1, those who made the record 2, its sleeve 3. */
    public static int Rank(string role) => Writing.Contains(role) ? 1 : Making.Contains(role) ? 2 : Art.Contains(role) ? 3 : 0;

    /* The credits as the album page lists them: one row a name, the tracks it is on (none: every one of [trackCount]). */
    public static List<AlbumCredit> Merge(IEnumerable<Credit> credits, int trackCount)
    {
        var rows = new Dictionary<string, (string Name, string? Mbid, List<string> Roles, SortedSet<int> Tracks, bool Whole, string Source)>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var c in credits)
        {
            var key = Names.ArtistKey(c.Name);
            if (key.Length == 0 || c.Role.Length == 0) continue;
            if (!rows.TryGetValue(key, out var row))
            {
                row = (c.Name, c.Mbid, new List<string>(), new SortedSet<int>(), false, c.Source);
                order.Add(key);
            }
            if (!row.Roles.Contains(c.Role, StringComparer.OrdinalIgnoreCase)) row.Roles.Add(c.Role);
            if (c.Track <= 0) row.Whole = true; else row.Tracks.Add(c.Track);
            row.Mbid ??= c.Mbid;
            // MusicBrainz's name and source over a tag's, where both have it.
            if (c.Source == "musicbrainz" && row.Source != "musicbrainz") { row.Name = c.Name; row.Source = c.Source; }
            rows[key] = row;
        }
        return order.Select(k =>
            {
                var r = rows[k];
                var all = r.Whole || (trackCount > 0 && r.Tracks.Count >= trackCount);
                var roles = r.Roles.OrderBy(Rank).ToList();
                return new AlbumCredit(k, r.Name, r.Mbid, roles, all ? new List<int>() : r.Tracks.ToList(), r.Source);
            })
            .OrderBy(c => c.Roles.Count > 0 ? c.Roles.Min(Rank) : 9)
            .ThenByDescending(c => c.Tracks.Count == 0 ? int.MaxValue : c.Tracks.Count)
            .ThenBy(c => c.Key, StringComparer.Ordinal)
            .ToList();
    }

    // ---------------------------------------------------------------- MusicBrainz's artist

    // The links kept, by MusicBrainz's name for them.
    private static readonly Dictionary<string, string> LinkKinds = new(StringComparer.Ordinal)
    {
        ["wikidata"] = "wikidata", ["wikipedia"] = "wikipedia", ["discogs"] = "discogs", ["allmusic"] = "allmusic",
        ["official homepage"] = "official", ["bandcamp"] = "bandcamp", ["last.fm"] = "lastfm", ["soundcloud"] = "soundcloud", ["youtube"] = "youtube",
    };

    private static Member MemberOf(JsObj r, JsObj a) => new(N(r["target-credit"]) ?? S(a["name"]), N(a["id"]), N(r["begin"]), N(r["end"]),
        Js.Truthy(r["ended"]), RolesOf("instrument", L(r["attributes"]).Select(S)).Where(x => x != "Instruments").ToList());

    /* Two stints of one person in one band as one: the earliest start, the latest end, every part played. */
    private static List<Member> Together(IEnumerable<Member> stints) =>
        stints.GroupBy(m => m.Mbid ?? Names.ArtistKey(m.Name), StringComparer.Ordinal).Select(g =>
        {
            var all = g.ToList();
            var open = all.Any(m => !m.Ended && m.End == null);
            var begin = all.Select(m => m.Begin).Where(b => b != null).OrderBy(b => b, StringComparer.Ordinal).FirstOrDefault();
            var end = open ? null : all.Select(m => m.End).Where(e => e != null).OrderByDescending(e => e, StringComparer.Ordinal).FirstOrDefault();
            return new Member(all[0].Name, all[0].Mbid, begin, end, !open, all.SelectMany(m => m.Roles).Distinct(StringComparer.Ordinal).ToList());
        }).ToList();

    /* An artist asked with its artist and URL relations: a band's members ("member of band", backward) and a person's bands (forward). */
    public static ArtistFacts ArtistOf(JsObj a)
    {
        var members = new List<Member>();
        var bands = new List<Member>();
        var links = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var r in L(a["relations"]).Select(O))
        {
            var type = S(r["type"]);
            if (type == "member of band" && r["artist"] is JsObj other)
            {
                if (S(r["direction"]) == "backward") members.Add(MemberOf(r, other)); else bands.Add(MemberOf(r, other));
            }
            else if (r["url"] is JsObj u && N(u["resource"]) is { } url && LinkKinds.TryGetValue(type, out var kind) && !links.ContainsKey(kind))
                links[kind] = url;
        }
        var life = O(a["life-span"]);
        return new ArtistFacts(N(a["id"]), S(a["name"]), N(a["type"]), N(a["disambiguation"]), N(life["begin"]), N(life["end"]), Js.Truthy(life["ended"]),
            N(O(a["area"])["name"]), Together(members), Together(bands), links);
    }

    /* The act on a name search: the first whose name is the one asked (a leading "The" aside). */
    public static string? FoundMbid(JsObj search, string name) =>
        L(search["artists"]).Select(O).FirstOrDefault(x => Extras.WriteUps.NamesEqualLoose(x["name"], name)) is { } act ? N(act["id"]) : null;

    // ---------------------------------------------------------------- pictures

    public const string CommonsFilePath = "https://commons.wikimedia.org/wiki/Special:FilePath/";

    [GeneratedRegex(@"(Q[0-9]+)/?$")]
    private static partial Regex WikidataQ();

    /* "https://www.wikidata.org/wiki/Q11649" → "Q11649". */
    public static string? WikidataId(string? url) => url != null && WikidataQ().Match(url) is { Success: true } m ? m.Groups[1].Value : null;

    /* Wikidata's picture of the act (P18), as Wikimedia Commons serves it 640 wide: null without one. */
    public static string? WikidataPhoto(JsObj data, string qid)
    {
        var claims = O(O(O(data["entities"])[qid])["claims"]);
        foreach (var c in L(claims["P18"]).Select(O))
            if (N(O(O(c["mainsnak"])["datavalue"])["value"]) is { } file)
                return CommonsFilePath + Uri.EscapeDataString(file.Replace(' ', '_')) + "?width=640";
        return null;
    }

    /* FanArt.tv's first portrait of the act (its artist thumbs). */
    public static string? FanartPhoto(JsObj data) => L(data["artistthumb"]).Select(O).Select(t => N(t["url"])).FirstOrDefault(u => u != null);

    /* Deezer's picture of the act on a name search: the first of that name with a picture of its own (Deezer's blank has no id in its address). */
    public static string? DeezerPhoto(JsObj search, string name) =>
        L(search["data"]).Select(O).Where(x => Extras.WriteUps.NamesEqualLoose(x["name"], name))
            .Select(x => N(x["picture_xl"]) ?? N(x["picture_big"])).FirstOrDefault(u => u != null && !u.Contains("/artist//", StringComparison.Ordinal));

    /* An address as the image route takes it (a "u-" key, CoversDrawn.ForeignUrl reads it back). */
    public static string? PhotoKey(string? url) => string.IsNullOrEmpty(url) ? null
        : "u-" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(url)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
