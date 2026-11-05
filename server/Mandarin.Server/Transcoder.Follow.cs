// Transcoder.Follow.cs — a file sent as it is made (stream.js tailFollow; out of Transcoder.cs for room, item 272).
//
// What there is, then the rest as it comes, until the making is done. With no length known it goes out chunked,
// as an internet radio stream does, without ranges. A DSF made from PCM, or a WAV made as it plays (its length
// known from its header's: items 262, 270), goes with its length and takes ranges, the bytes asked for sent as they
// come; and asked for bytes far past what is made, the making is begun again there (Upsample/Resume.cs), only made
// bytes ever sent.
using System.Globalization;

namespace Mandarin.Server;

internal static partial class Transcoder
{
    /* [job]'s file to [ctx] as [mime] as it is made; [length]: its size, where known, which takes ranges. */
    public static async Task TailFollow(HttpContext ctx, ConvJob job, string mime, long length = -1)
    {
        ctx.Response.ContentType = mime;
        ctx.Response.Headers.CacheControl = "no-store";
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        long pos = 0, end = long.MaxValue;
        if (length >= 0)
        {
            ctx.Response.Headers.AcceptRanges = "bytes";
            (pos, end) = Range(ctx.Request.Headers.Range.ToString(), length);
            if (pos > end) { ctx.Response.StatusCode = 416; ctx.Response.Headers.ContentRange = $"bytes */{length}"; return; }
            ctx.Response.StatusCode = pos == 0 && end == length - 1 ? 200 : 206;
            if (ctx.Response.StatusCode == 206) ctx.Response.Headers.ContentRange = $"bytes {pos}-{end}/{length}";
            ctx.Response.ContentLength = end - pos + 1;
        }
        else
        {
            ctx.Response.StatusCode = 200;
            ctx.Response.Headers.AcceptRanges = "none";
        }
        if (HttpMethods.IsHead(ctx.Request.Method)) return;
        // This reader's number: the newest moves a making begun again (item 272).
        var ticket = Interlocked.Increment(ref job.Readers);
        var buf = new byte[256 * 1024];
        var aborted = ctx.RequestAborted;
        FileStream? fs = null;
        try
        {
            while (!aborted.IsCancellationRequested)
            {
                if (fs == null)
                {
                    // The .part, or the finished file it was renamed to (the same bytes, at the same place); unbuffered,
                    // as a making begun again cuts it back.
                    foreach (var f in new[] { job.Part, job.Final })
                    {
                        try { fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1); fs.Position = pos; break; }
                        catch (IOException) { fs = null; }
                    }
                    if (fs == null)
                    {
                        if (job.Done) { if (job.Failed) ctx.Abort(); return; }
                        job.Want(pos); await Task.WhenAny(job.More, Task.Delay(100, aborted));
                        continue;
                    }
                }
                var more = job.More; job.Want(pos);   // read so far (item 271)
                if (pos > end) return;
                var want = end == long.MaxValue ? buf.Length : (int)Math.Min(buf.Length, end - pos + 1);
                // Made as it plays, with its length: only what is made of it read; asked for far past that, made again from there.
                var resume = job.Resume;
                var epoch = 0;
                if (resume != null)
                {
                    var until = resume.Until(pos, fs.Length);
                    if (until < 0)
                    {
                        if (job.Done) { ctx.Abort(); return; }
                        resume.Ask(pos, ticket);
                        await ctx.Response.Body.FlushAsync(aborted);
                        await Task.WhenAny(more, Task.Delay(200, aborted));
                        continue;
                    }
                    if (!job.Done) resume.Near(pos, ticket);
                    want = (int)Math.Min(want, until - pos);
                    epoch = resume.Epoch;
                    fs.Position = pos;
                }
                int n = await fs.ReadAsync(buf.AsMemory(0, want), aborted);
                // Cut back while it was read: read again, from what is made now.
                if (resume != null && resume.Epoch != epoch) { fs.Position = pos; continue; }
                if (n > 0)
                {
                    pos += n;
                    await ctx.Response.Body.WriteAsync(buf.AsMemory(0, n), aborted);
                    continue;
                }
                if (job.Done)
                {
                    // Finished while this was reading: anything written last is read before the end.
                    n = await fs.ReadAsync(buf.AsMemory(0, want), aborted);
                    if (n > 0) { pos += n; await ctx.Response.Body.WriteAsync(buf.AsMemory(0, n), aborted); continue; }
                    // Short of the length it went out with (a making that failed): cut, so that the device knows.
                    if (job.Failed || end != long.MaxValue && pos <= end) ctx.Abort();
                    return;
                }
                await ctx.Response.Body.FlushAsync(aborted);
                await Task.WhenAny(more, Task.Delay(200, aborted));
            }
        }
        catch (OperationCanceledException) { /* the device went away */ }
        finally { fs?.Dispose(); }
    }

    // A Range header's first range over [length] bytes: its first and last byte (the whole file where none is asked).
    private static (long From, long To) Range(string header, long length)
    {
        var m = System.Text.RegularExpressions.Regex.Match(header, @"^bytes=(\d*)-(\d*)");
        if (!m.Success || m.Groups[1].Value.Length == 0 && m.Groups[2].Value.Length == 0) return (0, length - 1);
        if (m.Groups[1].Value.Length == 0) { var last = Math.Min(length, long.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture)); return (length - last, length - 1); }
        var from = long.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
        var to = m.Groups[2].Value.Length > 0 ? Math.Min(length - 1, long.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture)) : length - 1;
        return (from, to);
    }
}
