// Streams.cs — music files sent as they are (v0.8.9), from the /stream route
// in index.js and the rule in lib/stream.js.
//
// A track's address is /stream/t<id>.<ext>, or /stream/t<id>.orig.<ext> when
// a streamer was promised the file as stored. The file itself is sent from
// here, straight from the disk with ranges (a speaker seeks with them):
//   - .orig: always the file as stored, served as its extension says (and a
//     streamer's own word for DSD, from a short list);
//   - no segment (Sonos): the file as stored when Sonos can take it: a type
//     it reads, at most 48 kHz and 24 bits, stereo, not DSD.
// A conversion (a rate and depth in the address, or the 24/48 rule) is made by
// the Node server with ffmpeg and kept in <data>/transcode, named for the track,
// its file's time and the conversion; the next tracks are made ahead of play.
// One already made is sent from here too (v0.8.10), and marked as used, as the
// Node server does, so the cache keeps it. One still to make is passed on, as
// is a conversion with a zone's DSP (?o=) or a ReplayGain (?g=), 32-bit output,
// Opus for the phone away (?q=opus), and a track streamed from Qobuz or Tidal.
// So is a request this side can't vouch for (a speaker asking by its own
// address: the Node server knows the speakers).
using System.Text.RegularExpressions;
using Microsoft.Net.Http.Headers;

namespace Mandarin.Server;

internal static partial class Streams
{
    private const int MaxRate = 48000, MaxBits = 24;

    [GeneratedRegex(@"^/stream/t([0-9]+)(?:\.(orig|[0-9]+-[0-9]+))?\.([a-z0-9]+)\z", RegexOptions.IgnoreCase)]
    private static partial Regex Address();
    [GeneratedRegex(@"^audio/(x-)?(dsf|dff|dsd)\z")]
    private static partial Regex DsdMime();

    private static readonly Dictionary<string, string> ExtMime = new()
    {
        ["flac"] = "audio/flac", ["fla"] = "audio/flac", ["mp3"] = "audio/mpeg", ["m4a"] = "audio/mp4", ["mp4"] = "audio/mp4", ["alac"] = "audio/mp4",
        ["m4b"] = "audio/mp4", ["aac"] = "audio/aac", ["ogg"] = "audio/ogg", ["oga"] = "audio/ogg", ["opus"] = "audio/ogg",
        ["wav"] = "audio/wav", ["wave"] = "audio/wav", ["aif"] = "audio/aiff", ["aiff"] = "audio/aiff", ["aifc"] = "audio/aiff",
        ["wma"] = "audio/x-ms-wma", ["dsf"] = "audio/x-dsf", ["dff"] = "audio/x-dff"
    };
    private static string MimeForExt(string ext) => ExtMime.TryGetValue(ext.ToLowerInvariant(), out var m) ? m : "application/octet-stream";

    [GeneratedRegex("mpeg|mp3")] private static partial Regex Mpeg();
    [GeneratedRegex(@"\.(m4a|mp4|alac)\z")] private static partial Regex Mp4Alac();
    [GeneratedRegex("^aac|mpeg-4/aac|^mp4a")] private static partial Regex AacCodec();
    [GeneratedRegex(@"\.(m4a|mp4|m4b)\z")] private static partial Regex Mp4Ext();
    [GeneratedRegex(@"\.(ogg|oga)\z")] private static partial Regex OggExt();
    [GeneratedRegex(@"pcm|65534|^\z")] private static partial Regex Pcm();
    [GeneratedRegex(@"\.wave?\z")] private static partial Regex WavExt();
    [GeneratedRegex(@"\.aif[fc]?\z")] private static partial Regex AiffExt();
    [GeneratedRegex("dsd|dsf|dff", RegexOptions.IgnoreCase)] private static partial Regex DsdCodec();
    [GeneratedRegex(@"\.(dsf|dff)\z", RegexOptions.IgnoreCase)] private static partial Regex DsdExt();

    /* stream.js nativeMime: the type Sonos matches on, when it reads the file as it is. */
    private static string? NativeMime(string path, string codecRaw, long bits)
    {
        var codec = codecRaw.ToLowerInvariant();
        var ext = Ext(path);
        if (codec == "flac" && ext is ".flac" or ".fla") return "audio/flac";
        if (ext == ".mp3" && (codec.Length == 0 || Mpeg().IsMatch(codec))) return "audio/mpeg";
        if (codec == "alac" && Mp4Alac().IsMatch(ext)) return "audio/mp4";
        if (AacCodec().IsMatch(codec) && Mp4Ext().IsMatch(ext)) return "audio/mp4";
        if (codec.StartsWith("aac", StringComparison.Ordinal) && ext == ".aac") return "audio/aac";
        if (codec == "vorbis" && OggExt().IsMatch(ext)) return "audio/ogg";
        var pcm = Pcm().IsMatch(codec);
        var b = bits != 0 ? bits : 16;
        if (pcm && WavExt().IsMatch(ext) && b <= 16) return "audio/wav";
        if (pcm && AiffExt().IsMatch(ext) && b <= 16) return "audio/aiff";
        return null;
    }
    // path.extname, lower case: ".flac", or "" (a name starting with a dot has none).
    private static string Ext(string p)
    {
        var name = Names.Basename(p);
        int i = name.LastIndexOf('.');
        return i <= 0 ? "" : name[i..].ToLowerInvariant();
    }

    private static string cacheDir = "";

    [GeneratedRegex(@"flac|alac|pcm|65534|monkey|\bape\b|wavpack|\bwv\b|\btta\b|\btak\b|shorten|\bshn\b")]
    private static partial Regex IntegerCodec();
    [GeneratedRegex(@"\.(wave?|aif[fc]?)\z", RegexOptions.IgnoreCase)]
    private static partial Regex Uncompressed();

    public static void Use(WebApplication app, string dataDir)
    {
        cacheDir = Path.Combine(dataDir, "transcode");
        app.Use(async (ctx, next) =>
        {
            var m = ctx.Request.Method;
            var p = ctx.Request.Path.Value ?? "";
            if ((HttpMethods.IsGet(m) || HttpMethods.IsHead(m)) && p.StartsWith("/stream/", StringComparison.Ordinal))
            {
                try { if (await Answer(ctx, p)) return; }
                catch (Exception e) when (!ctx.Response.HasStarted) { Front.Log($"[stream] {p}: {e.GetType().Name}: {e.Message}; passed to the Node server"); }
            }
            await next();
        });
    }

    /* range-parser's -1: a bytes range header in which no range is valid and within the file. */
    private static bool NoneSatisfiable(string header, long size)
    {
        int eq = header.IndexOf('=');
        if (eq < 0 || header[..eq].Trim() != "bytes") return false;
        foreach (var part in header[(eq + 1)..].Split(','))
        {
            var dash = part.IndexOf('-');
            if (dash < 0) continue;
            static long? P(string s) { s = s.TrimStart(); int i = 0; while (i < s.Length && char.IsAsciiDigit(s[i])) i++; return i > 0 && i <= 18 ? long.Parse(s[..i]) : null; }
            long? start = P(part[..dash]), end = P(part[(dash + 1)..]);
            if (start == null && end != null) { start = size - end; end = size - 1; }
            else if (end == null) end = size - 1;
            if (end > size - 1) end = size - 1;
            if (start == null || end == null || start > end || start < 0) continue;
            return false;
        }
        return true;
    }

    private sealed record Track(string Path, string Codec, long Rate, long Bits, long Channels, long Mtime);

    private static async Task<bool> Answer(HttpContext ctx, string path)
    {
        var a = Address().Match(path);
        if (!a.Success) return false;
        var q = ctx.Request.Query;
        // Converted, levelled or made Opus: the Node server's (ffmpeg).
        if (q.ContainsKey("g") || q["q"].ToString() == "opus") return false;
        var seg = a.Groups[2].Value;
        if (!long.TryParse(a.Groups[1].Value, out var id)) return false;
        // A rate and depth a streamer was promised: made with the high-quality settings.
        long segRate = 0, segBits = 0;
        if (seg.Length > 0 && seg != "orig")
        {
            var rb = seg.Split('-');
            if (!long.TryParse(rb[0], out segRate) || !long.TryParse(rb[1], out segBits)) return false;
            if (segRate < 8000 || segRate > 768000 || segBits is not (16 or 24)) return false;   // a 400, or 32-bit: the Node server's
            if (q.ContainsKey("o")) return false;   // with the zone's DSP
        }

        Track? t = null;
        using (var c = Db.Open())
        {
            if (!Images.Signed(ctx, c, path) && Auth.DeviceOf(ctx, c) == null) return false;   // the Node server's to decide
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT path, codec, sample_rate, bits, channels, mtime FROM tracks WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            using var r = cmd.ExecuteReader();
            if (r.Read())
            {
                long N(int i) => r.IsDBNull(i) ? 0 : Convert.ToInt64(r.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);
                t = new Track(r.GetString(0), r.IsDBNull(1) ? "" : Convert.ToString(r.GetValue(1), System.Globalization.CultureInfo.InvariantCulture) ?? "", N(2), N(3), N(4),
                    r.IsDBNull(5) ? 0 : (long)Math.Floor(Convert.ToDouble(r.GetValue(5), System.Globalization.CultureInfo.InvariantCulture)));
            }
        }
        if (t == null) return false;
        if (t.Path.Contains("://", StringComparison.Ordinal)) return false;   // Qobuz or Tidal: fetched by the Node server

        string mime = "audio/flac";
        string? converted = null;
        if (segRate != 0) converted = $"{id}-{t.Mtime}-{segRate}-{segBits}-hq";
        else if (seg == "orig")
        {
            mime = MimeForExt(a.Groups[3].Value);
            var asked = q["m"].Count == 1 ? q["m"].ToString() : "";
            if (DsdMime().IsMatch(asked) && a.Groups[3].Value.ToLowerInvariant() is "dsf" or "dff") mime = asked;
        }
        else
        {
            // stream.js plan, with no target: the file as it is, or a conversion.
            var native = NativeMime(t.Path, t.Codec, t.Bits);
            var tooHigh = t.Rate > MaxRate || t.Bits > MaxBits;
            var dsd = DsdCodec().IsMatch(t.Codec) || DsdExt().IsMatch(t.Path);
            var channels = t.Channels != 0 ? t.Channels : 2;
            if (native == null || tooHigh || channels > 2 || dsd)
            {
                // The 24/48 rule's conversion: 48 kHz at most (DSD at 48), 24 bits
                // for anything resampled or deeper than 16, else the file's own.
                var outRate = dsd ? MaxRate : (t.Rate > MaxRate || t.Rate == 0 ? MaxRate : t.Rate);
                var outBits = dsd || t.Rate > MaxRate || t.Bits > 16 || t.Bits == 0 ? 24 : 16;
                // stream.js repack: only the container changes, the samples exactly as they were.
                var codec = t.Codec.ToLowerInvariant();
                var exact = t.Rate != 0 && t.Bits != 0 && outRate == t.Rate && outBits >= t.Bits && channels <= 2
                    && (IntegerCodec().IsMatch(codec) || (codec.Length == 0 && Uncompressed().IsMatch(t.Path)));
                converted = $"{id}-{t.Mtime}-{outRate}-{outBits}{(exact ? "-x" : "")}";
            }
            mime = native ?? "audio/flac";
        }
        if (converted != null)
        {
            // Made already: sent from the cache, and marked as used (the cache keeps the most recently used).
            var made = Path.Combine(cacheDir, converted + ".flac");
            if (!File.Exists(made)) return false;   // still to make: the Node server makes it
            var now = DateTime.UtcNow;
            try { File.SetLastWriteTimeUtc(made, now); File.SetLastAccessTimeUtc(made, now); } catch (IOException) { /* best effort, as there */ }
            return await SendFile(ctx, made, "audio/flac");
        }

        if (!File.Exists(t.Path)) return false;   // the Node server says so, as before
        return await SendFile(ctx, t.Path, mime);
    }

    private static async Task<bool> SendFile(HttpContext ctx, string file, string mime)
    {
        var info = new FileInfo(file);
        var ms = (long)Math.Floor((info.LastWriteTimeUtc.Ticks - DateTime.UnixEpoch.Ticks) / 10000.0 + 0.5);
        // Ranges none of which can be served ("bytes=5-2"): "not satisfiable", as the
        // Node server's range-parser has it, where ASP.NET would send the whole file.
        if (ctx.Request.Headers.Range.ToString() is { Length: > 0 } rh && NoneSatisfiable(rh, info.Length))
            ctx.Request.Headers.Range = $"bytes={info.Length}-";
        ctx.Response.Headers.CacheControl = "no-store";
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        var result = Results.File(file, mime,
            lastModified: DateTimeOffset.FromUnixTimeMilliseconds(ms),
            entityTag: new EntityTagHeaderValue($"\"{info.Length:x}-{ms:x}\"", isWeak: true),
            enableRangeProcessing: true);
        await result.ExecuteAsync(ctx);
        return true;
    }
}
