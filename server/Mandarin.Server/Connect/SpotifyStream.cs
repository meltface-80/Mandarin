// SpotifyStream.cs — GET /stream/spotify/live.flac (bug list items 142, 501): Spotify's sound as the room fetches it,
// one endless FLAC stream. Soloist's samples (S32 LE, 44.1 kHz, stereo: SoloistTap) go through ffmpeg to FLAC, made
// as the room's plan says (SpotifyRoomPlan.cs, carried in the address): as it comes, 24-bit, so Spotify's 24-bit
// lossless arrives exactly (the lowest byte of the 32 is always zero, and FLAC at 24 bits leaves it out); upsampled by
// Mandarin's own upsampler (Upsample/StreamUpsample.cs) in the room's filter where the room upsamples; at another
// rate by ffmpeg's resampler where the room takes no 44.1 kHz. ?bits=16 for a device that takes no more; ?q=opus (a
// phone away) as Opus at 256 kbps in Ogg, as tracks are. No length and no ranges: it plays as long as Spotify does.
// Signed, as every stream is: speakers can't sign in. One at a time: a second fetch (the room again, after a pause)
// ends the first.
using System.Buffers.Binary;
using System.Diagnostics;
using System.Globalization;
using Mandarin.Server.Upsample;

namespace Mandarin.Server.Connect;

internal static class SpotifyStream
{
    /* Answers [path] when it is Spotify's stream; false otherwise (the next handler's). */
    public static async Task<bool> Answer(HttpContext ctx, string path)
    {
        if (path != SpotifyLive.StreamPath) return false;
        using (var c = Db.Open())
            if (!Images.Signed(ctx, c) && !Auth.Through(ctx, c) && !await Images.FromSpeaker(ctx)) return false;
        var player = SpotifyLive.Player;
        if (player == null) { ctx.Response.StatusCode = 404; return true; }
        var sound = SpotifyRoomPlan.Read(ctx.Request.Query);
        var opus = ctx.Request.Query["q"].ToString() == "opus";
        ctx.Response.ContentType = opus ? "audio/ogg" : "audio/flac";
        ctx.Response.Headers.CacheControl = "no-store";
        ctx.Response.Headers.AcceptRanges = "none";
        if (HttpMethods.IsHead(ctx.Request.Method)) return true;

        using var tap = player.Open();
        using var ff = Process.Start(Encoder(sound, opus)) ?? throw new InvalidOperationException("ffmpeg didn't start");
        _ = ff.StandardError.ReadToEndAsync();
        var gone = ctx.RequestAborted;
        // Soloist's samples into ffmpeg, as they come (the tap waits for them; the room's pace holds them back).
        var feed = Task.Run(() =>
        {
            try
            {
                using var into = ff.StandardInput.BaseStream;
                if (sound.Factor > 1 && !opus) Upsampled(tap, into, sound, gone);
                else AsTheyCome(tap, into, gone);
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

    private static void AsTheyCome(SoloistTap tap, Stream into, CancellationToken gone)
    {
        var buf = new byte[1 << 14];
        int n;
        while (!gone.IsCancellationRequested && (n = tap.Read(buf, gone)) > 0) into.Write(buf, 0, n);
    }

    /* Soloist's samples upsampled as they come, a block at a time (93 ms of them with the usual filters), handed to ffmpeg as 64-bit floats. */
    internal static void Upsampled(SoloistTap tap, Stream into, RoomSound sound, CancellationToken gone)
    {
        var outBuf = Array.Empty<byte>();
        var up = new StreamUpsample(sound.Factor, Shape.Of(sound.Shape), (a, b, n) =>
        {
            if (outBuf.Length < n * 16) outBuf = new byte[n * 16];
            for (int i = 0; i < n; i++)
            {
                BinaryPrimitives.WriteDoubleLittleEndian(outBuf.AsSpan(i * 16), a[i]);
                BinaryPrimitives.WriteDoubleLittleEndian(outBuf.AsSpan(i * 16 + 8), b[i]);
            }
            into.Write(outBuf, 0, n * 16);
        });
        var buf = new byte[1 << 14];
        var l = new double[buf.Length / 8];
        var r = new double[buf.Length / 8];
        int have = 0, n;
        while (!gone.IsCancellationRequested && (n = tap.Read(buf.AsSpan(have), gone)) > 0)
        {
            have += n;
            int frames = have / 8;
            for (int i = 0; i < frames; i++)
            {
                l[i] = BinaryPrimitives.ReadInt32LittleEndian(buf.AsSpan(i * 8)) / 2147483648.0;
                r[i] = BinaryPrimitives.ReadInt32LittleEndian(buf.AsSpan(i * 8 + 4)) / 2147483648.0;
            }
            up.Push(l.AsSpan(0, frames), r.AsSpan(0, frames));
            Array.Copy(buf, frames * 8, buf, 0, have - frames * 8);
            have -= frames * 8;
        }
    }

    /* ffmpeg: Soloist's samples in (or the upsampler's floats), FLAC as [sound] says out ([opus]: Opus at 256 kbps in Ogg). */
    internal static ProcessStartInfo Encoder(RoomSound sound, bool opus = false)
    {
        var bin = Environment.GetEnvironmentVariable("FFMPEG_PATH") is { Length: > 0 } b ? b : "ffmpeg";
        var psi = new ProcessStartInfo(bin) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        static string S(int v) => v.ToString(CultureInfo.InvariantCulture);
        var upsampled = sound.Factor > 1 && !opus;
        var args = new List<string> { "-hide_banner", "-loglevel", "error" };
        args.AddRange(upsampled
            ? ["-f", "f64le", "-ar", S(sound.Rate), "-ac", "2", "-i", "pipe:0"]
            : ["-f", "s32le", "-ar", S(Soloist.Rate), "-ac", "2", "-i", "pipe:0"]);
        args.AddRange(["-map", "0:a", "-flush_packets", "1"]);
        if (opus) args.AddRange(["-c:a", "libopus", "-b:a", "256k", "-vbr", "on", "-f", "ogg", "pipe:1"]);
        else
        {
            // Another rate the room takes (no upsampler): ffmpeg's best resampler. To fewer bits than Spotify's 24, or from floats: dithered.
            var dither = sound.Bits == 32 ? "dither_method=0" : sound.Bits == 16 ? "dither_method=triangular_hp" : "dither_method=triangular";
            if (!upsampled && sound.Rate != Soloist.Rate) args.AddRange(["-af", $"aresample=resampler=soxr:precision=33:osr={S(sound.Rate)}:{dither}", "-ar", S(sound.Rate)]);
            else if (upsampled || sound.Bits == 16) args.AddRange(["-af", $"aresample={dither}"]);
            args.AddRange(["-c:a", "flac", "-compression_level", "1", "-sample_fmt", sound.Bits == 16 ? "s16" : "s32", "-bits_per_raw_sample", S(sound.Bits), "-f", "flac", "pipe:1"]);
        }
        foreach (var a in args) psi.ArgumentList.Add(a);
        return psi;
    }
}
