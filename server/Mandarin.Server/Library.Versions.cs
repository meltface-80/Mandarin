// Library.Versions.cs — versions of one album (item 345): the original and a 2015 remaster of Metallic 'KO, two albums
// of the library with nothing to tell them apart, are one album with two versions. Versions are albums of one MusicBrainz
// release group (their tags' MUSICBRAINZ_RELEASEGROUPID, or their applied match's), else of one act and one title once its
// version words are taken off ("Metallic 'KO (2015 Remaster)"): never two of different release groups, and never two of
// one title from different years with no word of an edition between them (Peter Gabriel's four "Peter Gabriel"). A
// compilation, a box set's disc and a service's album are each their own. The lists show the main version alone, with how
// many there are; the album's page lists every version (LibraryRoutes.Versions.cs). The main version is the one chosen on
// an album's page, else the highest resolution, the newest release where two are alike. Each version says what tells it
// from the others: its edition (MusicBrainz's word, else its title's version words), else its release's year, else
// Original for the earliest; and its format, "2015 Remaster · 24/96".
using System.Globalization;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal sealed partial class Album
{
    /* The version the lists show, where this album is one of several versions; null where it is the only one. */
    public long? MainVersion;
    /* Every version of it, the main first, then by release; null where it is the only one. */
    public List<long>? Versions;
    /* What tells this version from the others ("2015 Remaster · 24/96"); null where it is the only one. */
    public string? VersionLabel;
    /* Its own release's year, where its match says (a remaster's, where Year is the original's). */
    public long? ReleaseYear;
}

internal sealed partial class Snapshot
{
    /* The albums the lists show: every album but a version that isn't its album's main (item 345). */
    public List<Album> Shown = [];
}

internal static partial class Library
{
    /* The setting that keeps the versions chosen as main on their album's page: their albums' keys. */
    public const string MainVersionsSetting = "albumVersionsMain";

    /* Whether lists show [al]: an album of one version, or the main of its versions. */
    public static bool Listed(Album al) => al.MainVersion == null || al.MainVersion == al.Id;

    private static void Versions(SqliteConnection c, Snapshot s)
    {
        var facts = new Dictionary<long, (string? Group, long? Year, string? Edition)>();
        try
        {
            foreach (var r in Rows(c, @"SELECT a.id, a.mb_group, json_extract(m.candidate, '$.group_mbid'), json_extract(m.candidate, '$.release_year'),
                                              json_extract(m.candidate, '$.edition')
                                         FROM albums a LEFT JOIN album_matches m ON m.key = a.key AND m.status = 'applied'"))
                facts[(long)r[0]!] = (Text(r[1]) ?? Text(r[2]), Long(r[3]), Text(r[4]));
        }
        catch (SqliteException) { s.Shown = s.Albums; return; }   // a database from before the columns
        var chosen = MainVersionKeys(c);
        foreach (var al in s.Albums) { al.MainVersion = null; al.Versions = null; al.VersionLabel = null; al.ReleaseYear = facts.TryGetValue(al.Id, out var f) ? f.Year : null; }

        var pool = s.Albums.Where(al => !al.Compilation && !al.Transient && al.Service == null && al.Box == null && al.ArtistNames.Length > 0).ToList();
        string? Group(Album al) => facts.TryGetValue(al.Id, out var f) ? f.Group : null;
        string? Edition(Album al) => (facts.TryGetValue(al.Id, out var f) ? f.Edition : null) is { Length: > 0 } e ? e : ShelfFacts.SplitVersion(al.Title)?.Version;
        var parent = pool.ToDictionary(al => al.Id, al => al.Id);
        long Root(long x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
        void Join(long a, long b) { a = Root(a); b = Root(b); if (a != b) parent[Math.Max(a, b)] = Math.Min(a, b); }

        // One release group: versions.
        foreach (var g in pool.Where(al => Group(al) != null).GroupBy(al => Group(al)!, StringComparer.OrdinalIgnoreCase))
            foreach (var al in g.Skip(1)) Join(g.First().Id, al.Id);
        // One act and one title: versions, where nothing says they are not.
        foreach (var g in pool.GroupBy(al => ActKey(al) + "|" + Names.Fold(ShelfFacts.SplitVersion(al.Title)?.Base ?? al.Title), StringComparer.Ordinal))
        {
            var list = g.ToList();
            if (list.Count < 2 || list.Select(Group).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase).Count() > 1) continue;   // two releases of one title
            for (var i = 0; i < list.Count; i++)
                for (var j = i + 1; j < list.Count; j++)
                    if (list[i].Year == list[j].Year || Edition(list[i]) != null || Edition(list[j]) != null) Join(list[i].Id, list[j].Id);
        }

        foreach (var set in pool.GroupBy(al => Root(al.Id)).Select(g => g.ToList()).Where(l => l.Count > 1))
        {
            var main = set.FirstOrDefault(al => chosen.Contains(al.Key)) ?? set.OrderByDescending(al => al.Lossless).ThenByDescending(al => al.Rate ?? 0)
                .ThenByDescending(al => al.Bits ?? 0).ThenByDescending(al => al.ReleaseYear ?? al.Year ?? 0).ThenByDescending(al => al.Added ?? 0).ThenBy(al => al.Id).First();
            var order = new List<long> { main.Id };
            order.AddRange(set.Where(al => al != main).OrderBy(al => al.ReleaseYear ?? al.Year ?? long.MaxValue).ThenBy(al => al.Id).Select(al => al.Id));
            // Its edition, else its release's year where it isn't the original's; the one left with neither is the original.
            string? Own(Album al) => Edition(al) ?? (al.ReleaseYear is long ry && ry != al.Year ? ry.ToString(CultureInfo.InvariantCulture) + " release" : null);
            var bare = set.Where(al => Own(al) == null).ToList();
            foreach (var al in set)
            {
                al.MainVersion = main.Id;
                al.Versions = order;
                var what = Own(al) ?? (bare.Count == 1 ? "Original" : null);
                var format = QualityOf(al).Quality;
                al.VersionLabel = string.Join(" · ", new[] { what, format }.Where(x => !string.IsNullOrEmpty(x)));
            }
        }
        s.Shown = s.Albums.Where(Listed).ToList();
    }

    /* The keys of the albums chosen as the main of their versions. */
    private static HashSet<string> MainVersionKeys(SqliteConnection c)
    {
        var keys = new HashSet<string>(StringComparer.Ordinal);
        try { if (Db.Setting(c, MainVersionsSetting) is System.Text.Json.Nodes.JsonArray a) foreach (var k in a) if (k?.GetValue<string>() is { Length: > 0 } key) keys.Add(key); }
        catch (Exception e) when (e is SqliteException or InvalidOperationException or FormatException) { /* none kept, or not as kept: none */ }
        return keys;
    }
}
