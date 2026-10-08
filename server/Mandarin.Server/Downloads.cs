// Downloads.cs — the files the phone keeps and the Opus it streams away from
// home (v0.8.12), from lib/server/downloads.js, setting for setting.
//
// Two qualities: "original", the file as it is when Android plays it (else
// FLAC at its own rate, up to 24 bits; DSD at 88.2 kHz), and "opus", Opus 256
// at 48 kHz, resampled by SoX at 33-bit precision in 64-bit float and fed to
// the encoder as float. Each is made once with ffmpeg and kept in
// <data>/download-cache, two at a time, the cache under TRANSCODE_CACHE_GB.
//
//   GET /api/download/t<id>?quality=   one track, made if need be (Range supported)
//   GET /stream/t<id>.<ext>?q=opus      away from home: the track as Opus, the
//                                       album's next two made ready behind it
//
// The album's list for a download (with its ReplayGain numbers) and the
// automatic downloads are still the Node server's; neither makes a file.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class Downloads
{
    private const int OpusKbps = 256;
    private static string dir = "";
    private static long maxBytes;
    private static readonly ConcurrentDictionary<string, Task> Jobs = new();
    // Two at a time for the phone to keep, and two for the Opus made ahead of a
    // stream away from home; the one a stream is waiting for at once. Each on
    // the cores its kind has (Cpu.cs).
    private static readonly SemaphoreSlim Slots = new(2, 2);
    private static readonly SemaphoreSlim AheadSlots = new(2, 2);

    public sealed record Track(long Id, string Path, string Codec, long Rate, long Bits, long Channels, long Mtime, long Size);
    public sealed record Plan(string? File, string? Convert, string Ext, string Mime);

    public static void Init(string dataDir)
    {
        dir = System.IO.Path.Combine(dataDir, "download-cache");
        Directory.CreateDirectory(dir);
        maxBytes = (long)((double.TryParse(Environment.GetEnvironmentVariable("TRANSCODE_CACHE_GB"), NumberStyles.Float, CultureInfo.InvariantCulture, out var gb) && gb > 0 ? gb : 4) * 1024 * 1024 * 1024);
        foreach (var f in Directory.EnumerateFiles(dir, "*.part")) { try { System.IO.File.Delete(f); } catch (IOException) { /* gone */ } }
    }

    private static string MimeFor(string ext) => ext switch
    {
        "flac" or "fla" => "audio/flac", "mp3" => "audio/mpeg", "m4a" or "mp4" or "m4b" => "audio/mp4",
        "aac" => "audio/aac", "ogg" or "oga" or "opus" => "audio/ogg", "wav" or "wave" => "audio/wav",
        _ => "application/octet-stream"
    };
    private static string Ext(string p)
    {
        var name = Names.Basename(p);
        int i = name.LastIndexOf('.');
        return i <= 0 ? "" : name[i..].ToLowerInvariant();
    }

    [GeneratedRegex(@"\.(m4a|mp4|aac|m4b)\z")] private static partial Regex Mp4Ext();
    [GeneratedRegex("^aac|mp4a|mpeg-4/aac")] private static partial Regex AacCodec();
    [GeneratedRegex(@"\.(ogg|oga|opus)\z")] private static partial Regex OggExt();
    [GeneratedRegex("vorbis|opus")] private static partial Regex OggCodec();
    [GeneratedRegex(@"\.wave?\z")] private static partial Regex WavExt();
    [GeneratedRegex(@"pcm|^\z")] private static partial Regex Pcm();
    [GeneratedRegex("dsd|dsf|dff", RegexOptions.IgnoreCase)] private static partial Regex DsdCodec();
    [GeneratedRegex(@"\.(dsf|dff)\z", RegexOptions.IgnoreCase)] private static partial Regex DsdExt();
    [GeneratedRegex(@"\.opus\z", RegexOptions.IgnoreCase)] private static partial Regex OpusFile();

    /* What Android (ExoPlayer, no extensions) plays as it is. */
    private static bool PhonePlays(Track t)
    {
        var ext = Ext(t.Path);
        var codec = t.Codec.ToLowerInvariant();
        if ((t.Channels != 0 ? t.Channels : 2) > 2) return false;
        if (ext is ".flac" or ".fla") return codec == "flac" || codec.Length == 0;
        if (ext == ".mp3") return true;
        if (Mp4Ext().IsMatch(ext)) return AacCodec().IsMatch(codec);
        if (OggExt().IsMatch(ext)) return OggCodec().IsMatch(codec) || codec.Length == 0;
        if (WavExt().IsMatch(ext)) return (t.Bits != 0 ? t.Bits : 16) <= 24 && Pcm().IsMatch(codec);
        return false;
    }

    /* How a track goes out at this quality. */
    public static Plan PlanFor(Track t, string quality)
    {
        if (quality == "opus")
            return OpusFile().IsMatch(t.Path) ? new Plan(t.Path, null, "opus", "audio/ogg") : new Plan(null, "opus", "opus", "audio/ogg");
        if (PhonePlays(t)) { var ext = Ext(t.Path).TrimStart('.'); return new Plan(t.Path, null, ext, MimeFor(ext)); }
        return new Plan(null, "flac", "flac", "audio/flac");
    }

    private static string KeyFor(Track t, Plan p)
    {
        var bits = Math.Min(24, t.Bits != 0 ? t.Bits : 24);
        return $"{t.Id}-{t.Mtime}-{(p.Convert == "opus" ? "opus" + OpusKbps + "f" : "flac" + bits)}";
    }

    private static List<string> Args(Track t, Plan p, string dest)
    {
        if (p.Convert == "opus")
        {
            var resampler = Transcoder.Soxr ? "resampler=soxr:precision=33:" : "";
            return ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", t.Path,
                "-map", "0:a:0", "-vn",
                "-af", $"aresample={resampler}internal_sample_fmt=dblp:osr=48000",
                "-ar", "48000", "-ac", "2", "-sample_fmt", "flt", "-map_metadata", "0",
                "-c:a", "libopus", "-b:a", OpusKbps + "k", "-vbr", "on", "-f", "ogg", dest];
        }
        // Lossless: the same rate (DSD comes down to 88.2 kHz), up to 24 bits.
        var dsd = DsdCodec().IsMatch(t.Codec) || DsdExt().IsMatch(t.Path);
        var rate = dsd ? 88200 : (t.Rate != 0 ? t.Rate : 44100);
        var bits = dsd ? 24 : (t.Bits != 0 ? t.Bits : 24) > 16 ? 24 : 16;
        return Transcoder.Args(t.Path, new ConvPlan(rate, (int)bits, false, false, ""), dest);
    }

    /*
     * The file to send for this track at this quality, made first if need be:
     * for the phone to keep (Background), for a stream waiting for it
     * (Playback), or for one that will want it next (Ahead).
     */
    public static async Task<(string Path, string Ext, string Mime)> FileFor(Track t, string quality, CpuKind kind = CpuKind.Background)
    {
        var p = PlanFor(t, quality);
        if (p.File != null) return (p.File, p.Ext, p.Mime);
        var key = KeyFor(t, p);
        var dest = System.IO.Path.Combine(dir, key + "." + p.Ext);
        if (System.IO.File.Exists(dest))
        {
            var now = DateTime.UtcNow;
            try { System.IO.File.SetLastWriteTimeUtc(dest, now); System.IO.File.SetLastAccessTimeUtc(dest, now); } catch (IOException) { /* best effort */ }
            return (dest, p.Ext, p.Mime);
        }
        var job = Jobs.GetOrAdd(key, k => Task.Run(async () =>
        {
            try { await Convert(t, p, dest, kind); }
            finally { Jobs.TryRemove(key, out _); }
        }));
        await job;
        return (dest, p.Ext, p.Mime);
    }

    private static async Task Convert(Track t, Plan p, string dest, CpuKind kind)
    {
        var slots = kind switch { CpuKind.Background => Slots, CpuKind.Ahead => AheadSlots, _ => null };
        if (slots != null) await slots.WaitAsync();
        try
        {
            var part = dest + ".part";
            var psi = new ProcessStartInfo(Transcoder.Bin) { UseShellExecute = false, RedirectStandardError = true, RedirectStandardInput = true };
            foreach (var a in Args(t, p, part)) psi.ArgumentList.Add(a);
            Cpu.Place(psi, kind);
            using var proc = Process.Start(psi) ?? throw new InvalidOperationException("couldn't start ffmpeg");
            Cpu.Adopt(proc, kind);
            proc.StandardInput.Close();
            var err = await proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();
            Cpu.Forget(proc);
            if (proc.ExitCode == 0 && System.IO.File.Exists(part)) System.IO.File.Move(part, dest, overwrite: true);
            else
            {
                try { System.IO.File.Delete(part); } catch (IOException) { /* never made */ }
                var e = err.Trim();
                throw new IOException("conversion failed: " + (e.Length > 300 ? e[..300] : e));
            }
            Prune();
        }
        finally { slots?.Release(); }
    }

    private static void Prune()
    {
        try
        {
            var files = new DirectoryInfo(dir).GetFiles().Where(f => !f.Name.EndsWith(".part", StringComparison.Ordinal)).OrderBy(f => f.LastWriteTimeUtc).ToList();
            long total = files.Sum(f => f.Length);
            while (total > maxBytes && files.Count > 1)
            {
                var f = files[0];
                files.RemoveAt(0);
                try { var n = f.Length; f.Delete(); total -= n; } catch (IOException) { /* in use */ }
            }
        }
        catch (IOException) { /* no cache yet */ }
    }

    // ------------------------------------------------------------- tracks

    public static Track? TrackById(Microsoft.Data.Sqlite.SqliteConnection c, long id)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id, path, codec, sample_rate, bits, channels, mtime, size FROM tracks WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        long N(int i) => r.IsDBNull(i) ? 0 : (long)Math.Floor(System.Convert.ToDouble(r.GetValue(i), CultureInfo.InvariantCulture));
        return new Track(r.GetInt64(0), r.GetString(1), r.IsDBNull(2) ? "" : System.Convert.ToString(r.GetValue(2), CultureInfo.InvariantCulture) ?? "",
            N(3), N(4), N(5), N(6), N(7));
    }

    /* The album's tracks in playing order: the next ones to make ready behind an Opus stream. */
    public static List<Track> AlbumTracksOf(Microsoft.Data.Sqlite.SqliteConnection c, long trackId)
    {
        var list = new List<Track>();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id FROM tracks WHERE album_id = (SELECT album_id FROM tracks WHERE id = $id) ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path";
        cmd.Parameters.AddWithValue("$id", trackId);
        var ids = new List<long>();
        using (var r = cmd.ExecuteReader()) while (r.Read()) ids.Add(r.GetInt64(0));
        foreach (var id in ids) if (TrackById(c, id) is { } t) list.Add(t);
        return list;
    }

    // ------------------------------------------------------------- routes

    [GeneratedRegex(@"^/api/download/t([0-9]+)\z")] private static partial Regex DownloadAddress();

    public static void Use(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            var m = DownloadAddress().Match(ctx.Request.Path.Value ?? "");
            if (m.Success && (HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method)) && long.TryParse(m.Groups[1].Value, out var id))
            {
                try { if (await DownloadTrack(ctx, id)) return; }
                catch (Exception e) when (!ctx.Response.HasStarted) { Front.Log($"[download] {ctx.Request.Path}: {e.GetType().Name}: {e.Message}; passed to the Node server"); }
            }
            await next();
        });
    }

    private static Task Error(HttpContext ctx, int status, string message)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        return ctx.Response.WriteAsync(new JsonObject { ["error"] = message }.ToJsonString());
    }

    private static async Task<bool> DownloadTrack(HttpContext ctx, long id)
    {
        Track? t;
        using (var c = Db.Open()) t = TrackById(c, id);
        if (t == null) { await Error(ctx, 404, "That track is no longer in the library"); return true; }
        // A streamed track (Qobuz, Tidal) is streamed only, never made into a file to keep.
        if (t.Path.Contains("://", StringComparison.Ordinal)) { await Error(ctx, 403, "Streamed tracks can't be downloaded"); return true; }
        var q = ctx.Request.Query["quality"].ToString();
        (string Path, string Ext, string Mime) f;
        try { f = await FileFor(t, q is "original" or "opus" ? q : "original"); }
        catch (IOException e) { await Error(ctx, 500, e.Message); return true; }
        if (!System.IO.File.Exists(f.Path)) return false;   // the Node server says so, as before
        ctx.Response.Headers["X-Download-Ext"] = f.Ext;
        return await Streams.SendFile(ctx, f.Path, f.Mime);
    }

    /* ?q=opus away from home: the track as Opus, and the album's next two made ready behind it. */
    public static async Task<bool> StreamOpus(HttpContext ctx, long id)
    {
        Track? t;
        List<Track> rest;
        using (var c = Db.Open()) { t = TrackById(c, id); rest = t == null ? [] : AlbumTracksOf(c, id); }
        if (t == null || t.Path.Contains("://", StringComparison.Ordinal)) return false;
        // This one at once, then the next two just below it, on playback's cores (Cpu.cs).
        var making = FileFor(t, "opus", CpuKind.Playback);
        var i = rest.FindIndex(x => x.Id == t.Id);
        foreach (var n in rest.Skip(i + 1).Take(2)) _ = FileFor(n, "opus", CpuKind.Ahead).ContinueWith(_ => { }, TaskScheduler.Default);
        (string Path, string Ext, string Mime) f;
        try { f = await making; }
        catch (IOException e)
        {
            Front.Log($"[stream] opus {t.Id} {e.Message}");
            ctx.Response.StatusCode = 500;
            ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
            return true;
        }
        return await Streams.SendFile(ctx, f.Path, f.Mime);
    }
}
