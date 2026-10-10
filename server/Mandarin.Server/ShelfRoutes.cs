// ShelfRoutes.cs — what the Shelf screen (/shelf) is given: lib/shelf.js and
// its route in lib/server/api-library.js, in the same shape. The whole library
// in the Library wall's artist order, each album's genres as places in a list
// of genres (commonest first), the letter its artist is filed under and its
// year (v0.8.27); and Mandarin's version (v0.8.28). The page filters it itself; one
// answer per library, built once and kept with the copy of the library it was
// built from. test/library-front.test.js holds the two servers' answers to
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

internal sealed record ShelfAnswer(JsonArray Genres, JsonArray Albums, int Total, string Sig);

internal static partial class Library
{
    private static Task<bool> ShelfAlbums(HttpContext ctx, Snapshot s, LibState st)
    {
        if (st.Building) return NotReady(ctx);
        var shelf = s.Shelf;
        if (shelf == null)
        {
            shelf = BuildShelf(View(name => name == "sort" ? ["artist"] : null, s));
            s.Shelf = shelf;
        }
        if (Q(ctx, "sig") is { Length: > 0 } sig && sig == shelf.Sig)
            return Send(ctx, new JsonObject { ["same"] = true, ["sig"] = shelf.Sig });
        return Send(ctx, new JsonObject
        {
            ["total"] = shelf.Total,
            ["sig"] = shelf.Sig,
            ["version"] = Front.Version,
            ["genres"] = shelf.Genres.DeepClone(),
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

    /* buildShelf and shelfSignature. */
    private static ShelfAnswer BuildShelf(List<Album> albums)
    {
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
        var aOut = new JsonArray();
        for (int i = 0; i < albums.Count; i++)
        {
            var al = albums[i];
            var gi = perAlbum[i].Select(n => index[n]).Order().ToList();
            var b = ShelfBucket(al.SortArtist);
            var k = string.IsNullOrEmpty(al.ImageKey) ? null : al.ImageKey;
            long? y = al.Year is long yr && yr != 0 ? yr : null;
            aOut.Add(new JsonObject
            {
                ["o"] = al.Id,
                ["t"] = al.Title,
                ["a"] = al.Artist,
                ["k"] = k,
                ["g"] = new JsonArray(gi.Select(x => (JsonNode)x).ToArray()),
                ["b"] = b,
                ["y"] = y
            });
            Add(string.Join("\u0001", al.Id.ToString(CultureInfo.InvariantCulture), al.Title, al.Artist, k ?? "",
                string.Join(",", gi.Select(x => x.ToString(CultureInfo.InvariantCulture))), b,
                y?.ToString(CultureInfo.InvariantCulture) ?? "") + "\u0002");
        }
        var sig = Convert.ToHexStringLower(sha.GetHashAndReset())[..16];
        return new ShelfAnswer(gOut, aOut, albums.Count, sig);
    }
}
