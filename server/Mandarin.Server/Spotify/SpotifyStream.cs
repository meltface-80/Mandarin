// SpotifyStream.cs — GET /stream/spotify/live.flac (bug list item 142): Spotify's sound as the room fetches it, one
// endless FLAC stream. Soloist's samples (S32 LE, 44.1 kHz, stereo: SoloistTap) go through ffmpeg to FLAC: 24-bit, so
// Spotify's 24-bit lossless arrives exactly (the lowest byte of the 32 is always zero, and FLAC at 24 bits leaves it
// out); ?bits=16 for a device that takes no more. No length and no ranges: it plays as long as Spotify does. Signed, as
// every stream is: speakers can't sign in. One at a time: a second fetch (the room again, after a pause) ends the first.
using System.Diagnostics;

namespace Mandarin.Server.Spotify;

internal static class SpotifyStream
{
    /* Answers [path] when it is Spotify's stream; false otherwise (the next handler's). */
    public static async Task<bool> Answer(HttpContext ctx, string path)
    {
        if (path != SpotifyLive.StreamPath) return false;
        using (var c = Db.Open())
            if (!Images.Signed(ctx, c) && Auth.DeviceOf(ctx, c) == null && !await Images.FromSpeaker(ctx)) return false;
        var player = SpotifyLive.Player;
        if (player == null) { ctx.Response.StatusCode = 404; return true; }
        var bits = ctx.Request.Query["bits"].ToString() == "16" ? 16 : 24;
        ctx.Response.ContentType = "audio/flac";
        ctx.Response.Headers.CacheControl = "no-store";
        ctx.Response.Headers.AcceptRanges = "none";
        if (HttpMethods.IsHead(ctx.Request.Method)) return true;

        using var tap = player.Open();
        using var ff = Process.Start(Encoder(bits)) ?? throw new InvalidOperationException("ffmpeg didn't start");
        _ = ff.StandardError.ReadToEndAsync();
        var gone = ctx.RequestAborted;
        // Soloist's samples into ffmpeg, as they come (the tap waits for them; the room's pace holds them back).
        var feed = Task.Run(() =>
        {
            var buf = new byte[1 << 14];
            try
            {
                using var into = ff.StandardInput.BaseStream;
                int n;
                while (!gone.IsCancellationRequested && (n = tap.Read(buf, gone)) > 0) into.Write(buf, 0, n);
            }
            catch (IOException) { /* ffmpeg gone: the room let go */ }
        }, CancellationToken.None);
        try { await ff.StandardOutput.BaseStream.CopyToAsync(ctx.Response.Body, gone); }
        catch (Exception e) when (e is IOException or OperationCanceledException) { /* the room let go, or another fetch took over */ }
        finally
        {
            tap.Dispose();
            try { if (!ff.HasExited) ff.Kill(); } catch (InvalidOperationException) { /* gone */ }
            await feed;
        }
        return true;
    }

    /* ffmpeg: S32 LE stereo 44.1 kHz in, FLAC of [bits] out, written as it comes. */
    internal static ProcessStartInfo Encoder(int bits)
    {
        var bin = Environment.GetEnvironmentVariable("FFMPEG_PATH") is { Length: > 0 } b ? b : "ffmpeg";
        var psi = new ProcessStartInfo(bin) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[]
                 {
                     "-hide_banner", "-loglevel", "error", "-f", "s32le", "-ar", Soloist.Rate.ToString(System.Globalization.CultureInfo.InvariantCulture), "-ac", "2", "-i", "pipe:0",
                     "-map", "0:a", "-c:a", "flac", "-compression_level", "1", "-flush_packets", "1",
                     "-sample_fmt", bits == 16 ? "s16" : "s32", "-bits_per_raw_sample", bits == 16 ? "16" : "24", "-f", "flac", "pipe:1"
                 })
            psi.ArgumentList.Add(a);
        return psi;
    }
}
