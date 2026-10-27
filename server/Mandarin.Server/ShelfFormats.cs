// ShelfFormats.cs — the Shelf's Format tiles (item 208, a user's request): each
// album under one, by what its files are —
//   - PCM by bits and rate, "16/44.1", "24/96" (or the rate alone, "96 kHz",
//     where the bits aren't known);
//   - DSD by its rate as DSD64, DSD128 …, and its channels as SACD says them:
//     "DSD64 2CH", "DSD64 Multichannel";
//   - anything over two channels is Multichannel: "24/96 Multichannel";
//   - a lossy album by its kind, "MP3", "AAC", or the service it streams from,
//     "TIDAL"; a lossless one nothing is known of by its container, "FLAC".
// The tiles in their order: PCM, by bits then rate, stereo before
// multichannel; then DSD by rate; then the rest by name. The channels are the
// most any of an album's tracks has (tracks.channels).
using System.Globalization;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static class ShelfFormats
{
    /* A tile: its name, and where it stands among the others. */
    internal sealed record Tile(string Name, int Family, long Bits, long Rate, bool Multi);

    private const long DsdBase = 44100;

    /* The most channels each album's tracks have, by album id; an album none of whose tracks says is left out. */
    public static Dictionary<long, long> Channels(SqliteConnection c)
    {
        var m = new Dictionary<long, long>();
        foreach (var r in Library.Rows(c, "SELECT album_id, MAX(channels) FROM tracks WHERE channels IS NOT NULL GROUP BY album_id"))
            if (r[0] is long id && r[1] is long ch) m[id] = ch;
        return m;
    }

    /* The tile an album is under, or null when nothing is known of its files. [channels]: the most its tracks have. */
    public static Tile? TileOf(Album al, long? channels)
    {
        var multi = channels > 2;
        if (al.Container == "DSD")
        {
            var times = al.Rate is long r && r >= DsdBase ? r / DsdBase : 0;
            var dsd = times > 0 ? "DSD" + times.ToString(CultureInfo.InvariantCulture) : "DSD";
            return new Tile(dsd + (multi ? " Multichannel" : " 2CH"), 1, 0, times, multi);
        }
        if (al.Lossless && (al.Bits != null || al.Rate != null))
        {
            var q = al.Bits is not long b ? ShelfFacts.RateShort(al.Rate!.Value) + " kHz"
                : al.Rate is long rate ? b + "/" + ShelfFacts.RateShort(rate) : b + "-bit";
            // the bits not known: after those that are
            return new Tile(q + (multi ? " Multichannel" : ""), 0, al.Bits ?? 99, al.Rate ?? 0, multi);
        }
        var name = al.Container ?? ShelfFacts.FormatOf(al) ?? ServiceName(al.Service);
        return name == null ? null : new Tile(name + (multi ? " Multichannel" : ""), 2, 0, 0, multi);
    }

    private static string? ServiceName(string? service) =>
        string.IsNullOrEmpty(service) ? null : char.ToUpperInvariant(service[0]) + service[1..];

    /* The tiles' names in their order. */
    public static List<string> Ordered(IEnumerable<Tile> tiles) =>
        tiles.GroupBy(t => t.Name).Select(g => g.First())
            .OrderBy(t => t.Family).ThenBy(t => t.Bits).ThenBy(t => t.Rate).ThenBy(t => t.Multi)
            .ThenBy(t => t.Name, StringComparer.OrdinalIgnoreCase).Select(t => t.Name).ToList();
}
