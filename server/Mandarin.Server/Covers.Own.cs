// Covers.Own.cs — whether an album has a cover of its own, for the cover
// finder (Extras/AutoCovers.cs, item 409): the tests HasOwn makes (a cover
// found for it, a picture in its folder, one in its first three tracks, read
// by ffprobe without drawing anything), told apart from "can't say": a drive
// not mounted, a folder gone, a track ffprobe couldn't read. An album that
// can't be told about is left for another time, never given a cover from the
// web over a picture of its own that is only out of reach.
using System.Text.Json;

namespace Mandarin.Server;

internal static partial class Covers
{
    /* Whether an album has a cover of its own: yes, no, or it can't be told now. */
    public enum Ownership { Yes, No, Unknown }

    /* Own(al): as HasOwn decides it, with "can't be told" kept apart. */
    public static async Task<Ownership> Own(Album al)
    {
        if (al.CustomArt) return Ownership.Yes;
        string? artPath;
        var tracks = new List<string>();
        using (var c = Db.Open())
        {
            using (var a = c.CreateCommand())
            {
                a.CommandText = "SELECT art_path FROM albums WHERE id = $id";
                a.Parameters.AddWithValue("$id", al.Id);
                artPath = a.ExecuteScalar() as string;
            }
            using var t = c.CreateCommand();
            t.CommandText = "SELECT path FROM tracks WHERE album_id = $id ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path LIMIT 3";
            t.Parameters.AddWithValue("$id", al.Id);
            using var r = t.ExecuteReader();
            while (r.Read()) if (!r.IsDBNull(0)) tracks.Add(r.GetString(0));
        }
        if (!string.IsNullOrEmpty(artPath))
        {
            if (Path.Exists(artPath)) return Ownership.Yes;
            // Its folder gone: a drive away, not a cover gone.
            if (!Directory.Exists(Path.GetDirectoryName(artPath))) return Ownership.Unknown;
        }
        if (tracks.Count == 0) return Ownership.Unknown;
        foreach (var path in tracks)
        {
            try
            {
                var (read, at) = await PictureOf(path);
                if (!read) return Ownership.Unknown;
                if (at != null) return Ownership.Yes;
            }
            catch (Exception e) when (e is IOException or JsonException or InvalidOperationException or KeyNotFoundException) { return Ownership.Unknown; }
        }
        return Ownership.No;
    }

    /*
     * The width and height a JPEG says it is (its frame header), or null: a
     * cover found on the web is drawn by Normalise into one, and the finder
     * keeps only one of a sensible size. Read from the header, not drawn.
     */
    public static (int Width, int Height)? JpegSize(byte[] b)
    {
        if (b.Length < 4 || b[0] != 0xFF || b[1] != 0xD8) return null;
        int o = 2;
        while (o + 4 <= b.Length)
        {
            if (b[o] != 0xFF) return null;
            var m = b[o + 1];
            if (m == 0xFF) { o++; continue; }
            if (m == 0x01 || m is >= 0xD0 and <= 0xD7) { o += 2; continue; }
            if (m is 0xD9 or 0xDA) return null;
            var len = (b[o + 2] << 8) | b[o + 3];
            if (len < 2 || o + 2 + len > b.Length) return null;
            if (m is >= 0xC0 and <= 0xCF && m != 0xC4 && m != 0xC8 && m != 0xCC)
            {
                if (len < 8) return null;
                return ((b[o + 7] << 8) | b[o + 8], (b[o + 5] << 8) | b[o + 6]);
            }
            o += 2 + len;
        }
        return null;
    }
}
