// Covers.cs — album covers drawn here (v0.8.22): lib/library/artwork.js's
// get(), with ffmpeg in place of sharp.
//
// A cover is taken from where the Node server takes it, in the same order: a
// cover found for the album (album_edits.art), the picture in its folder, or
// the one embedded in its first three tracks (the front cover among several,
// else the first). Each size is drawn once and kept in <data>/art under the
// same name, drawn the same way: turned upright, fitted inside the size and
// never enlarged, laid on black, a JPEG.
//
// What sharp would draw differently is left to the Node server, as is an
// album with no cover of its own (its placeholder is drawn there): a picture
// in another colour space than sRGB (CMYK, or carrying a profile of its own),
// one cut short or that ffmpeg reads with errors, one turned by anything but
// a JPEG's EXIF, and anything but JPEG, PNG, WebP, GIF or BMP.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using System.Text.Json;

namespace Mandarin.Server;

internal static partial class Covers
{
    // Two at a time (sharp.concurrency(2)), the rest waiting their turn.
    private static readonly SemaphoreSlim Drawing = new(2);
    private static readonly ConcurrentDictionary<string, Task<Drawn>> Inflight = new();

    /* How a cover went: drawn; none of its own (a placeholder is drawn, CoversDrawn.cs); or the Node server's to draw. */
    public enum Drawn { Yes, NoCover, NodeIts }
    // The picture an album's cover is drawn from, kept a little while: its sizes are asked for together.
    private static readonly ConcurrentDictionary<string, (long At, Lazy<Task<byte[]?>> Bytes)> Sources = new();
    private const long SourceMs = 20000;
    private const long MaxSource = 64L << 20;

    private static string Ffprobe
    {
        get
        {
            var dir = Path.GetDirectoryName(Transcoder.Bin);
            if (!string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, "ffprobe"))) return Path.Combine(dir, "ffprobe");
            return "ffprobe";
        }
    }

    private static readonly Lazy<bool> Probe = new(() =>
    {
        if (!Transcoder.FfOk) return false;
        try
        {
            using var p = Process.Start(new ProcessStartInfo(Ffprobe, "-hide_banner -version") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false })!;
            _ = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(10000)) { try { p.Kill(); } catch (Exception) { /* gone */ } return false; }
            return p.ExitCode == 0;
        }
        catch (Exception) { return false; }
    });
    /* ffmpeg and ffprobe both there: a track's pictures can be read here. */
    public static bool ProbeOk => Probe.Value;

    /*
     * Draw an album's cover at this size into `file`: true once it's there,
     * false when it's the Node server's to draw (see above). One drawing a
     * file at a time; another ask for it waits for that one.
     */
    public static Task<Drawn> Draw(Album al, string file, int size) =>
        Once(file, al.ImageKey, () => Make(al, file, size));

    /* One drawing a file at a time; another ask for it waits for that one. Anything thrown: the Node server's. */
    private static Task<Drawn> Once(string file, string what, Func<Task<Drawn>> make)
    {
        if (!Transcoder.FfOk) return Task.FromResult(Drawn.NodeIts);
        var mine = new TaskCompletionSource<Drawn>(TaskCreationOptions.RunContinuationsAsynchronously);
        var running = Inflight.GetOrAdd(file, mine.Task);
        if (running != mine.Task) return running;
        _ = Task.Run(async () =>
        {
            var how = Drawn.NodeIts;
            try { how = await make(); }
            catch (Exception e) { Front.Log($"[art] {what}: {e.GetType().Name}: {e.Message}; passed to the Node server"); }
            finally { Inflight.TryRemove(file, out _); mine.TrySetResult(how); }
        });
        return mine.Task;
    }

    private static async Task<Drawn> Make(Album al, string file, int s)
    {
        if (!ProbeOk) return Drawn.NodeIts;
        var src = await Source(al);
        if (src == null) return Drawn.NodeIts;
        if (src.Length == 0) return Drawn.NoCover;
        var turn = Look(src);
        if (turn == null) return Drawn.NodeIts;
        var jpg = await Fit(src, turn, s, "4", al.ImageKey);
        if (jpg == null) return Drawn.NodeIts;
        Write(file, jpg);
        return Drawn.Yes;
    }

    /*
     * A picture drawn as sharp draws it here: turned upright, fitted inside
     * size × size (never enlarged), laid on black, a JPEG at this quality
     * (ffmpeg's scale: 4 for a cover's sizes, 2 for a found cover kept).
     * Null when ffmpeg can't, or says anything at all about it.
     */
    private static async Task<byte[]?> Fit(byte[] src, string turn, int size, string q, string what)
    {
        var vf = (turn.Length > 0 ? turn + "," : "") +
                 $"format=rgba,premultiply=inplace=1,scale=w='min({size},iw)':h='min({size},ih)':force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd+full_chroma_int,format=yuvj420p";
        await Drawing.WaitAsync();
        try
        {
            var (code, jpg, err) = await Run(Transcoder.Bin,
                ["-v", "error", "-noautorotate", "-i", "pipe:0", "-vf", vf, "-frames:v", "1", "-q:v", q, "-f", "mjpeg", "pipe:1"],
                src, 32 << 20, TimeSpan.FromSeconds(30));
            if (code != 0 || jpg.Length == 0 || err.Trim().Length > 0)
            {
                Front.Log($"[art] {what}: ffmpeg couldn't draw it ({(err.Trim().Length > 0 ? err.Trim().Split('\n')[0] : "exit " + code)}); passed to the Node server");
                return null;
            }
            return jpg;
        }
        finally { Drawing.Release(); }
    }

    /* Artwork.download's last step: a cover found on the web, upright, 1500 pixels at most, on black. */
    public static Task<byte[]?> Normalise(byte[] src, string turn) => Fit(src, turn, 1500, "2", "a found cover");

    /*
     * Something some image reader might take for a picture (sharp's among
     * them): a found cover that isn't one of these is no picture at all.
     */
    public static bool LooksLikeImage(byte[] b)
    {
        if (Look(b) != null) return true;
        bool At(int o, params byte[] m) => b.Length >= o + m.Length && b.AsSpan(o, m.Length).SequenceEqual(m);
        if (At(0, 0xFF, 0xD8, 0xFF) || At(0, 0x89, 0x50, 0x4E, 0x47) || At(0, (byte)'G', (byte)'I', (byte)'F', (byte)'8') || At(0, (byte)'B', (byte)'M')) return true;
        if (At(0, (byte)'R', (byte)'I', (byte)'F', (byte)'F') && At(8, (byte)'W', (byte)'E', (byte)'B', (byte)'P')) return true;
        if (At(0, (byte)'I', (byte)'I', 0x2A, 0x00) || At(0, (byte)'M', (byte)'M', 0x00, 0x2A) || At(0, (byte)'I', (byte)'I', 0x2B, 0x00) || At(0, (byte)'M', (byte)'M', 0x00, 0x2B)) return true;
        if (At(4, (byte)'f', (byte)'t', (byte)'y', (byte)'p')) return true;                     // HEIF, AVIF
        if (At(0, 0x00, 0x00, 0x00, 0x0C, (byte)'j', (byte)'P') || At(0, 0xFF, 0x4F, 0xFF, 0x51)) return true;   // JPEG 2000
        if (At(0, 0xFF, 0x0A) || At(0, 0x00, 0x00, 0x00, 0x0C, (byte)'J', (byte)'X', (byte)'L')) return true;  // JPEG XL
        if (At(0, (byte)'8', (byte)'B', (byte)'P', (byte)'S') || At(0, 0x00, 0x00, 0x01, 0x00)) return true;   // Photoshop, icon
        if (b.Length > 2 && b[0] == 'P' && (b[1] is >= (byte)'1' and <= (byte)'7' || b[1] == 'F' || b[1] == 'f')) return true;  // netpbm, PFM
        if (At(0, "SIMPLE  ="u8.ToArray())) return true;                                          // FITS
        // SVG: markup that names an <svg> near its start.
        var head = Encoding.UTF8.GetString(b, 0, Math.Min(b.Length, 4096)).TrimStart('﻿', ' ', '\t', '\r', '\n');
        return head.StartsWith('<') && head.Contains("<svg", StringComparison.OrdinalIgnoreCase);
    }

    /* artwork.write: whole or not at all. */
    private static void Write(string file, byte[] jpg)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var tmp = $"{file}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
        File.WriteAllBytes(tmp, jpg);
        try { File.Move(tmp, file, overwrite: true); }
        catch (IOException) { try { File.Delete(tmp); } catch (IOException) { /* gone */ } throw; }
    }

    /* A size drawn for an album's earlier covers goes (artwork.forget): an old address draws the current one. */
    public static int Forget(string artDir, long albumId, string? keepKey)
    {
        var prefix = $"al-{albumId}-";
        var keep = keepKey != null ? new string(keepKey.Where(ch => char.IsAsciiLetterOrDigit(ch) || ch == '_' || ch == '-').ToArray()) + "@" : null;
        int n = 0;
        try
        {
            foreach (var f in Directory.EnumerateFiles(artDir).Select(Path.GetFileName))
            {
                if (f == null || !f.StartsWith(prefix, StringComparison.Ordinal) || (keep != null && f.StartsWith(keep, StringComparison.Ordinal))) continue;
                try { File.Delete(Path.Combine(artDir, f)); n++; } catch (IOException) { /* in use: next time */ }
            }
        }
        catch (DirectoryNotFoundException) { /* no cache yet */ }
        foreach (var k in Sources.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal))) Sources.TryRemove(k, out _);
        return n;
    }

    // ------------------------------------------------------------ the source

    /* artwork.source for an album, kept for its other sizes. */
    private static Task<byte[]?> Source(Album al)
    {
        var now = Environment.TickCount64;
        foreach (var (k, v) in Sources) if (now - v.At > SourceMs) Sources.TryRemove(k, out _);
        var key = al.ImageKey;
        var entry = Sources.GetOrAdd(key, k => (now, new Lazy<Task<byte[]?>>(() => Find(al).ContinueWith(t =>
        {
            // A very big one is shared only by the asks already waiting for it.
            if (t.IsCompletedSuccessfully && t.Result is { Length: > 8 << 20 }) Sources.TryRemove(k, out var _);
            return t;
        }, TaskScheduler.Default).Unwrap())));
        // Not many kept: a cover is megabytes.
        if (Sources.Count > 8)
            foreach (var (k, _) in Sources.OrderBy(x => x.Value.At).Take(Sources.Count - 8)) if (k != key) Sources.TryRemove(k, out _);
        return entry.Bytes.Value;
    }

    private static async Task<byte[]?> Find(Album al)
    {
        string? artPath = null;
        var tracks = new List<string>();
        byte[]? edited = null;
        using (var c = Db.Open())
        {
            if (al.CustomArt)
            {
                using var e = c.CreateCommand();
                e.CommandText = "SELECT art FROM album_edits WHERE key = $k";
                e.Parameters.AddWithValue("$k", al.Key);
                if (e.ExecuteScalar() is byte[] b) edited = b;
            }
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
        if (edited is { Length: > 0 }) return edited;
        // Empty when there is certainly none (a placeholder is drawn here);
        // null when it couldn't be told here (the Node server's, as before).
        var sure = true;
        if (!string.IsNullOrEmpty(artPath))
        {
            try
            {
                var info = new FileInfo(artPath);
                if (info.Exists && info.Length <= MaxSource) return await File.ReadAllBytesAsync(artPath);
                if (info.Exists) return null;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* moved: try embedded */ }
        }
        foreach (var path in tracks)
        {
            try
            {
                var (read, at) = await PictureOf(path);
                if (!read) { sure = false; continue; }
                if (at is null) continue;
                if (await Embedded(path) is { } b) return b;
                sure = false;   // a picture there that ffmpeg wouldn't give: music-metadata might
            }
            catch (Exception e) when (e is IOException or JsonException or InvalidOperationException or System.ComponentModel.Win32Exception or KeyNotFoundException) { sure = false; /* unreadable: next track */ }
        }
        return sure ? [] : null;
    }

    /* artwork.embeddedPicture: the front cover among a track's pictures, else the first, as it's kept there. */
    private static async Task<byte[]?> Embedded(string track)
    {
        if (await Picture(track) is not { } at) return null;
        var (code, bytes, _) = await Run(Transcoder.Bin,
            ["-v", "error", "-nostdin", "-i", track, "-map", "0:" + at, "-c", "copy", "-f", "image2pipe", "pipe:1"],
            null, (int)MaxSource, TimeSpan.FromSeconds(20));
        return code == 0 && bytes.Length > 0 ? bytes : null;
    }

    /*
     * Which of a track's streams is the picture music-metadata would pick:
     * the first whose kind says "front" (an ID3 or FLAC picture's type, as
     * ffmpeg's "comment"; an APE tag's item name), else the first picture.
     */
    private static async Task<int?> Picture(string track) => (await PictureOf(track)).At;

    /* Picture, and whether ffprobe could tell at all (Read false: it couldn't). */
    private static async Task<(bool Read, int? At)> PictureOf(string track)
    {
        if (!File.Exists(track)) return (true, null);
        var (code, json, _) = await Run(Ffprobe,
            ["-v", "error", "-show_entries", "stream=index,codec_type:stream_disposition=attached_pic:stream_tags", "-of", "json", track],
            null, 1 << 20, TimeSpan.FromSeconds(20));
        if (code != 0) return (false, null);
        int? front = null, first = null;
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("streams", out var streams) || streams.ValueKind != JsonValueKind.Array) return (true, null);
        foreach (var st in streams.EnumerateArray())
        {
            if (!st.TryGetProperty("codec_type", out var ct) || ct.GetString() != "video") continue;
            if (!st.TryGetProperty("disposition", out var d) || !d.TryGetProperty("attached_pic", out var ap) || ap.GetInt32() != 1) continue;
            var index = st.GetProperty("index").GetInt32();
            first ??= index;
            if (front != null || !st.TryGetProperty("tags", out var tags) || tags.ValueKind != JsonValueKind.Object) continue;
            foreach (var tag in tags.EnumerateObject())
            {
                var kind = tag.Name.Equals("comment", StringComparison.OrdinalIgnoreCase) ? tag.Value.GetString() ?? "" : tag.Name;
                if (kind.Contains("front", StringComparison.OrdinalIgnoreCase)) { front = index; break; }
            }
        }
        return (true, front ?? first);
    }

    /* artwork.hasOwnArt: a cover of its own — found, in its folder, or in its first three tracks. */
    public static async Task<bool> HasOwn(Album al)
    {
        if (al.CustomArt) return true;
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
        if (!string.IsNullOrEmpty(artPath) && Path.Exists(artPath)) return true;
        foreach (var path in tracks)
        {
            try { if (await Picture(path) != null) return true; }
            catch (Exception e) when (e is IOException or JsonException or InvalidOperationException or KeyNotFoundException) { /* next */ }
        }
        return false;
    }

    // ------------------------------------------------- what sharp would see

    /*
     * The turn the picture needs (an ffmpeg filter, "" for none), or null
     * when it's one to leave to sharp: see the top of this file.
     */
    public static string? Look(byte[] b)
    {
        if (b.Length > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return Jpeg(b);
        if (b.Length > 8 && b.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return Png(b);
        if (b.Length > 12 && Ascii(b, 0, 4) == "RIFF" && Ascii(b, 8, 4) == "WEBP") return Webp(b);
        if (b.Length > 6 && (Ascii(b, 0, 6) == "GIF87a" || Ascii(b, 0, 6) == "GIF89a")) return "";
        if (b.Length > 26 && b[0] == (byte)'B' && b[1] == (byte)'M') return "";
        return null;
    }

    private static string? Jpeg(byte[] b)
    {
        int o = 2, orientation = 0, sos = -1;
        bool sof = false, rgb = false;
        int comps = 0;
        var icc = new MemoryStream();
        while (o + 4 <= b.Length)
        {
            if (b[o] != 0xFF) return null;
            var m = b[o + 1];
            if (m == 0xFF) { o++; continue; }
            if (m == 0xD8 || m == 0x01 || m is >= 0xD0 and <= 0xD7) { o += 2; continue; }
            if (m == 0xD9) return null;
            var len = (b[o + 2] << 8) | b[o + 3];
            if (len < 2 || o + 2 + len > b.Length) return null;
            var seg = b.AsSpan(o + 4, len - 2);
            if (m == 0xDA) { sos = o; break; }
            if (m == 0xE1 && orientation == 0 && seg.Length > 14 && seg[..6].SequenceEqual("Exif\0\0"u8)) orientation = ExifOrientation(seg[6..]);
            else if (m == 0xE2 && seg.Length > 14 && seg[..12].SequenceEqual("ICC_PROFILE\0"u8)) icc.Write(seg[14..]);
            else if (m == 0xEE && seg.Length >= 12 && seg[..5].SequenceEqual("Adobe"u8)) rgb = seg[11] == 0;
            else if (m is >= 0xC0 and <= 0xCF && m != 0xC4 && m != 0xC8 && m != 0xCC)
            {
                // Baseline, extended or progressive, 8 bits, grey or colour: the rest are sharp's.
                if (m > 0xC2 || seg.Length < 6 || seg[0] != 8 || (seg[5] != 1 && seg[5] != 3)) return null;
                sof = true;
                comps = seg[5];
            }
            o += 2 + len;
        }
        if (!sof || sos < 0 || (rgb && comps == 3)) return null;
        // Whole: its end marker after the picture (inside the coded data a 0xFF is followed only by 0 or a restart).
        if (b.AsSpan(sos).LastIndexOf(new byte[] { 0xFF, 0xD9 }) < 0) return null;
        if (icc.Length > 0 && !Srgb(icc.ToArray())) return null;
        return Turn(orientation);
    }

    // The EXIF orientation as libvips applies it (sharp's rotate()).
    private static string Turn(int orientation) => orientation switch
    {
        2 => "hflip",
        3 => "hflip,vflip",
        4 => "vflip",
        5 => "transpose=0",
        6 => "transpose=1",
        7 => "transpose=3",
        8 => "transpose=2",
        _ => ""
    };

    private static int ExifOrientation(ReadOnlySpan<byte> t)
    {
        if (t.Length < 8) return 1;
        bool le;
        if (t[0] == 'I' && t[1] == 'I') le = true;
        else if (t[0] == 'M' && t[1] == 'M') le = false;
        else return 1;
        var ifd = U32(t, 4, le);
        if (ifd < 8 || ifd + 2 > t.Length) return 1;
        var n = U16(t, (int)ifd, le);
        for (int i = 0; i < n; i++)
        {
            var e = (int)ifd + 2 + i * 12;
            if (e + 12 > t.Length) break;
            if (U16(t, e, le) != 0x0112) continue;
            var type = U16(t, e + 2, le);
            long v = type == 3 ? U16(t, e + 8, le) : type == 4 ? U32(t, e + 8, le) : 1;
            return v is >= 1 and <= 8 ? (int)v : 1;
        }
        return 1;
    }
    private static int U16(ReadOnlySpan<byte> t, int p, bool le) => le ? t[p] | t[p + 1] << 8 : t[p] << 8 | t[p + 1];
    private static long U32(ReadOnlySpan<byte> t, int p, bool le) =>
        le ? (uint)(t[p] | t[p + 1] << 8 | t[p + 2] << 16 | t[p + 3] << 24) : (uint)(t[p] << 24 | t[p + 1] << 16 | t[p + 2] << 8 | t[p + 3]);

    private static string? Png(byte[] b)
    {
        long o = 8;
        while (o + 12 <= b.Length)
        {
            var len = U32(b, (int)o, false);
            var type = Ascii(b, (int)o + 4, 4);
            if (o + 12 + len > b.Length) return null;
            if (type == "iCCP")
            {
                var data = b.AsSpan((int)o + 8, (int)len);
                var z = data.IndexOf((byte)0);
                if (z < 0 || z + 2 > data.Length) return null;
                byte[] profile;
                try
                {
                    using var src = new MemoryStream(data[(z + 2)..].ToArray());
                    using var inflate = new ZLibStream(src, CompressionMode.Decompress);
                    using var dst = new MemoryStream();
                    var buf = new byte[16384];
                    int got;
                    while ((got = inflate.Read(buf)) > 0) { dst.Write(buf, 0, got); if (dst.Length > 8 << 20) return null; }
                    profile = dst.ToArray();
                }
                catch (InvalidDataException) { return null; }
                if (!Srgb(profile)) return null;
            }
            else if (type == "eXIf") return null;
            else if (type == "IEND") return "";
            o += 12 + len;
        }
        return null;
    }

    private static string? Webp(byte[] b)
    {
        long o = 12;
        while (o + 8 <= b.Length)
        {
            var fourcc = Ascii(b, (int)o, 4);
            var len = U32(b, (int)o + 4, true);
            if (o + 8 + len > b.Length) return null;
            if (fourcc == "ICCP") { if (!Srgb(b.AsSpan((int)o + 8, (int)len).ToArray())) return null; }
            else if (fourcc is "EXIF" or "ANIM" or "ANMF") return null;
            o += 8 + len + (len & 1);
        }
        return "";
    }

    /* An ICC profile that says it's sRGB: its description, in a version 2 or 4 profile. */
    private static bool Srgb(byte[] p)
    {
        if (p.Length < 132) return false;
        var n = U32(p, 128, false);
        for (long i = 0; i < n && 132 + i * 12 + 12 <= p.Length; i++)
        {
            var e = (int)(132 + i * 12);
            if (Ascii(p, e, 4) != "desc") continue;
            var off = U32(p, e + 4, false);
            if (off + 16 > p.Length) return false;
            var at = (int)off;
            string text;
            switch (Ascii(p, at, 4))
            {
                case "desc":
                {
                    var count = U32(p, at + 8, false);
                    text = Encoding.Latin1.GetString(p, at + 12, (int)Math.Min(count, p.Length - at - 12));
                    break;
                }
                case "mluc":
                {
                    if (U32(p, at + 8, false) == 0 || at + 28 > p.Length) return false;
                    var len = U32(p, at + 20, false);
                    var start = at + U32(p, at + 24, false);
                    if (start + len > p.Length) return false;
                    text = Encoding.BigEndianUnicode.GetString(p, (int)start, (int)len);
                    break;
                }
                default: return false;
            }
            return text.Contains("sRGB", StringComparison.OrdinalIgnoreCase);
        }
        return false;
    }

    private static string Ascii(byte[] b, int at, int n) => at + n <= b.Length ? Encoding.Latin1.GetString(b, at, n) : "";

    // ------------------------------------------------------------- programs

    /* A program run to its end (or killed at `within`): its exit code, what it wrote, and its complaints. */
    private static async Task<(int Code, byte[] Out, string Err)> Run(string bin, IEnumerable<string> args, byte[]? input, int maxOut, TimeSpan within)
    {
        var psi = new ProcessStartInfo(bin)
        {
            UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        Cpu.Place(psi, CpuKind.Background);
        using var p = new Process { StartInfo = psi };
        try { p.Start(); }
        catch (System.ComponentModel.Win32Exception) { return (-1, [], "not found: " + bin); }
        Cpu.Adopt(p, CpuKind.Background);
        using var cts = new CancellationTokenSource(within);
        try
        {
            var output = ReadAll(p.StandardOutput.BaseStream, maxOut, cts.Token);
            var errors = p.StandardError.ReadToEndAsync(cts.Token);
            try
            {
                if (input != null) await p.StandardInput.BaseStream.WriteAsync(input, cts.Token);
                p.StandardInput.Close();
            }
            catch (IOException) { /* it stopped reading: its exit says why */ }
            var bytes = await output;
            var err = await errors;
            await p.WaitForExitAsync(cts.Token);
            return (p.ExitCode, bytes, err);
        }
        catch (Exception e) when (e is OperationCanceledException or InvalidDataException)
        {
            try { p.Kill(true); } catch (Exception) { /* gone */ }
            return (-1, [], e is InvalidDataException ? "too large" : "timed out");
        }
        finally { Cpu.Forget(p); }
    }

    private static async Task<byte[]> ReadAll(Stream s, int max, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        var buf = new byte[65536];
        int n;
        while ((n = await s.ReadAsync(buf, ct)) > 0)
        {
            if (ms.Length + n > max) throw new InvalidDataException("too large");
            ms.Write(buf, 0, n);
        }
        return ms.ToArray();
    }
}
