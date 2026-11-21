// ShelfRoutes.cs — what the Shelf screen (/shelf) is given: lib/shelf.js and
// its route in lib/server/api-library.js, in the same shape. The whole library
// in the Library wall's artist order, each album's genres as places in a list
// of genres (commonest first), the letter its artist is filed under and its
// year (v0.8.27); and Mandarin's version (v0.8.28). Since item 206 (Rouen's
// Shelf v1.9.67 to v1.9.69-t1): each album's catalogue number, the kinds of
// release it is, its format and the version its title ends with (ShelfFacts.cs),
// for the Types tile, the catalogue order and the spine's foot (its record label
// taken out with the labels, item 492);
// and the kinds' names, so the page keeps no copy. Since item 208: the Format
// tile each album is under (ShelfFormats.cs), the tiles in their order, and
// whether it is a favourite. The page filters it itself; one answer per
// library and its favourites, built once and kept with the copy of the library
// it was built from. test/library-front.test.js holds the two servers' answers to
// each other.
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal sealed partial class Snapshot
{
    // Shelf's answer, made the first time it is asked of this copy.
    public ShelfAnswer? Shelf;
}

internal sealed record ShelfAnswer(JsonArray Genres, JsonArray Formats, JsonArray Albums, int Total, string Sig, long Marks = 0);

internal static partial class Library
{
    private static Task<bool> ShelfAlbums(HttpContext ctx, Snapshot s, LibState st)
    {
        // Shelf switched off (v1.0.2, Features.cs): its list is never made.
        if (!Features.On(Features.Shelf)) return JsError(ctx, 403, "Shelf is turned off in Settings");
        if (st.Building) return NotReady(ctx);
        var shelf = s.Shelf;
        var marks = s.Marks;
        // made again when a favourite is added or taken off (item 208: the Favourites tile)
        if (shelf == null || shelf.Marks != marks.N)
        {
            using var c = Db.Open();
            shelf = BuildShelf(View(name => name == "sort" ? ["artist"] : null, s), ShelfFormats.Channels(c), al => marks.Fav.ContainsKey(al.Key), marks.N);
            s.Shelf = shelf;
        }
        if (Q(ctx, "sig") is { Length: > 0 } sig && sig == shelf.Sig)
            return Send(ctx, new JsonObject { ["same"] = true, ["sig"] = shelf.Sig });
        return Send(ctx, new JsonObject
        {
            ["total"] = shelf.Total,
            ["sig"] = shelf.Sig,
            ["version"] = Server.Version,
            ["genres"] = shelf.Genres.DeepClone(),
            ["formats"] = shelf.Formats.DeepClone(),
            ["kinds"] = ShelfFacts.KindsJson(),
            ["albums"] = shelf.Albums.DeepClone()
        });
    }

    /* shelfBucket: A–Z, 1–9 or "#", from the folded sort name the order sorts by. */
    public static string ShelfBucket(string? sortArtist)
    {
        var f = Names.Fold(sortArtist);
        if (f.Length == 0) return "#";
        var c = f[0];
        if (c is >= 'a' and <= 'z') return char.ToUpperInvariant(c).ToString();
        if (c is >= '1' and <= '9') return c.ToString();
        return "#";
    }

    /* buildShelf and shelfSignature. channels: the most channels its tracks have, by album id; favourite: whether it is one; marks: the favourites' count it was made at. */
    internal static ShelfAnswer BuildShelf(List<Album> albums, IReadOnlyDictionary<long, long>? channels = null,
        Func<Album, bool>? favourite = null, long marks = 0)
    {
        var tiles = albums.Select(al => ShelfFormats.TileOf(al, channels != null && channels.TryGetValue(al.Id, out var ch) ? ch : null)).ToList();
        var counts = new Dictionary<string, int>();
        var order = new List<string>();
        var perAlbum = new List<List<string>>(albums.Count);
        foreach (var al in albums)
        {
            var names = new List<string>();
            foreach (var g in al.Genres) if (!string.IsNullOrEmpty(g) && !names.Contains(g)) names.Add(g);
            perAlbum.Add(names);
            foreach (var n in names)
            {
                if (counts.TryGetValue(n, out var k)) counts[n] = k + 1;
                else { counts[n] = 1; order.Add(n); }
            }
        }
        var genres = Sorted(order, (a, b) => Or(counts[b].CompareTo(counts[a]), () => Lc(a, b)));
        var index = new Dictionary<string, int>();
        for (int i = 0; i < genres.Count; i++) index[genres[i]] = i;

        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA1);
        void Add(string text) => sha.AppendData(Encoding.UTF8.GetBytes(text));

        var gOut = new JsonArray();
        foreach (var g in genres)
        {
            gOut.Add(new JsonObject { ["name"] = g, ["count"] = counts[g] });
            Add(g + "\u0001" + counts[g].ToString(CultureInfo.InvariantCulture) + "\u0002");
        }
        Add("\u0003");
        var fOut = new JsonArray(ShelfFormats.Ordered(tiles.OfType<ShelfFormats.Tile>()).Select(n => (JsonNode)n).ToArray());
        Add(string.Join("\u0001", fOut.Select(n => (string)n!)) + "\u0003");
        var aOut = new JsonArray();
        for (int i = 0; i < albums.Count; i++)
        {
            var al = albums[i];
            var gi = perAlbum[i].Select(n => index[n]).Order().ToList();
            var b = ShelfBucket(al.SortArtist);
            var k = string.IsNullOrEmpty(al.ImageKey) ? null : al.ImageKey;
            long? y = al.Year is long yr && yr != 0 ? yr : null;
            // item 206: the catalogue number, the kinds, the format, the version (ShelfFacts.cs)
            var kinds = ShelfFacts.KindsOf(al.MbType, al.Compilation);
            var fm = ShelfFacts.FormatOf(al);
            var v = ShelfFacts.SplitVersion(al.Title);
            var q = tiles[i]?.Name;
            var fv = favourite?.Invoke(al) ?? false;
            aOut.Add(new JsonObject
            {
                ["o"] = al.Id,
                ["t"] = al.Title,
                ["a"] = al.Artist,
                ["k"] = k,
                ["g"] = new JsonArray(gi.Select(x => (JsonNode)x).ToArray()),
                ["b"] = b,
                ["y"] = y,
                ["c"] = al.Catno,
                ["ty"] = kinds == null ? null : new JsonArray(kinds.Select(x => (JsonNode)x).ToArray()),
                ["fm"] = fm,
                ["v"] = v is { } ver ? new JsonArray(ver.Base, ver.Version) : null,
                ["q"] = q,
                ["fv"] = fv
            });
            Add(string.Join("\u0001", al.Id.ToString(CultureInfo.InvariantCulture), al.Title, al.Artist, k ?? "",
                string.Join(",", gi.Select(x => x.ToString(CultureInfo.InvariantCulture))), b,
                y?.ToString(CultureInfo.InvariantCulture) ?? "", al.Catno ?? "",
                kinds == null ? "" : string.Join(",", kinds), fm ?? "", v is { } vv ? vv.Base + "\u0004" + vv.Version : "", q ?? "", fv ? "1" : "") + "\u0002");
        }
        var sig = Convert.ToHexStringLower(sha.GetHashAndReset())[..16];
        return new ShelfAnswer(gOut, fOut, aOut, albums.Count, sig, marks);
    }
}
