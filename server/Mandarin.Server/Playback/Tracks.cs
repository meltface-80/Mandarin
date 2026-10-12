// Tracks.cs — the library as playback reads it (v0.8.49, stage 6): a track by
// its id and an album's tracks in playing order with corrected titles laid
// over (lib/library/index.js track() and tracks()), an album found by its
// names (relocate), a random album, the artists' keys, and the plays table's
// two reads (playedAlbumIdsSince, playStats). The rows come from the shared
// database, the albums from the library's copy (Library.cs).
using System.Globalization;
using System.Runtime.CompilerServices;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Playback;

using AJs = Mandarin.Server.Js;
using TJs = Mandarin.Server.Tags.Js;

/* A tracks row as lib/server/playback.js and the hub read it. */
internal sealed class PlayTrack
{
    public long Id, AlbumId, Mtime, Size;
    public string Path = "", Title = "", Artist = "", AlbumArtist = "", Album = "";
    public long? TrackNo, DiscNo, SampleRate, Bits, Channels;
    public double Duration;
    public string? Codec, Container;
    public bool Lossless;
    public double? RgTrackGain, RgTrackPeak, RgAlbumGain, RgAlbumPeak;

    /* The row as the ported helpers take it (StreamPlans.PlanFor, Gain.GainsFor): the fields they read, as JavaScript has them. */
    public JsObj ToJs()
    {
        var o = Jv.Obj(("id", (double)Id), ("album_id", (double)AlbumId), ("path", Path), ("codec", (object?)Codec ?? Undef.V),
            ("sample_rate", N(SampleRate)), ("bits", N(Bits)), ("channels", N(Channels)), ("mtime", (double)Mtime));
        o["rg_track_gain"] = D(RgTrackGain); o["rg_track_peak"] = D(RgTrackPeak);
        o["rg_album_gain"] = D(RgAlbumGain); o["rg_album_peak"] = D(RgAlbumPeak);
        return o;
    }
    private static object? N(long? v) => v == null ? null : (double)v.Value;
    private static object? D(double? v) => v == null ? null : v.Value;
}

internal static class Tracks
{
    private const string Order = "ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path";

    private static PlayTrack Row(object?[] r, Dictionary<string, int> col)
    {
        object? F(string name) => col.TryGetValue(name, out var i) ? r[i] : null;
        long? L(object? v) => v is long l ? l : v is double d ? (long)d : null;
        double? Dd(object? v) => v is double d ? d : v is long l ? l : null;
        string S(object? v) => v is string s ? s : v == null ? "" : Convert.ToString(v, CultureInfo.InvariantCulture) ?? "";
        return new PlayTrack
        {
            Id = (long)F("id")!, AlbumId = (long)F("album_id")!, Path = S(F("path")), Mtime = L(F("mtime")) ?? 0, Size = L(F("size")) ?? 0,
            Title = S(F("title")), Artist = S(F("artist")), AlbumArtist = S(F("album_artist")), Album = S(F("album")),
            TrackNo = L(F("track_no")), DiscNo = L(F("disc_no")), Duration = Dd(F("duration")) ?? 0,
            Codec = F("codec") as string, Container = F("container") as string,
            SampleRate = L(F("sample_rate")), Bits = L(F("bits")), Channels = L(F("channels")), Lossless = L(F("lossless")) is > 0,
            RgTrackGain = Dd(F("rg_track_gain")), RgTrackPeak = Dd(F("rg_track_peak")), RgAlbumGain = Dd(F("rg_album_gain")), RgAlbumPeak = Dd(F("rg_album_peak"))
        };
    }

    private static Dictionary<string, int> Columns(SqliteConnection c, string sql, params object[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        for (int i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("$" + (i + 1), args[i]);
        using var r = cmd.ExecuteReader(System.Data.CommandBehavior.SchemaOnly);
        var col = new Dictionary<string, int>();
        for (int i = 0; i < r.FieldCount; i++) col[r.GetName(i)] = i;
        return col;
    }

    /* library.tracks(albumId): in playing order, corrected titles laid over the tagged ones. */
    public static List<PlayTrack> OfAlbum(SqliteConnection c, Snapshot s, long albumId)
    {
        var sql = "SELECT * FROM tracks WHERE album_id = $1 " + Order;
        var col = Columns(c, sql, albumId);
        var rows = Library.Rows(c, sql, albumId).Select(r => Row(r, col)).ToList();
        var al = s.Find(albumId);
        if (al == null || !s.TrackEdits.TryGetValue(al.Key, out var edits) || edits.Count == 0) return rows;
        for (int i = 0; i < rows.Count; i++) Overlay(rows[i], edits, i);
        return rows;
    }

    /* library.track(id): one track, its corrected title laid over. */
    public static PlayTrack? Of(SqliteConnection c, Snapshot s, long id)
    {
        const string sql = "SELECT * FROM tracks WHERE id = $1";
        var rows = Library.Rows(c, sql, id);
        if (rows.Count == 0) return null;
        var t = Row(rows[0], Columns(c, sql, id));
        var al = s.Find(t.AlbumId);
        if (al == null || !s.TrackEdits.TryGetValue(al.Key, out var edits) || edits.Count == 0) return t;
        // Its place among the album's tracks: needed only when the number is missing.
        var i = t.TrackNo != null ? 0 : OfAlbumPlain(c, t.AlbumId).FindIndex(x => x.Id == t.Id);
        Overlay(t, edits, i);
        return t;
    }

    private static List<PlayTrack> OfAlbumPlain(SqliteConnection c, long albumId)
    {
        var sql = "SELECT * FROM tracks WHERE album_id = $1 " + Order;
        var col = Columns(c, sql, albumId);
        return Library.Rows(c, sql, albumId).Select(r => Row(r, col)).ToList();
    }

    /* trackPos(t, i): "disc-number", or "disc-p<index>" for a file with no track number. */
    private static void Overlay(PlayTrack t, Dictionary<string, string> edits, int i)
    {
        var pos = $"{t.DiscNo ?? 1}-{(t.TrackNo != null ? t.TrackNo.Value.ToString(CultureInfo.InvariantCulture) : "p" + (i + 1))}";
        if (edits.TryGetValue(pos, out var title) && title.Length > 0) t.Title = title;
    }

    // ------------------------------------------------------------ albums

    private static readonly ConditionalWeakTable<Snapshot, HashSet<string>> artistKeys = new();

    /* library.artistKeys: every album's artists, folded. */
    public static HashSet<string> ArtistKeys(Snapshot s) => artistKeys.GetValue(s, snap =>
    {
        var set = new HashSet<string>();
        foreach (var al in snap.Albums) foreach (var (_, n) in al.ArtistNames) set.Add(n);
        return set;
    });

    /* library.relocate(title, artist): an album by its names, the artist matched when it can be. */
    public static Album? Relocate(Snapshot s, string? title, string? artist)
    {
        static string FoldOr(string? v) { var f = Names.Fold(v); return f.Length > 0 ? f : TJs.Trim(v ?? "").ToLowerInvariant().Replace("  ", " "); }
        var t = FoldOr(title);
        if (t.Length == 0) return null;
        var a = Names.Fold(artist ?? "");
        Album? best = null;
        foreach (var al in s.Albums)
        {
            var titles = al.Edited ? new[] { FoldOr(al.Title), FoldOr(al.ScannedTitle) } : [FoldOr(al.Title)];
            if (!titles.Contains(t)) continue;
            var ok = a.Length == 0 || al.NArtist == a || al.ArtistNames.Any(n => n.N == a) || (al.Edited && Names.Fold(al.ScannedArtist) == a);
            if (ok) return al;
            best ??= al;
        }
        return best;
    }

    /* library.random(1).albums[0]: one album drawn at random, or null for an empty library. */
    public static Album? Random(Snapshot s) => s.Albums.Count == 0 ? null : s.Albums[System.Random.Shared.Next(s.Albums.Count)];

    // ------------------------------------------------------------ plays

    public static HashSet<long> PlayedAlbumIdsSince(SqliteConnection c, double ts) =>
        Library.Rows(c, "SELECT DISTINCT album_id FROM plays WHERE ts >= $1 AND album_id IS NOT NULL", (long)ts).Select(r => (long)r[0]!).ToHashSet();

    public static (Dictionary<long, long> Count, Dictionary<long, long> Last) PlayStats(SqliteConnection c)
    {
        Dictionary<long, long> count = [], last = [];
        foreach (var r in Library.Rows(c, "SELECT album_id, COUNT(*) AS n, MAX(ts) AS t FROM plays WHERE album_id IS NOT NULL GROUP BY album_id"))
        {
            count[(long)r[0]!] = (long)r[1]!;
            last[(long)r[0]!] = (long)r[2]!;
        }
        return (count, last);
    }
}
