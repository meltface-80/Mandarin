// Resume.cs — a making restarted where the device seeks to, as Roon restarts its DSP there (bug list item 272).
//
// A DSF (or a WAV above FLAC's rates) made as it plays is sent with its length, and a device seeks in it as in any
// file: it asks for the bytes from where the time it seeks to falls. Asked for bytes not yet made, it waited for the
// making to get there, at a little more than twice real time for DSD256 from the start of the track: a minute and
// more for a seek to its middle. The FiiO SR11 gave up waiting, and stayed silent: Back (a seek to the start) on that
// same stuck stream played nothing; only the next track, a new address, played again.
//
// Now a device asking for bytes more than [Soon] seconds of music beyond what is made has the making stopped and
// begun again from there: the track decoded from the frame that byte holds (a DSF's block, a WAV's frame), its file
// written from that byte on, the bytes before it kept. What of the file is made is [0, prefix) and [from, its
// length); bytes between are never sent. Read on up to the gap (back at the start, playing on), the making is begun
// again where the first part ends, a little before the device gets there, and the file is whole again. A file left
// with a gap when its making ends isn't kept: the next play makes it again from its start. Only the newest of a
// file's readers (ConvJob.Readers) moves the making (an older one, left waiting, would move it back).
using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;

namespace Mandarin.Server.Upsample;

internal sealed class Resume
{
    /* Seconds of music past what is made that a device's ask is waited for, not made again from; and how far ahead of a gap it is closed. */
    public const double Soon = 3, Ahead = 5;

    private readonly ConvJob job;
    private readonly long header, unit, unitFrames, carry, rate, total;
    private readonly double perSecond;
    private readonly object gate = new();
    private long prefix, from;       // made: [0, length) where from is 0; else [0, prefix) and [from, length)
    private long? frame;             // the file's frame a restart asked for, not yet begun
    private Process? proc;
    private bool ended;
    private int epoch;

    /*
     * The restarts of [job]'s file: [header] bytes, then [unit] bytes for each [unitFrames] frames at [rate] (a DSF's
     * pair of blocks, a WAV's frame upsampled), [carry] of them the track before's; [total] bytes in all.
     */
    public Resume(ConvJob job, long header, long unit, long unitFrames, long carry, long rate, long total)
    {
        this.job = job;
        (this.header, this.unit, this.unitFrames, this.carry, this.rate, this.total) = (header, unit, unitFrames, carry, rate, total);
        perSecond = unit / (double)unitFrames * rate;
    }

    /* For a DSF made of [p], [seconds] long, with [carry] frames of the track before; null where it has no length. */
    public static Resume? ForDsf(ConvJob job, ConvPlan p, long id, double seconds, long carry)
    {
        var from = DsdPlan.FromRate((long)p.InRate, p.DsdBase);
        var ratio = from > 0 ? DsdPlan.DsdRate(p.DsdUp, p.DsdBase) / from : 0;
        if (ratio <= 0 || seconds <= 0) return null;
        return new Resume(job, DsfWriter.HeaderSize, 2L * DsfWriter.Block, DsfWriter.Block * 8L / ratio, carry, from, DsdPlan.FileBytes(id, p, seconds));
    }

    /* For a WAV made of [p], [seconds] long; null where it has no length. */
    public static Resume? ForWav(ConvJob job, ConvPlan p, double seconds)
    {
        var own = (long)p.InRate;
        if (own <= 0 || seconds <= 0 || !p.Wav) return null;
        return new Resume(job, WavHeader.Size, p.Rate / own * 2 * (p.Bits / 8), 1, 0, own, WavHeader.FileBytes(p, seconds));
    }

    /* The track's file name, as the log says it. */
    public string Track { get; set; } = "";

    /* Bumped whenever the file is cut back for a restart: a read across it is read again. */
    public int Epoch => Volatile.Read(ref epoch);

    /* The making now writing the file. */
    public void Writing(Process p) { lock (gate) proc = p; }

    /* How far from [pos] the file, [length] bytes long, is made: the byte after; -1 where [pos] is not made. */
    public long Until(long pos, long length)
    {
        lock (gate)
        {
            if (from == 0) return pos < length ? length : -1;
            if (pos < prefix) return prefix;
            return pos >= from && pos < length ? length : -1;
        }
    }

    /*
     * Reader [ticket] at [pos], not made: the making begun again from there, unless it will be there soon (within
     * [Soon] s of music of where it writes) or another reader has come since.
     */
    public void Ask(long pos, int ticket)
    {
        lock (gate)
        {
            if (ended || ticket != Volatile.Read(ref job.Readers) || proc == null || pos >= total) return;
            var length = Length();
            if (Until(pos, length) >= 0) return;
            var soon = (long)(perSecond * Soon);
            if (pos >= from && pos <= length + soon) return;
            if (frame is { } waiting && pos >= Byte(waiting) && pos <= Byte(waiting) + soon) return;
            // What is made from the start, to its last whole unit: what is kept.
            var kept = from == 0 ? Align(length) : prefix;
            var at = Align(pos);
            if (at - kept < perSecond) at = kept;   // a second or less past it: the gap filled instead
            var fileFrame = (at - header) / unit * unitFrames;
            if (fileFrame < carry) return;
            try { Pace.Release(proc.Id); proc.Kill(true); proc.WaitForExit(3000); } catch (InvalidOperationException) { /* ended already */ }
            try { using var f = new FileStream(job.Part, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete); f.SetLength(at); }
            catch (IOException) { return; }
            if (at <= kept) (prefix, from) = (0, 0);
            else (prefix, from) = (kept, at);
            frame = fileFrame;
            proc = null;
            Interlocked.Increment(ref epoch);
            Interlocked.Exchange(ref job.Wanted, at);
            Server.Log($"[upsample] {Track}: made again from {Math.Round((fileFrame - carry) / (double)rate, 1).ToString(CultureInfo.InvariantCulture)} s, where the device asked for it");
        }
    }

    /* Reader [ticket] at [pos], reading towards the gap: the making begun again at it, a little before the reader gets there. */
    public void Near(long pos, int ticket)
    {
        long gap;
        lock (gate) { if (from == 0 || pos >= prefix || prefix - pos > perSecond * Ahead) return; gap = prefix; }
        Ask(gap, ticket);
    }

    /* Whether a restart was asked for, the file's [frame] where it begins; else no more are taken. */
    public bool Again(out long fileFrame)
    {
        lock (gate)
        {
            fileFrame = frame ?? 0;
            if (frame != null) { frame = null; return true; }
            ended = true;
            return false;
        }
    }

    /* Whether the file is made whole (no gap left by a restart). */
    public bool Whole { get { lock (gate) return from == 0; } }

    /* Whether it was made again part way. */
    public bool Restarted { get; private set; }

    /* The making's [spec] begun again at the file's [fileFrame] (Again): the track decoded from there, its file written from the byte it falls at. */
    public JsonObject From(JsonObject spec, long fileFrame)
    {
        Restarted = true;
        var o = spec.DeepClone().AsObject();
        var own = (long?)o["carry"] ?? 0;
        var skip = fileFrame - own;
        o.Remove("before");
        o.Remove("carry");
        o["frames"] = Math.Max(1, ((long?)o["frames"] ?? 0) - skip);
        if (o["decode"] is JsonArray d)
        {
            var i = d.Select(x => (string?)x).ToList().IndexOf("-i");
            if (i >= 0) { d.Insert(i, "-ss"); d.Insert(i + 1, (skip / (double)rate).ToString("0.000000", CultureInfo.InvariantCulture)); }
        }
        var at = Byte(fileFrame);
        if (o["wav"] is JsonObject w) w["at"] = at;
        else o["at"] = at;
        return o;
    }

    private long Byte(long fileFrame) => header + fileFrame / unitFrames * unit;

    private long Align(long b) => b <= header ? header : header + (b - header) / unit * unit;

    private long Length()
    {
        try { return new FileInfo(job.Part).Length; } catch (IOException) { return 0; }
    }
}
