// DiscToc.cs — an album's CD table of contents, worked out from its tracks' exact lengths (item 414): what
// MusicBrainz's fuzzy disc lookup is asked with (MusicBrainz.ByToc), for an album whose name finds nothing.
//
// A CD is 75 sectors a second (588 samples at 44.1 kHz); its first track starts at sector 150 (the two-second
// lead-in) and each track where the one before ends; the lead-out is where the last one ends. Only an album that
// could be a CD rip is asked: every track lossless, at 44.1 kHz, its length known, at most 99 tracks and about 80
// minutes a disc. A set is asked disc by disc, each disc its own table.
using Microsoft.Data.Sqlite;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal static class DiscToc
{
    public const int SectorsPerSecond = 75;
    public const int Lead = 150;
    public const int MaxTracks = 99;
    public const double MaxSeconds = 81 * 60;   // an 80-minute disc, and its slack

    /// <summary>One track as the table is made from it: its disc, its length in seconds, and whether a CD could hold it as it is.</summary>
    public sealed record Track(double Disc, double? Seconds, bool Lossless, double? Rate);

    /// <summary>"first last leadout offset1 … offsetN" for one disc's tracks in order; null when they couldn't be a CD.</summary>
    public static string? Toc(IReadOnlyList<Track> tracks)
    {
        if (tracks.Count == 0 || tracks.Count > MaxTracks) return null;
        var offsets = new List<long>(tracks.Count);
        long at = Lead;
        double total = 0;
        foreach (var t in tracks)
        {
            if (!t.Lossless || t.Rate != 44100 || t.Seconds is not double s || !(s > 0)) return null;
            offsets.Add(at);
            at += (long)Math.Round(s * SectorsPerSecond, MidpointRounding.AwayFromZero);
            total += s;
        }
        if (total > MaxSeconds) return null;
        return string.Join(' ', new[] { 1L, tracks.Count, at }.Concat(offsets));
    }

    /// <summary>Each disc's table, in disc order: none at all when any disc couldn't be a CD.</summary>
    public static List<string> Tocs(IEnumerable<Track> tracks)
    {
        var tocs = new List<string>();
        foreach (var disc in tracks.GroupBy(t => t.Disc).OrderBy(g => g.Key))
        {
            var toc = Toc([.. disc]);
            if (toc == null) return [];
            tocs.Add(toc);
        }
        return tocs;
    }

    /// <summary>The album's tables from its tracks in the database (Identifier.Input), in playing order.</summary>
    public static List<string> Of(SqliteConnection c, long albumId)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = @"SELECT disc_no, duration, lossless, sample_rate FROM tracks WHERE album_id = $id
                            ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path";
        cmd.Parameters.AddWithValue("$id", albumId);
        using var r = cmd.ExecuteReader();
        var tracks = new List<Track>();
        while (r.Read())
        {
            var disc = r.IsDBNull(0) ? 1 : r.GetDouble(0);
            tracks.Add(new Track(disc == 0 ? 1 : disc, r.IsDBNull(1) ? null : r.GetDouble(1), !r.IsDBNull(2) && r.GetInt64(2) != 0,
                r.IsDBNull(3) ? null : r.GetDouble(3)));
        }
        return Tocs(tracks);
    }

    /// <summary>The tables a test names, for `mandarin-server score`'s discToc: [{ disc, seconds, lossless, rate }].</summary>
    public static List<object?> Call(object? tracks) =>
        [.. Tocs((tracks as List<object?> ?? []).OfType<JsObj>().Select(t => new Track(Js.Truthy(t["disc"]) ? Js.ToNumber(t["disc"]) : 1,
            Js.IsNullish(t["seconds"]) ? null : Js.ToNumber(t["seconds"]), Js.Truthy(t["lossless"]), Js.IsNullish(t["rate"]) ? null : Js.ToNumber(t["rate"]))))];
}
