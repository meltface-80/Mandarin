// Fingerprints.cs — each track's Chromaprint fingerprint, made and kept (bug list item 414c), for matching an album by
// sound (Identifier.Sound.cs, AcoustId.cs).
//
// Made as fpcalc makes it: the file decoded by ffmpeg (the one the server plays with) to 11025 Hz mono 16-bit through
// the resampler in fpcalc's own settings (swresample's, filter 16, phase shift 8, linear, cutoff 0.8), the first 120 s
// fingerprinted (Chromaprint.cs). One track at a time, at the lowest priority the server can give: ffmpeg on the cores
// playback doesn't keep, nice 19 and its reads last (Cpu, as ReplayGain's measuring), the fingerprint worked out on a
// thread of its own at nice 19; 120 s of audio held at most (2.6 MB). Stopped as soon as it may not go on (music
// playing, the Album Scanner off or outside its hours).
//
// Kept in track_fingerprints by the file's path, with its size and time: the same file is never fingerprinted twice (a
// retry, a new pack, Check again), a changed one is fingerprinted again.
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Identify;

internal static partial class Fingerprints
{
    private const string Table = """
        CREATE TABLE IF NOT EXISTS track_fingerprints (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime INTEGER NOT NULL,
          fingerprint TEXT, error TEXT, made_at INTEGER NOT NULL);
        """;

    // fpcalc's FFmpegAudioReader: its request for 16-bit samples, its resampler's "compatible mode".
    public const string Resampler = "aresample=resampler=swr:filter_size=16:phase_shift=8:linear_interp=1:cutoff=0.8:osr=11025:ochl=mono:osf=s16";

    public static int Made;    // fingerprints made by this server (the tests read it through the log)

    private static void Ensure(SqliteConnection c)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = Table;
        cmd.ExecuteNonQuery();
    }

    /* What is kept for the file at [path] as it is now ([size], [mtime]): its fingerprint, or why it has none; null if never made or the file changed. */
    public static (string? Fingerprint, string? Error)? Kept(string path, long size, long mtime)
    {
        using var c = Db.Open();
        Ensure(c);
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT fingerprint, error FROM track_fingerprints WHERE path = $p AND size = $s AND mtime = $m";
        cmd.Parameters.AddWithValue("$p", path);
        cmd.Parameters.AddWithValue("$s", size);
        cmd.Parameters.AddWithValue("$m", mtime);
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        return (r.IsDBNull(0) ? null : r.GetString(0), r.IsDBNull(1) ? null : r.GetString(1));
    }

    /* The fingerprint made for the file at [path] ([size], [mtime]), or why none was. */
    public static void Keep(string path, long size, long mtime, string? fingerprint, string? error)
    {
        using var c = Db.Open();
        Ensure(c);
        using var cmd = c.CreateCommand();
        cmd.CommandText = @"INSERT INTO track_fingerprints(path, size, mtime, fingerprint, error, made_at) VALUES($p, $s, $m, $f, $e, $at)
            ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, fingerprint = excluded.fingerprint, error = excluded.error, made_at = excluded.made_at";
        cmd.Parameters.AddWithValue("$p", path);
        cmd.Parameters.AddWithValue("$s", size);
        cmd.Parameters.AddWithValue("$m", mtime);
        cmd.Parameters.AddWithValue("$f", (object?)fingerprint ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$e", (object?)error ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        cmd.ExecuteNonQuery();
    }

    /* ffmpeg's arguments for [file]: its first audio stream as fpcalc reads it, a second past the 120 s used. */
    public static List<string> Args(string file) =>
    [
        "-hide_banner", "-nostats", "-nostdin", "-loglevel", "error", "-request_sample_fmt", "s16", "-i", file,
        "-map", "0:a:0", "-vn", "-af", Resampler, "-t", (Chromaprint.MaxSeconds + 1).ToString(System.Globalization.CultureInfo.InvariantCulture),
        // What the resampler makes, said of the output too: else ffmpeg would make it the input's channels again.
        "-ac", "1", "-ar", "11025", "-f", "s16le", "-"
    ];

    /// <summary>Thrown when the work may not go on: the fingerprint is made another time.</summary>
    public sealed class Stopped() : Exception("stopped");

    /*
     * The fingerprint of [file], made now, or null when it has no audio; [stop] is asked as it goes, and stops it
     * (Stopped). A file ffmpeg can't read throws, its last words the message.
     */
    public static Task<string?> Make(string file, Func<bool> stop)
    {
        var done = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var t = new Thread(() =>
        {
            Lowest();
            try { done.SetResult(Run(file, stop)); }
            catch (Exception e) { done.SetException(e); }
        }) { IsBackground = true, Name = "fingerprint", Priority = ThreadPriority.Lowest };
        t.Start();
        return done.Task;
    }

    private static string? Run(string file, Func<bool> stop)
    {
        var psi = new ProcessStartInfo(Transcoder.Bin) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in Args(file)) psi.ArgumentList.Add(a);
        Cpu.Place(psi, CpuKind.Background);
        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("ffmpeg didn't start");
        Cpu.Adopt(proc, CpuKind.Background);
        var err = proc.StandardError.ReadToEndAsync();
        var c = new Chromaprint();
        var stopped = false;
        try
        {
            var bytes = new byte[32768];
            var samples = new short[bytes.Length / 2];
            var carry = 0;
            var output = proc.StandardOutput.BaseStream;
            int n;
            while (!c.Full && (n = output.Read(bytes, carry, bytes.Length - carry)) > 0)
            {
                if (stop()) { stopped = true; break; }
                n += carry;
                var whole = n / 2;
                Buffer.BlockCopy(bytes, 0, samples, 0, whole * 2);
                c.Feed(samples.AsSpan(0, whole));
                carry = n - whole * 2;
                if (carry > 0) bytes[0] = bytes[n - 1];
            }
        }
        finally
        {
            if (!proc.HasExited) { try { proc.Kill(); } catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { /* gone */ } }
            proc.WaitForExit();
            Cpu.Forget(proc);
        }
        if (stopped) throw new Stopped();
        Interlocked.Increment(ref Made);
        if (c.Raw.Count > 0) return Chromaprint.Encode(c.Raw);
        // Nothing fingerprinted: too short, or ffmpeg couldn't read it (its own words said).
        var said = err.Result.Trim().Split('\n')[^1];
        if (proc.ExitCode != 0 && said.Length > 0) throw new InvalidOperationException(said.Length > 200 ? said[..200] : said);
        return null;
    }

    // ------------------------------------------------------------ the lowest priority

    [LibraryImport("libc", EntryPoint = "setpriority", SetLastError = true)]
    private static partial int SetPriority(int which, int who, int prio);

    [LibraryImport("libc", EntryPoint = "gettid")]
    private static partial int GetTid();

    /* This thread at nice 19 (Linux keeps a niceness for each thread): below every other thread of the server. */
    private static void Lowest()
    {
        if (!OperatingSystem.IsLinux()) return;
        try { _ = SetPriority(0, GetTid(), 19); }
        catch (Exception e) when (e is EntryPointNotFoundException or DllNotFoundException) { /* the priority above, then */ }
    }
}
