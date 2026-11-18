// IBroadcastUploadFiles.cs — a file on its way to iBroadcast (item 446), as iBroadcast's own uploader sends one
// (github.com/iBroadcastMediaServices/ibroadcast-uploaders, python):
//   - what is there already: an empty POST to upload.ibroadcast.com, Bearer <access token>, answers { md5: [...] }, the
//     MD5 of every file in the library; a file whose MD5 is among them isn't sent again;
//   - a file: a multipart POST there, the file as "file", its path here as "file_path" and the client as "method";
//     "result": false is a failure, in iBroadcast's words. Its login refused (a 401, or an answer saying it couldn't
//     confirm the login: item 454, two files of a real upload so) is signed in again (the token refreshed, or the one
//     another call has just refreshed taken) and sent once more; refused again, the upload ends, the sign-in bad; busy
//     (429, 5xx, no answer), waited for and sent again, three times at most.
// A file iBroadcast can't keep as it is is made FLAC first, in the data folder, tags and cover with it: DSD (which
// iBroadcast can't play) at 24-bit/176.4 kHz, the most of DSD64 PCM keeps, or 88.2 kHz where that is over the limit;
// a lossless file over iBroadcast's 1.5 GB at FLAC's most compression, or at half its rate where that is still over.
using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;

namespace Mandarin.Server.Services.IBroadcast;

internal sealed class IBroadcastUploadFiles(IBroadcastApi api, string dataDir)
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler { PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30), UseProxy = false })
        { Timeout = Timeout.InfiniteTimeSpan };

    /// <summary>How long to wait before each try again of a file iBroadcast was too busy for (the tests' shorter).</summary>
    public TimeSpan[] Waits { get; init; } = [TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(5)];

    /// <summary>A file not sent, and why, in words.</summary>
    public sealed class NotSent(string why) : Exception(why);

    /// <summary>The MD5 of every file in the iBroadcast library.</summary>
    public async Task<HashSet<string>> Md5s(CancellationToken stop)
    {
        var (status, text) = await Post(() => null, stop);
        var j = Parse(text);
        if (status >= 400 || j?["md5"] is not JsonArray list) throw new ServiceError(Said(j, $"iBroadcast didn't say what it has ({status})"), 502);
        return [.. list.Select(m => IBroadcastApi.Str(m)?.ToLowerInvariant()).OfType<string>()];
    }

    /// <summary>
    /// [file] sent, as [path] (the file's here, its extension the one sent); [sent] told the bytes as they go. What
    /// iBroadcast said as it took it (its message, or its answer where it has none; kept, item 477).
    /// </summary>
    public async Task<string> Send(string file, string path, Action<long> sent, CancellationToken stop)
    {
        for (var tried = 0; ; tried++)
        {
            int status;
            string text;
            try
            {
                (status, text) = await Post(() =>
                {
                    var form = new MultipartFormDataContent();
                    var body = new StreamContent(new Counted(File.OpenRead(file), sent), 1 << 16);
                    body.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                    form.Add(body, "file", Path.GetFileName(path));
                    form.Add(new StringContent(path), "file_path");
                    form.Add(new StringContent("mandarin"), "method");
                    return form;
                }, stop);
            }
            catch (ServiceError e) when (e.Status == 502 && tried < Waits.Length) { await Wait(tried, e.Message, stop); continue; }
            if ((status == 429 || status >= 500) && tried < Waits.Length) { await Wait(tried, $"iBroadcast answered {status}", stop); continue; }
            var j = Parse(text);
            if (status >= 400) throw new NotSent(Said(j, $"iBroadcast answered {status}"));
            if (j?["result"] is JsonValue r && r.TryGetValue<bool>(out var ok) && !ok) throw new NotSent(Said(j, "iBroadcast refused it"));
            var said = Said(j, text.Trim());
            return said.Length > 200 ? said[..200] : said;
        }
    }

    private async Task Wait(int tried, string why, CancellationToken stop)
    {
        Server.Log($"[ibroadcast] upload: {why}; trying again in {Waits[tried].TotalSeconds:0} s");
        await Task.Delay(Waits[tried], stop);
    }

    /* A POST to the upload server ([content]: none to ask what it has), signed in again once where it refuses the login. */
    private async Task<(int Status, string Text)> Post(Func<HttpContent?> content, CancellationToken stop)
    {
        var access = await api.Access();
        for (var again = false; ; again = true)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, api.Upload) { Content = content() };
            req.Headers.TryAddWithoutValidation("User-Agent", IBroadcastApi.Agent);
            req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + access);
            HttpResponseMessage res;
            try { res = await Http.SendAsync(req, stop); }
            catch (Exception e) when (e is HttpRequestException or IOException || (e is TaskCanceledException && !stop.IsCancellationRequested))
            {
                throw new ServiceError("iBroadcast couldn't be reached (" + e.Message + ")", 502);
            }
            using (res)
            {
                var text = await res.Content.ReadAsStringAsync(stop);
                var refused = LoginRefused((int)res.StatusCode, text);
                if (refused && !again)
                {
                    Server.Log("[ibroadcast] upload: iBroadcast didn't take the sign-in; signed in again, and sent once more");
                    access = IBroadcastApi.Str((await api.Refresh(access))["access"])!;
                    continue;
                }
                if (refused) throw new ServiceError("iBroadcast turned the sign-in down twice: sign out and back in on iBroadcast's page", 401);
                return ((int)res.StatusCode, text);
            }
        }
    }

    /// <summary>The MD5 of [file], as iBroadcast keeps it: lower-case hex.</summary>
    public static Task<string> Md5(string file, CancellationToken stop) => Task.Run(() =>
    {
        using var s = File.OpenRead(file);
        return Convert.ToHexStringLower(Fingerprint.Md5(s));
    }, stop);

    /// <summary>
    /// [src] made FLAC in the data folder: at [rate] (0: its own), [bits] deep, at FLAC's most compression, its tags and
    /// cover kept (the cover left out where ffmpeg can't put it in a FLAC). The file made; the caller deletes it.
    /// </summary>
    public async Task<string> Flac(string src, long rate, int bits, CancellationToken stop)
    {
        var dir = Path.Combine(dataDir, "ibroadcast-upload");
        Directory.CreateDirectory(dir);
        var dest = Path.Combine(dir, Guid.NewGuid().ToString("N") + ".flac");
        string err = "";
        foreach (var cover in new[] { true, false })
        {
            err = await Ffmpeg(Args(src, rate, bits, cover, dest), stop);
            if (err.Length == 0 && File.Exists(dest)) return dest;
        }
        try { File.Delete(dest); } catch (IOException) { /* never made */ }
        throw new NotSent("It couldn't be made FLAC: " + (err.Length > 200 ? err[..200] : err));
    }

    /// <summary>A FLAC's sample rate, as its STREAMINFO says it; null where [file] isn't one.</summary>
    public static long? FlacRate(string file)
    {
        var b = new byte[21];
        try
        {
            using var s = File.OpenRead(file);
            if (s.Read(b, 0, b.Length) < b.Length || b[0] != 'f' || b[1] != 'L' || b[2] != 'a' || b[3] != 'C') return null;
        }
        catch (IOException) { return null; }
        // STREAMINFO from byte 8: the sample rate the 20 bits from its byte 10.
        return (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
    }

    /// <summary>ffmpeg's arguments for [src] made FLAC at [rate] and [bits], with its cover or without.</summary>
    internal static List<string> Args(string src, long rate, int bits, bool cover, string dest)
    {
        var a = new List<string> { "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", src, "-map", "0:a:0" };
        if (cover) a.AddRange(["-map", "0:v?", "-c:v", "copy", "-disposition:v", "attached_pic"]);
        else a.Add("-vn");
        if (rate > 0)
        {
            var soxr = Transcoder.Soxr ? "resampler=soxr:precision=28:" : "";
            a.AddRange(["-af", $"aresample={soxr}osr={rate.ToString(CultureInfo.InvariantCulture)}:dither_method=triangular", "-ar", rate.ToString(CultureInfo.InvariantCulture)]);
        }
        a.AddRange(["-sample_fmt", bits <= 16 ? "s16" : "s32", "-bits_per_raw_sample", bits <= 16 ? "16" : "24", "-map_metadata", "0",
            "-c:a", "flac", "-compression_level", "12", "-f", "flac", dest]);
        return a;
    }

    /* ffmpeg run on [args] at the background's priority: what it said where it failed, "" where it didn't. */
    private static async Task<string> Ffmpeg(List<string> args, CancellationToken stop)
    {
        var psi = new ProcessStartInfo(Transcoder.Bin) { UseShellExecute = false, RedirectStandardError = true, RedirectStandardInput = true };
        foreach (var x in args) psi.ArgumentList.Add(x);
        Cpu.Place(psi, CpuKind.Background);
        using var proc = Process.Start(psi) ?? throw new NotSent("ffmpeg couldn't be started");
        Cpu.Adopt(proc, CpuKind.Background);
        try
        {
            proc.StandardInput.Close();
            var err = await proc.StandardError.ReadToEndAsync(stop);
            await proc.WaitForExitAsync(stop);
            return proc.ExitCode == 0 ? "" : err.Trim() is { Length: > 0 } e ? e : "ffmpeg ended " + proc.ExitCode;
        }
        catch (OperationCanceledException) { try { proc.Kill(true); } catch (InvalidOperationException) { /* gone */ } throw; }
        finally { Cpu.Forget(proc); }
    }

    /// <summary>Whether the upload server's answer ([status], [text]) refuses the login: a 401, "authenticated": false, or its words that it couldn't confirm it.</summary>
    internal static bool LoginRefused(int status, string text)
    {
        if (status == 401) return true;
        if (Parse(text) is not JsonObject j) return false;
        if (j["authenticated"] is JsonValue a && a.TryGetValue<bool>(out var signed) && !signed) return true;
        return j["result"] is JsonValue r && r.TryGetValue<bool>(out var ok) && !ok && Said(j, "").Contains("login couldn't be confirmed", StringComparison.OrdinalIgnoreCase);
    }

    private static JsonNode? Parse(string text)
    {
        try { return text.Length > 0 ? JsonNode.Parse(text) : null; } catch (System.Text.Json.JsonException) { return null; }
    }

    private static string Said(JsonNode? j, string or) => IBroadcastApi.Str(j?["message"]) ?? IBroadcastApi.Str(j?["error"]) ?? or;

    /* A file read as it is sent, each read told. */
    private sealed class Counted(Stream inner, Action<long> sent) : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => inner.CanSeek;
        public override bool CanWrite => false;
        public override long Length => inner.Length;
        public override long Position { get => inner.Position; set => inner.Position = value; }
        public override int Read(byte[] buffer, int offset, int count) { var n = inner.Read(buffer, offset, count); sent(n); return n; }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken token = default) { var n = await inner.ReadAsync(buffer, token); sent(n); return n; }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => inner.Seek(offset, origin);
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); base.Dispose(disposing); }
    }
}
