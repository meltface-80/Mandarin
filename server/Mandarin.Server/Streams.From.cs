// Streams.From.cs — a track begun part-way: /stream/t<id>…?ss=<seconds> (bug list item 313). A SlimProto player
// can't seek within what it fetches (Renderers/Slim/), so a seek is the track fetched again from that point. Made by
// Mandarin as it plays (an upsampling by a power of two, or DSD from PCM): begun there as an album's run begins at a
// point (Streams.Runs.cs, item 300), a run of one track. Anything else is ffmpeg's from that point: the file as
// stored, copied from there (FLAC, WAV, MP3); a conversion, made from there. DSD as it is stored can't be begun
// part-way by ffmpeg, and a track from a service isn't: both are refused (400).
using System.Diagnostics;
using System.Globalization;

namespace Mandarin.Server;

using JsObj = Mandarin.Server.Tags.JsObj;

internal static partial class Streams
{
    private static async Task<bool> AnswerFrom(HttpContext ctx, long id, Track t, JsObj p, (bool Here, string? Value) ss, bool service)
    {
        if (!double.TryParse(ss.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var at) || !double.IsFinite(at) || at < 0) return Refuse(ctx, 400);
        if (service || t.Duration > 0 && at >= t.Duration) return Refuse(ctx, 400);
        var made = Playback.Jv.T(p["transcode"]);
        if (made)
        {
            var plan = ConvPlan.Of(p);
            // Made as it plays: begun there as a run of one is.
            if (Upsample.AlbumRun.Takes(plan with { InRate = plan.InRate > 0 ? plan.InRate : t.Rate })) return await AnswerRun(ctx, id.ToString(CultureInfo.InvariantCulture), p, t.Rate, ss);
            if (plan.DsdUp != 0) return Refuse(ctx, 400);
            return await Piped(ctx, From(Transcoder.Args(t.Path, plan, "pipe:1"), at), Playback.Jv.Str(p["mime"]));
        }
        // The file as stored, from there: its own codec copied (DSD can't be).
        var ext = Path.GetExtension(t.Path).ToLowerInvariant();
        var format = ext switch { ".flac" => "flac", ".wav" => "wav", ".mp3" => "mp3", _ => null };
        if (format == null) return Refuse(ctx, 400);
        string[] copy = ["-hide_banner", "-nostdin", "-loglevel", "error", "-i", t.Path, "-map", "0:a:0", "-vn", "-c:a", "copy", "-f", format, "pipe:1"];
        return await Piped(ctx, From([.. copy], at), Playback.Jv.Str(p["mime"]));
    }

    /* ffmpeg's [args] begun [at] seconds into the input: -ss before its -i. */
    private static List<string> From(List<string> args, double at)
    {
        var i = args.IndexOf("-i");
        if (i < 0) return args;
        args.InsertRange(i, ["-ss", at.ToString("0.###", CultureInfo.InvariantCulture)]);
        return args;
    }

    /* ffmpeg run with [args], what it writes sent as it writes it, with no length (a player reads to the end). */
    private static async Task<bool> Piped(HttpContext ctx, List<string> args, string mime)
    {
        var psi = new ProcessStartInfo(Transcoder.Bin) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) psi.ArgumentList.Add(a);
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        ctx.Response.ContentType = mime;
        using var proc = Process.Start(psi);
        if (proc == null) { ctx.Response.StatusCode = 500; return true; }
        _ = proc.StandardError.ReadToEndAsync();
        if (HttpMethods.IsHead(ctx.Request.Method)) { try { proc.Kill(); } catch (InvalidOperationException) { /* gone */ } return true; }
        try { await proc.StandardOutput.BaseStream.CopyToAsync(ctx.Response.Body, ctx.RequestAborted); }
        catch (Exception e) when (e is OperationCanceledException or IOException) { /* the player went on, or stopped */ }
        finally { try { if (!proc.HasExited) proc.Kill(); } catch (InvalidOperationException) { /* gone */ } }
        return true;
    }
}
