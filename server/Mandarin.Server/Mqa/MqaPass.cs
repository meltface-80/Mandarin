// MqaPass.cs — each track that can carry MQA looked at for its signalling (bug list item 418: MqaDetect.cs), in the
// background, after the library scan rather than in it.
//
// Why not in the scan: the scan reads a file's tags without decoding it (a millisecond or two a file); looking for MQA
// decodes its first ten seconds, which ffmpeg does in 57 ms for a 16/44.1 FLAC and 96 ms for a 24/96 one on a 4-core
// x64 (measured for item 418): thirty to fifty times the scan's own time, half an hour more on a library of 20,000
// tracks. So the scan stays as it was, and this follows it: one file at a time, never while the library is scanned
// nor while music plays (AlbumScanner.Playing: the Album Scanner's own hold), ffmpeg on the cores playback doesn't
// keep at the lowest priority (Cpu, as ReplayGain's measuring and the fingerprints), the samples read on a thread at
// nice 19. A tagged file first (the tags are a hint: MqaStore.cs), newest additions first. Decoding stops as soon as
// the sync word and what follows it are read; a file without them is read for its first ten seconds, as the
// identifiers read theirs (three seconds, one second: ten is surer, and costs little more).
using System.Diagnostics;
using System.Globalization;

namespace Mandarin.Server.Mqa;

internal sealed class MqaPass(Action<string> log, int tickMs)
{
    public const int Seconds = 10;

    private readonly object gate = new();
    private Timer? timer;
    private int ticking;

    /* Before the work is set up (Jobs.cs): nothing is started. */
    public Func<bool> Ready = () => true;
    public static int Looked;   // files looked at by this server (the tests read it through the log)

    public void Start()
    {
        lock (gate)
        {
            if (timer != null) return;
            timer = new Timer(_ => { _ = Tick(); }, null, tickMs, tickMs);
        }
    }

    public void Stop() { lock (gate) { timer?.Dispose(); timer = null; } }

    private bool On { get { lock (gate) return timer != null; } }

    /* Whether it may go on: set up, the library not being scanned, no music playing. */
    private async Task<bool> MayGo()
    {
        if (!Ready() || !On || Identify.AlbumScanner.Playing()) return false;
        return await Library.CurrentState() is var (_, st) && !st.Scanning;
    }

    private async Task Tick()
    {
        if (Interlocked.Exchange(ref ticking, 1) == 1) return;
        try
        {
            while (await MayGo())
            {
                var batch = Next();
                var looked = 0;
                foreach (var t in batch)
                {
                    if (!await MayGo()) return;
                    if (!File.Exists(t.Path)) continue;   // its drive away: looked at once it is back
                    var (found, error) = await Look(t.Path, t.Rate, () => !On || Identify.AlbumScanner.Playing());
                    if (found == null && error == null) return;   // stopped: looked at again next time
                    MqaStore.Keep(t.Path, t.Size, t.Mtime, found ?? MqaInfo.None, t.Tagged, error);
                    looked++;
                    if (found is { Mqa: true } f) log($"[mqa] {Path.GetFileName(t.Path)}: MQA{(f.Studio ? " Studio" : "")}, original {f.OriginalRate} Hz");
                    else if (t.Tagged) log($"[mqa] {Path.GetFileName(t.Path)}: tagged MQA, but no MQA signalling in its first {Seconds} s");
                }
                if (looked == 0) return;   // nothing (more) to look at now
            }
        }
        catch (Exception e) { log($"[mqa] {e.GetType().Name}: {e.Message}"); }
        finally { Interlocked.Exchange(ref ticking, 0); }
    }

    private sealed record Pending(string Path, double Size, double Mtime, double Rate, bool Tagged);

    /* The next tracks to look at, a hundred at most: tagged first, then newest additions. */
    private static List<Pending> Next()
    {
        using var c = Db.Open();
        MqaStore.Ensure(c);
        using var cmd = c.CreateCommand();
        cmd.CommandText = $@"SELECT t.path, t.size, t.mtime, t.sample_rate, COALESCE((SELECT tags FROM track_tags WHERE track_id = t.id), '') AS tags FROM tracks t {MqaStore.Join}
            WHERE {MqaStore.CanCarry} AND m.path IS NULL
            ORDER BY (tags LIKE '%MQAENCODER%' OR tags LIKE '%ORIGINALSAMPLERATE%' OR tags LIKE '%MQASAMPLERATE%') DESC, t.id DESC LIMIT 100";
        using var r = cmd.ExecuteReader();
        var o = new List<Pending>();
        while (r.Read()) o.Add(new Pending(r.GetString(0), r.GetDouble(1), r.GetDouble(2), r.GetDouble(3), Tagged(r.GetString(4))));
        return o;
    }

    /* The tags name MQA (any of its three). */
    public static bool Tagged(string tags) =>
        tags.Contains("MQAENCODER", StringComparison.OrdinalIgnoreCase) || tags.Contains("ORIGINALSAMPLERATE", StringComparison.OrdinalIgnoreCase)
        || tags.Contains("MQASAMPLERATE", StringComparison.OrdinalIgnoreCase);

    /* ffmpeg's arguments: the file's first audio stream, its first [seconds] (and a second for what follows a late sync), stereo s32le. */
    public static List<string> Args(string file) =>
    [
        "-hide_banner", "-nostats", "-nostdin", "-loglevel", "error", "-i", file, "-map", "0:a:0", "-vn",
        "-t", (Seconds + 1).ToString(CultureInfo.InvariantCulture), "-ac", "2", "-f", "s32le", "-"
    ];

    /*
     * What [file]'s first ten seconds (at [rate] Hz) say: its signalling (None for none), or why it couldn't be read; both null when
     * [stop] stopped it. On a thread of its own at the lowest priority.
     */
    public static Task<(MqaInfo? Found, string? Error)> Look(string file, double rate, Func<bool> stop)
    {
        var done = new TaskCompletionSource<(MqaInfo?, string?)>(TaskCreationOptions.RunContinuationsAsynchronously);
        var t = new Thread(() =>
        {
            Cpu.LowerThisThread();
            try { done.SetResult(Read(file, rate, stop)); }
            catch (Exception e) { done.SetResult((null, e.Message.Length > 200 ? e.Message[..200] : e.Message)); }
        }) { IsBackground = true, Name = "mqa", Priority = ThreadPriority.Lowest };
        t.Start();
        return done.Task;
    }

    private static (MqaInfo?, string?) Read(string file, double rate, Func<bool> stop)
    {
        var psi = new ProcessStartInfo(Transcoder.Bin) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in Args(file)) psi.ArgumentList.Add(a);
        Cpu.Place(psi, CpuKind.Background);
        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("ffmpeg didn't start");
        Cpu.Adopt(proc, CpuKind.Background);
        var err = proc.StandardError.ReadToEndAsync();
        var d = new MqaDetect();
        var stopped = false;
        var bytes = new byte[65536];
        int carry = 0, n;
        try
        {
            var output = proc.StandardOutput.BaseStream;
            while (!d.Done && (n = output.Read(bytes, carry, bytes.Length - carry)) > 0)
            {
                if (stop()) { stopped = true; break; }
                n += carry;
                var whole = n / 8 * 8;
                d.Feed(bytes.AsSpan(0, whole));
                carry = n - whole;
                if (carry > 0) Buffer.BlockCopy(bytes, whole, bytes, 0, carry);
            }
        }
        finally
        {
            if (!proc.HasExited) { try { proc.Kill(); } catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { /* gone */ } }
            proc.WaitForExit();
            Cpu.Forget(proc);
        }
        if (stopped) return (null, null);
        Interlocked.Increment(ref Looked);
        // Found within the first ten seconds only (the second after them is for what follows a late sync).
        if (d.Done && d.SyncAt < (long)(Seconds * (rate > 0 ? rate : 44100))) return (d.Result(), null);
        if (d.Frames > 0) return (MqaInfo.None, null);
        var said = err.Result.Trim().Split('\n')[^1];
        return (null, said.Length > 0 ? said : "no audio");
    }
}
