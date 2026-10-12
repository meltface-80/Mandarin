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
// A conversion (a rate and depth in the address, or the 24/48 rule) is made
// here with ffmpeg (Transcoder.cs, v0.8.11) and kept in <data>/transcode, or
// sent from there when made already. Since v0.8.40 (stage 3) so are those
// with a ReplayGain (?g=), with a zone's DSP (?o=, read from audio_devices as
// the device fetches) and 32-bit output (where ffmpeg writes it), planned as
// the Node server plans them (Playback/StreamPlans.cs). Opus for the phone
// away (?q=opus) is Downloads.cs's. Since v0.8.47 (stage 4.5) a track streamed
// from Qobuz or Tidal too, once the services are this server's: always from
// the transcode folder, fetched from the service as a device asks for it (its
// play reported, on Qobuz), as it comes or converted like a file
// (Services/ServiceStreams.cs); nothing of a service streams without the
// account. Still passed on: a ?g= or ?o= in a form this side can't read as
// Express does, and a request this side can't vouch for (a speaker asking by
// its own address: the Node server knows the speakers, and hands a service's
// conversion here, POST /internal/transcode/prefetch).
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Microsoft.Net.Http.Headers;
using Mandarin.Server.Playback;

namespace Mandarin.Server;

using JsObj = Mandarin.Server.Tags.JsObj;

internal static partial class Streams
{
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
    internal static string MimeForExt(string ext) => ExtMime.TryGetValue(ext.ToLowerInvariant(), out var m) ? m : "application/octet-stream";

    private static string cacheDir = "";


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

    private sealed record Track(string Path, string Codec, long Rate, long Bits, long Channels, long Mtime, double Duration);

    private static async Task<bool> Answer(HttpContext ctx, string path)
    {
        var a = Address().Match(path);
        if (!a.Success) return false;
        var q = ctx.Request.Query;
        var opus = q["q"].ToString() == "opus";
        var seg = a.Groups[2].Value;
        if (!long.TryParse(a.Groups[1].Value, out var id)) return false;
        // A rate and depth a streamer was promised: made with the high-quality settings (32 bits where ffmpeg writes them).
        long segRate = 0, segBits = 0;
        if (seg.Length > 0 && seg != "orig")
        {
            var rb = seg.Split('-');
            if (!long.TryParse(rb[0], out segRate) || !long.TryParse(rb[1], out segBits)) return false;
            if (segRate < 8000 || segRate > 768000 || !(segBits is 16 or 24 || (segBits == 32 && Transcoder.Flac32))) return false;   // a 400: the Node server's
        }
        // ?g=<dB>: with this ReplayGain in it; ?o=<output>: with that zone's DSP (v0.8.40). Read as Express
        // reads them: one plain value; an array or an object of either (g[]=, g=1&g=2) the Node server's.
        var raw = ctx.Request.QueryString.HasValue ? ctx.Request.QueryString.Value![1..] : "";
        var gq = QueryOne(raw, "g");
        string? output = null;
        if (segRate != 0)
        {
            if (QueryOne(raw, "o") is not { } oq) return false;
            if (oq.Here && oq.Value!.Length > 0) output = oq.Value;
        }

        Track? t = null;
        using (var c = Db.Open())
        {
            // Unsigned and not signed in: a speaker asking by its own address (the hub's once this server holds playback, v0.8.49), else the Node server's to decide.
            if (!Images.Signed(ctx, c) && Auth.DeviceOf(ctx, c) == null && !await Images.FromSpeaker(ctx)) return false;
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT path, codec, sample_rate, bits, channels, mtime, duration FROM tracks WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            using var r = cmd.ExecuteReader();
            if (r.Read())
            {
                long N(int i) => r.IsDBNull(i) ? 0 : Convert.ToInt64(r.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);
                t = new Track(r.GetString(0), r.IsDBNull(1) ? "" : Convert.ToString(r.GetValue(1), System.Globalization.CultureInfo.InvariantCulture) ?? "", N(2), N(3), N(4),
                    r.IsDBNull(5) ? 0 : (long)Math.Floor(Convert.ToDouble(r.GetValue(5), System.Globalization.CultureInfo.InvariantCulture)),
                    r.IsDBNull(6) ? 0 : Convert.ToDouble(r.GetValue(6), System.Globalization.CultureInfo.InvariantCulture));
            }
        }
        if (t == null) return false;
        // Qobuz or Tidal (v0.8.47): this server's once the services are, else the Node server's.
        var svc = Services.Catalogue.Of(t.Path);
        if (t.Path.Contains("://", StringComparison.Ordinal) && (svc == null || !Jobs.Holds("services"))) return false;
        // Away from home: Opus 256, as the phone downloads it (Downloads.cs, v0.8.12). A streamed track: the cached FLAC.
        if (opus && svc == null) return await Downloads.StreamOpus(ctx, id);
        if (gq is null) return false;
        double? gain = null;
        if (gq.Value.Here)
        {
            var g = Tags.Js.StringToNumber(gq.Value.Value!);
            if (!double.IsFinite(g) || g < -24 || g > 12) return false;   // a 400: the Node server's
            gain = g;
        }

        // The plan, as index.js makes it: the file as stored, a renderer's rate and depth (with its zone's DSP), or the 24/48 rule.
        JsObj p;
        if (segRate != 0)
        {
            p = Jv.Obj(("transcode", true), ("hq", true), ("mime", "audio/flac"), ("ext", "flac"), ("rate", (double)segRate), ("bits", (double)segBits),
                ("reason", "what the renderer was promised"));
            if (output != null)
            {
                using var c = Db.Open();
                if (Dsp.PlanPart(DspFor(c, output), p["rate"]) is { } part) { p["dsp"] = part; p["inRate"] = (double)t.Rate; }
            }
        }
        else if (seg == "orig")
        {
            var mime = MimeForExt(a.Groups[3].Value);
            var asked = q["m"].Count == 1 ? q["m"].ToString() : "";
            if (DsdMime().IsMatch(asked) && a.Groups[3].Value.ToLowerInvariant() is "dsf" or "dff") mime = asked;
            p = Jv.Obj(("transcode", false), ("mime", mime));
        }
        else p = (JsObj)StreamPlans.PlanFor(Row(t), null, null)!;
        // A streamed track: always from the transcode folder, fetched from the service as it comes where a file would go as it is.
        if (svc != null && !Jv.T(p["transcode"]))
            p = Jv.Obj(("transcode", true), ("mime", "audio/flac"), ("ext", "flac"), ("rate", t.Rate != 0 ? (double)t.Rate : 44100.0), ("bits", t.Bits != 0 ? (double)t.Bits : 16.0),
                ("reason", "from " + svc.Name + ", as it comes"));
        if (gain is { } gn)
        {
            p = (JsObj)StreamPlans.WithGain(p, Jv.Obj(("path", t.Path), ("codec", t.Codec), ("sampleRate", (double)t.Rate), ("bitsPerSample", (double)t.Bits),
                ("channels", (double)t.Channels)), null, gn)!;
            if (segRate != 0) p["hq"] = true;
        }

        var mtime = t.Mtime;
        if (svc != null)
        {
            // Nothing of a service plays without the account, made already or not; a device fetching it is a play (reported, on Qobuz).
            if (!svc.Connected()) { ctx.Response.StatusCode = 403; ctx.Response.Headers["X-Mandarin-Answered"] = "C#"; return true; }
            if (HttpMethods.IsGet(ctx.Request.Method)) svc.Played(new Services.StreamTrack(id, t.Path, t.Rate, t.Bits, t.Duration), p);
            // Named by the stream quality setting where a file is named by its time.
            mtime = (long)svc.Tier();
        }
        else
        {
            if (!File.Exists(t.Path)) return false;   // the Node server says so, as before
            if (!Jv.T(p["transcode"])) return await SendFile(ctx, t.Path, Jv.Str(p["mime"]));
        }
        // Made already: sent from the cache, marked as used. Not yet: made
        // now, and sent as it is made (v0.8.11; before, the Node server's).
        var job = Transcoder.Start(new ConvTrack(id, t.Path, mtime), ConvPlan.Of(p));
        if (job.Done && !job.Failed) return await SendFile(ctx, job.Final, Jv.Str(p["mime"]));
        if (job.Done) { ctx.Response.StatusCode = 500; ctx.Response.Headers["X-Mandarin-Answered"] = "C#"; return true; }
        await Transcoder.TailFollow(ctx, job, Jv.Str(p["mime"]));
        return true;
    }

    /* The library row as lib/server/playback.js planFor reads it (a number left out: 0, as Number(null) || 0 has it). */
    internal static JsObj Row(string path, string codec, long rate, long bits, long channels) =>
        Jv.Obj(("path", path), ("codec", codec), ("sample_rate", (double)rate), ("bits", (double)bits), ("channels", (double)channels));
    private static JsObj Row(Track t) => Row(t.Path, t.Codec, t.Rate, t.Bits, t.Channels);

    /*
     * devices.js dspFor(id): the device's DSP as Biquad.normalise keeps it,
     * read from audio_devices as the device fetches; null for none, a Sonos
     * room (Trueplay's), or a setting that doesn't read.
     */
    private static object? DspFor(SqliteConnection c, string id)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT kind, settings FROM audio_devices WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        using var r = cmd.ExecuteReader();
        if (!r.Read() || (!r.IsDBNull(0) && Convert.ToString(r.GetValue(0), CultureInfo.InvariantCulture) == "sonos")) return null;
        // registry.js parseJson: the settings when they are an object (an array is one too), else {}.
        object? settings = null;
        try { settings = r.IsDBNull(1) ? null : Mandarin.Server.Scan.JsJson.Parse(Convert.ToString(r.GetValue(1), CultureInfo.InvariantCulture) ?? ""); }
        catch (Exception) { /* not JSON: {} */ }
        var dsp = settings is JsObj o ? o["dsp"] : Tags.Undef.V;
        try { return Biquad.Normalise(dsp); } catch (Exception) { return null; }
    }

    /*
     * req.query[name] as Express's query parser (qs) makes it, where that is
     * plain: (true, the value) once, (false, null) not there; null where qs
     * would make an array or an object of it (name=1&name=2, name[]=, [name]=),
     * which this side leaves to the Node server.
     */
    internal static (bool Here, string? Value)? QueryOne(string query, string name)
    {
        if (query.Length == 0) return (false, null);
        var clean = query.Replace("%5B", "[", StringComparison.OrdinalIgnoreCase).Replace("%5D", "]", StringComparison.OrdinalIgnoreCase);
        var parts = clean.Split('&');
        string? found = null;
        for (var n = 0; n < parts.Length && n < 1000; n++)   // parameterLimit
        {
            var part = parts[n];
            var bracketEquals = part.IndexOf("]=", StringComparison.Ordinal);
            var pos = bracketEquals == -1 ? part.IndexOf('=') : bracketEquals + 1;
            var key = Signing.Decode(pos == -1 ? part : part[..pos]);
            if (key == name)
            {
                if (found != null) return null;   // twice: an array
                found = pos == -1 ? "" : Signing.Decode(part[(pos + 1)..]);
            }
            else if (key.StartsWith(name + "[", StringComparison.Ordinal) || key.StartsWith('[')) return null;
        }
        return found != null ? (true, found) : (false, null);
    }

    public static async Task<bool> SendFile(HttpContext ctx, string file, string mime)
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
