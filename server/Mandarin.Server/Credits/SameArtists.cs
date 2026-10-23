// SameArtists.cs — one artist however an album credits them (bug list item 151). MusicBrainz credits an artist under the
// name on the sleeve ("Mariana Semkina" on Disillusioned) while the artist is one entry with one id (Marjana Semkina),
// and Mandarin knew acts only by their names: the credit's spelling became a second artist, its album "appearing on"
// the first's page. Mandarin's own lookups (CreditFinder) already keep each act's MusicBrainz id, in artist_info and in
// album_credits; names that share an id are one artist, written the one way here: as MusicBrainz names the artist
// (kept from the lookup, CreditStore.AboutJson's "mb_name") when that is one of them, else as most of the library does.
// A name that is two artists' (two ids) is left alone: it says nothing about which.
using Microsoft.Data.Sqlite;
using System.Text.Json.Nodes;

namespace Mandarin.Server.Credits;

internal sealed class SameArtists
{
    private readonly Dictionary<string, string> canon;   // a name's ArtistKey → how the library writes that artist

    private SameArtists(Dictionary<string, string> canon) => this.canon = canon;

    public static readonly SameArtists None = new([]);

    public int Count => canon.Count;

    /* From what the lookups kept, [albumArtists] (each album's artist as it stands) counting each spelling's albums. */
    public static SameArtists Of(SqliteConnection c, IEnumerable<string> albumArtists)
    {
        var names = new List<(string Key, string Name, string Mbid, string? MbName)>();
        if (Has(c, "artist_info"))
            foreach (var r in Library.Rows(c, "SELECT key, name, mbid, about FROM artist_info WHERE mbid IS NOT NULL AND mbid <> ''"))
                names.Add(((string)r[0]!, (string)r[1]!, (string)r[2]!, MbName(r[3] as string)));
        if (Has(c, "album_credits"))
            foreach (var r in Library.Rows(c, "SELECT DISTINCT key, name, mbid FROM album_credits WHERE mbid IS NOT NULL AND mbid <> ''"))
                names.Add(((string)r[0]!, (string)r[1]!, (string)r[2]!, null));
        return From(names, albumArtists);
    }

    /* The rule itself, from (key, name, MusicBrainz id, MusicBrainz's own name) as kept. */
    public static SameArtists From(IEnumerable<(string Key, string Name, string Mbid, string? MbName)> names, IEnumerable<string> albumArtists)
    {
        var albums = new Dictionary<string, Dictionary<string, int>>();   // key → spelling → albums
        foreach (var a in albumArtists)
            foreach (var n in Names.SplitArtists(a))
            {
                var k = Names.ArtistKey(n);
                if (k.Length == 0) continue;
                var s = albums.TryGetValue(k, out var m) ? m : albums[k] = [];
                s[n] = s.GetValueOrDefault(n) + 1;
            }
        var ids = new Dictionary<string, HashSet<string>>();          // key → its ids
        var byId = new Dictionary<string, Dictionary<string, string>>(); // id → key → a name for it
        var mbName = new Dictionary<string, string>();
        foreach (var (key, name, mbid, mb) in names)
        {
            if (key.Length == 0) continue;
            (ids.TryGetValue(key, out var s) ? s : ids[key] = []).Add(mbid);
            (byId.TryGetValue(mbid, out var m) ? m : byId[mbid] = []).TryAdd(key, name);
            if (!string.IsNullOrWhiteSpace(mb)) mbName.TryAdd(mbid, mb);
        }
        var canon = new Dictionary<string, string>();
        foreach (var (mbid, keys) in byId)
        {
            var ks = keys.Keys.Where(k => ids[k].Count == 1).ToList();
            if (ks.Count < 2) continue;
            // How the library writes a key: its commonest spelling, else as the lookup kept it.
            string Written(string k) => albums.TryGetValue(k, out var s) && s.Count > 0 ? s.MaxBy(x => x.Value).Key : keys[k];
            int Count(string k) => albums.TryGetValue(k, out var s) ? s.Values.Sum() : 0;
            var mbKey = mbName.TryGetValue(mbid, out var mn) ? Names.ArtistKey(mn) : null;
            var main = mbKey != null && ks.Contains(mbKey) ? mbKey
                : ks.OrderByDescending(Count).ThenBy(k => k, StringComparer.Ordinal).First();
            foreach (var k in ks) canon[k] = Written(main);
        }
        return new SameArtists(canon);
    }

    /* [artist] with each act in it written as that artist is: "Mariana Semkina" → "Marjana Semkina". */
    public string Rewrite(string artist)
    {
        if (canon.Count == 0) return artist;
        foreach (var n in Names.SplitArtists(artist))
        {
            if (!canon.TryGetValue(Names.ArtistKey(n), out var w) || w == n) continue;
            var at = artist.IndexOf(n, StringComparison.Ordinal);
            if (at >= 0) artist = string.Concat(artist.AsSpan(0, at), w, artist.AsSpan(at + n.Length));
        }
        return artist;
    }

    /* More than one name kept for the MusicBrainz artist [mbid]. */
    public static bool Shared(string mbid)
    {
        using var c = Db.Open();
        var keys = new HashSet<string>();
        if (Has(c, "artist_info")) foreach (var r in Library.Rows(c, "SELECT key FROM artist_info WHERE mbid = $1", mbid)) keys.Add((string)r[0]!);
        if (Has(c, "album_credits")) foreach (var r in Library.Rows(c, "SELECT DISTINCT key FROM album_credits WHERE mbid = $1", mbid)) keys.Add((string)r[0]!);
        return keys.Count > 1;
    }

    private static bool Has(SqliteConnection c, string table) =>
        Library.Rows(c, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $1", table).Count > 0;

    private static string? MbName(string? about)
    {
        try { return about != null && JsonNode.Parse(about) is JsonObject o && o["mb_name"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null; }
        catch (System.Text.Json.JsonException) { return null; }
    }
}
