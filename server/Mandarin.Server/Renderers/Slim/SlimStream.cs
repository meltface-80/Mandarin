// SlimStream.cs — the continuous PCM a Mandarin Bridge is played (item 322: SlimRuns.cs), at
// /stream/slim/<player>/<run>.pcm, signed as a track's address is (the gate lets it through as it lets /stream/ through,
// Auth.cs): the samples alone, no header, little-endian, as its strm said (SlimPcm.cs). Each track of the run is
// fetched from this server as the device would have fetched it (its address as Players made it: the file as stored,
// or upsampled, made DSD-free PCM, with its gain and DSP, begun part-way after a seek) and decoded by ffmpeg to exactly
// the run's format, the WAV header it writes read and left out, so the stream is one track's last sample then the
// next's first. A track that isn't what the run is (its rate or depth) ends the run; it is never converted here.
using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using Mandarin.Server.Playback;

namespace Mandarin.Server.Renderers.Slim;

internal static partial class SlimStream
{
    [GeneratedRegex(@"^/stream/slim/(SLIM_[0-9A-F]{12})/([0-9]{1,9})\.pcm\z")]
    private static partial Regex Address();

    public static void Use(WebApplication app) => app.Use(async (ctx, next) =>
    {
        var m = Address().Match(ctx.Request.Path.Value ?? "");
        if (!m.Success || !(HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method))) { await next(); return; }
        var player = Hub.Current?.Devices?.Slim?.Get(m.Groups[1].Value);
        var runs = player?.Runs;
        if (runs?.Get(int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture)) is not { Pcm: not null } run)
        {
            ctx.Response.StatusCode = 404; ctx.Response.Headers["X-Mandarin-Answered"] = "C#"; return;
        }
        ctx.Response.ContentType = "application/octet-stream";
        ctx.Response.Headers.CacheControl = "no-store";
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        if (HttpMethods.IsHead(ctx.Request.Method)) return;
        await Make(runs, run, ctx.Response.Body, ctx.RequestAborted, player!.Name);
    });

    /* The address of run [serial] of [playerId], on the server [trackUri] is fetched from (as the Bridge reaches it), signed. */
    public static string For(string trackUri, string playerId, int serial)
    {
        var u = new Uri(trackUri);
        string secret;
        using (var c = Db.Open()) secret = Db.Setting(c, "authSecret") is { } sv && Mandarin.Server.Js.Str(sv) is { Length: > 0 } s ? s : "";   // as Hub.Secret reads it
        return Signing.SignExpiring(secret, $"{u.Scheme}://{u.Authority}/stream/slim/{playerId}/{serial.ToString(CultureInfo.InvariantCulture)}.pcm");
    }

    /* [run] made into [body]: its tracks, then each set to follow while of its format, until it ends or is let go. */
    public static async Task Make(SlimRuns runs, SlimRuns.Run run, Stream body, CancellationToken aborted, string name)
    {
        using var both = CancellationTokenSource.CreateLinkedTokenSource(aborted, run.Gone.Token);
        var ct = both.Token;
        var (maker, had) = runs.Begin(run);
        var f = run.Pcm!;
        var tracks = 0;
        try
        {
            for (var i = 0; ; i++)
            {
                SlimRuns.Entry? e;
                if (i < had.Count) { runs.Starts(run, maker, i); e = had[i]; }
                else e = await runs.NextInto(run, maker, ct);
                if (e == null || !await Track(e.Fetch, f, body, n => runs.Made(run, maker, n), ct)) break;
                tracks++;
            }
        }
        catch (Exception x) when (x is OperationCanceledException or IOException or ObjectDisposedException) { /* let go, or the Bridge went */ }
        var how = ct.IsCancellationRequested ? "let go after" : "made to its end,";
        Server.Log($"[slimproto] {name}: run {run.Serial} ({f}) {how} {tracks} track(s), {run.Seconds.ToString("0.0", CultureInfo.InvariantCulture)} s");
        if (!ct.IsCancellationRequested) runs.Ended(run, maker);
    }

    /* This server's own address for [uri], where the device was given another (its LAN address): fetched from here. */
    private static string Local(string uri)
    {
        var u = new Uri(uri);
        var port = Hub.Current?.Config.Port ?? u.Port;
        return $"http://127.0.0.1:{port.ToString(CultureInfo.InvariantCulture)}{u.PathAndQuery}";
    }

    /* The track at [uri] decoded into [body] as [f]'s samples, whole frames; false where it couldn't be, or isn't [f]. */
    private static async Task<bool> Track(string uri, PcmFormat f, Stream body, Action<long> made, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(Transcoder.Bin) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-hide_banner", "-loglevel", "error", "-nostdin", "-i", Local(uri), "-map", "0:a:0", "-vn",
            "-ac", f.Channels.ToString(CultureInfo.InvariantCulture), "-c:a", f.Codec, "-f", "wav", "pipe:1" }) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new IOException("ffmpeg couldn't start");
        using var kill = ct.Register(() => { try { p.Kill(); } catch (InvalidOperationException) { /* gone */ } });
        var err = p.StandardError.ReadToEndAsync(CancellationToken.None);
        var input = p.StandardOutput.BaseStream;
        var buf = new byte[1 << 16];
        int got = 0, carry;
        (PcmFormat Format, int Start)? head = null;
        while (head == null)
        {
            var n = await input.ReadAsync(buf.AsMemory(got), ct);
            if (n <= 0) break;
            got += n;
            head = PcmFormat.FromWav(buf.AsSpan(0, got));
            if (head == null && got == buf.Length) break;
        }
        if (head is not { } h || h.Format != f)
        {
            ct.ThrowIfCancellationRequested();
            await p.WaitForExitAsync(CancellationToken.None);
            var why = head is { } w ? $"PCM {w.Format}, not the run's {f}" : "no PCM: " + (await err).Trim();
            Server.Log($"[slimproto] {Path.GetFileName(new Uri(uri).AbsolutePath)}: {why}; the run ends here");
            return false;
        }
        // The samples after the header, whole frames only; a part-frame waits for the rest.
        carry = got - h.Start;
        Buffer.BlockCopy(buf, h.Start, buf, 0, carry);
        for (;;)
        {
            var whole = carry - carry % f.FrameBytes;
            if (whole > 0)
            {
                await body.WriteAsync(buf.AsMemory(0, whole), ct);
                made(whole / f.FrameBytes);
                Buffer.BlockCopy(buf, whole, buf, 0, carry - whole);
                carry -= whole;
            }
            var n = await input.ReadAsync(buf.AsMemory(carry), ct);
            if (n <= 0) break;
            carry += n;
        }
        await body.FlushAsync(ct);
        await p.WaitForExitAsync(CancellationToken.None);
        // Broken off part-way (a file that ends early): what there was is in, and the run goes on to the next.
        if (p.ExitCode != 0) { var why = (await err).Trim(); Server.Log($"[slimproto] {Path.GetFileName(new Uri(uri).AbsolutePath)}: {why}"); }
        return true;
    }
}
