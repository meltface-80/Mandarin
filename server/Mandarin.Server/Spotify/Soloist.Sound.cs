// Soloist.Sound.cs — Spotify's sound (bug list item 142): the private PulseAudio Soloist plays into (no sound card,
// only a pipe sink), and the pipe read and handed to the room's live stream (SoloistTap). A part of Soloist
// (Soloist.cs), sharing its state and its lock; as Mandarin DAC Bridge's SoloistSound.cs.
//
// The pipe sink waits for its reader, so whoever reads sets the pace: the room, while a stream is open (it fetches
// at the speed it plays, after filling its buffer), else the clock here, so Soloist plays on in time. The last
// moments heard are kept (the preroll), so the room's stream starts from the first notes, not from when it asked.
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Mandarin.Server.Spotify;

internal sealed partial class Soloist
{
    private readonly Queue<byte[]> preroll = new();
    private SoloistTap? tap;
    private Thread? reader;
    private volatile bool readerStop;

    /* What the samples have shown so far (SoloistProof.cs). */
    public SoloistProof Proof { get; } = new();

    private Dictionary<string, string> PrivateEnvironment() => new()
    {
        // Only the private server: no PipeWire to be found, PulseAudio at our socket.
        ["XDG_RUNTIME_DIR"] = runDir,
        ["PIPEWIRE_RUNTIME_DIR"] = runDir,
        ["PULSE_RUNTIME_PATH"] = Path.GetDirectoryName(socket)!,
        ["PULSE_STATE_PATH"] = Path.Combine(runDir, "state"),
        ["PULSE_SERVER"] = "unix:" + socket,
        ["HOME"] = Path.GetDirectoryName(dataDir)!
    };

    private void StartPulse(string exe)
    {
        var psi = new ProcessStartInfo(exe) { RedirectStandardError = true, RedirectStandardOutput = true, UseShellExecute = false };
        // No resampling (the sink is at Spotify's 44.1 kHz) and no volume of its own (flat): the samples as Soloist gave them.
        foreach (var a in new[]
                 {
                     "-n", "--daemonize=no", "--exit-idle-time=-1", "--use-pid-file=no", "--disable-shm=yes", "--log-target=stderr",
                     "--system=no", "--high-priority=no", "--realtime=no",
                     $"--load=module-native-protocol-unix socket={socket} auth-anonymous=1",
                     $"--load=module-pipe-sink file={fifo} sink_name=mandarin format=s32le rate={Rate} channels=2"
                 })
            psi.ArgumentList.Add(a);
        foreach (var (k, v) in PrivateEnvironment()) psi.Environment[k] = v;
        var errors = new StringBuilder();
        Process p;
        try { p = Process.Start(psi) ?? throw new InvalidOperationException("PulseAudio didn't start"); }
        catch (System.ComponentModel.Win32Exception e) { throw new NotReady($"can't run {exe}: {e.Message}"); }
        p.ErrorDataReceived += (_, e) => { if (e.Data is { } l && l.StartsWith("E:", StringComparison.Ordinal)) lock (errors) errors.AppendLine(l); };
        p.OutputDataReceived += (_, _) => { };
        p.BeginErrorReadLine();
        p.BeginOutputReadLine();
        lock (gate) pulse = p;
        for (int i = 0; i < 100 && !File.Exists(socket); i++)
        {
            if (p.HasExited) break;
            Wait(50);
        }
        if (!File.Exists(socket))
        {
            string e;
            lock (errors) e = errors.ToString().Trim().Split('\n').LastOrDefault() ?? "";
            throw new InvalidOperationException("Soloist's sound server didn't start" + (e != "" ? ": " + e : ""));
        }
    }

    private void StartReader()
    {
        readerStop = false;
        reader = new Thread(ReadSound) { IsBackground = true, Name = "soloist-sound", Priority = ThreadPriority.AboveNormal };
        reader.Start();
    }

    private void StopReader()
    {
        readerStop = true;
        // The reader holds the pipe open both ways, so a byte wakes it.
        if (reader is { IsAlive: true } && fifo != "")
            try { using var nudge = new FileStream(fifo, FileMode.Open, FileAccess.Write, FileShare.ReadWrite, 1); nudge.Write(new byte[FrameBytes]); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* no pipe, or no reader */ }
        reader?.Join(TimeSpan.FromSeconds(2));
        reader = null;
        Detach(null);
    }

    // What the sound server writes: to the room's stream while one is open, else let go at the speed it plays.
    private void ReadSound()
    {
        FileStream pipe;
        try { pipe = new FileStream(fifo, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite, 0); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { Log("sound pipe: " + e.Message); return; }
        using (pipe)
        {
            var buf = new byte[1 << 14];
            int have = 0;
            var pace = Stopwatch.StartNew();
            long paced = 0;
            while (!readerStop && !stop.IsCancellationRequested)
            {
                int n;
                try { n = pipe.Read(buf, have, buf.Length - have); }
                catch (IOException) { return; }
                if (n <= 0 || readerStop) return;
                have += n;
                int usable = have - have % FrameBytes;
                if (usable == 0) continue;
                var chunk = buf[..usable];
                Array.Copy(buf, usable, buf, 0, have - usable);
                have -= usable;
                Proof.See(chunk);

                SoloistTap? t;
                lock (gate) t = tap;
                if (t != null)
                {
                    if (t.Push(chunk, stop.Token)) { pace.Restart(); paced = 0; continue; }
                    Detach(t);
                }
                lock (gate)
                {
                    preroll.Enqueue(chunk);
                    while (preroll.Count > 8) preroll.Dequeue();
                }
                paced += chunk.Length / FrameBytes;
                var ahead = paced * 1000 / Rate - pace.ElapsedMilliseconds;
                if (ahead > 0) stop.Token.WaitHandle.WaitOne((int)ahead);
                if (pace.ElapsedMilliseconds > 2000) { pace.Restart(); paced = 0; }
            }
        }
    }

    private static bool HasSound(byte[] chunk)
    {
        foreach (var b in chunk) if (b != 0) return true;
        return false;
    }

    /* The room's stream opens: the samples from the first sound already heard, then as they come. One at a time:
       a second replaces the first, which ends. */
    public SoloistTap Open()
    {
        var t = new SoloistTap();
        lock (gate)
        {
            bool sound = false;
            foreach (var c in preroll)
            {
                sound |= HasSound(c);
                if (sound) t.Preload(c);
            }
            preroll.Clear();
            tap?.Dispose();
            tap = t;
        }
        return t;
    }

    private void Detach(SoloistTap? which)
    {
        lock (gate)
        {
            if (which != null && tap != which) return;
            tap?.Dispose();
            tap = null;
        }
    }
}

/* mkfifo(3): the pipe Soloist's sound comes through. */
internal static partial class Libc
{
    [LibraryImport("libc", EntryPoint = "mkfifo", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial int MkFifo(string path, uint mode);

    public static bool MakeFifo(string path) => MkFifo(path, 0x180) == 0;   // 0600: Mandarin's only
}
