// Pace.cs — a making kept a little ahead of the device, as Roon keeps its DSP (bug list item 271).
//
// A track made as it plays was made as fast as the processor allows: DSD256 at three times real time on every core
// given it, flat out for a third of the track and idle after. Roon processes as it plays, at the pace of playback (its
// "processing speed" is how much faster it could go), so the same work is spread over the whole track: a fraction of
// a core. Now a making whose length is known before its first byte (a DSF from PCM, a WAV above FLAC's rates: the
// next track is armed with them once begun) is held some [LeadSeconds] of music ahead of what the devices reading it
// have asked for: paused (SIGSTOP) while it is that far ahead, let go (SIGCONT) when they have read on to half of it,
// and at once when one asks for more than is made (a seek forward). The pipes to and from it hold ffmpeg's ends too.
// Nothing reading it, a track made ahead for the next is made that far, and waits for the device to start on it.
// Since item 346 it also reads how fast the making goes as it goes, by the time it works (KeepingUp.cs). Since audit
// H2 a making held gives up its turn, and one let go goes on when the turns say (Turns.cs), which may hold it too.
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Mandarin.Server.Upsample;

internal static partial class Pace
{
    /* How far ahead of its readers a making goes, in seconds of music: 30, or MANDARIN_MAKE_LEAD_S (0: not held at all). */
    public static readonly double LeadSeconds = double.TryParse(Environment.GetEnvironmentVariable("MANDARIN_MAKE_LEAD_S"), System.Globalization.NumberStyles.Float,
        System.Globalization.CultureInfo.InvariantCulture, out var l) && l >= 0 ? l : 30;

    [LibraryImport("libc", EntryPoint = "kill", SetLastError = true)]
    private static partial int Kill(int pid, int sig);

    // SIGSTOP and SIGCONT, as Linux numbers them.
    private const int StopSignal = 19;
    private const int ContinueSignal = 18;

    /* [pid] let go, should it be held (before it is stopped or ended). */
    public static void Release(int pid)
    {
        if (OperatingSystem.IsLinux()) { try { Kill(pid, ContinueSignal); } catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException) { /* no libc */ } }
    }

    /* [proc] making [job], a file of [bytes] holding [seconds] of music, held [LeadSeconds] ahead of its readers until disposed. */
    public static Holder Hold(Process proc, ConvJob job, long bytes, double seconds)
    {
        var lead = LeadSeconds > 0 && bytes > 0 && seconds > 0 && OperatingSystem.IsLinux()
            ? (long)(bytes / seconds * LeadSeconds) : 0;
        return new Holder(proc, job, lead, bytes > 0 && seconds > 0 ? seconds / bytes : 0);
    }

    /* A making held: how long it was held (to say its speed by the time it worked). */
    public sealed class Holder : IDisposable
    {
        private readonly int pid;
        private readonly ConvJob job;
        private readonly long lead;
        private readonly Timer? timer;
        private readonly object gate = Turns.Gate;   // the turns' own: a hold decided there is done at once
        private readonly Stopwatch held = new(), alive = Stopwatch.StartNew();
        private readonly double perByte;   // seconds of music a byte
        private readonly long from = -1;   // the file's length when this making began (a resumed one's, item 272)
        private readonly Queue<(double Work, double Made)> seen = new();   // its work and what it had made, a window's worth
        private bool stopped, ended;

        internal Holder(Process proc, ConvJob job, long lead, double perByte)
        {
            this.job = job;
            this.lead = lead;
            this.perByte = perByte;
            try { pid = proc.Id; } catch (InvalidOperationException) { return; }
            try { from = File.Exists(job.Part) ? new FileInfo(job.Part).Length : 0; } catch (IOException) { from = 0; }
            if (lead > 0 || perByte > 0) timer = new Timer(_ => Tick(), null, 100, 100);
            Turns.Attach(job, this);
        }

        /* The seconds it was held. */
        public double HeldSeconds => held.Elapsed.TotalSeconds;

        /* Whether the turns may hold it: it is held ahead of its device at all. */
        public bool Holdable => lead > 0 && timer != null && !ended;

        /* The seconds of music made ahead of what its device has asked for; infinity where nothing reads it yet. */
        public double Ahead
        {
            get
            {
                if (perByte <= 0 || Volatile.Read(ref job.Readers) == 0) return double.PositiveInfinity;
                try { return (new FileInfo(job.Part).Length - Interlocked.Read(ref job.Wanted)) * perByte; }
                catch (IOException) { return double.PositiveInfinity; }
            }
        }

        /* Held for the turns (under Turns.Gate), another making to run: whether it is held now. */
        public bool Hold()
        {
            if (stopped) return true;
            if (!Holdable || Kill(pid, StopSignal) != 0) return false;
            stopped = true;
            held.Start();
            return true;
        }

        private void Tick()
        {
            lock (gate)
            {
                if (ended) return;
                long made;
                try { made = new FileInfo(job.Part).Length; } catch (IOException) { return; }
                if (!stopped) Speed(made);
                if (lead <= 0) return;
                var ahead = made - Interlocked.Read(ref job.Wanted);
                if (!stopped && ahead > lead && Kill(pid, StopSignal) == 0) { stopped = true; held.Start(); Turns.Yield(job); }
                else if (stopped && ahead < lead / 2) Turns.Back(job);   // on now, or in its turn
            }
        }

        // Its speed over the last KeepingUp.Window seconds it worked (item 346): the time held is no work.
        private void Speed(long made)
        {
            if (perByte <= 0 || from < 0) return;
            var work = (alive.Elapsed - held.Elapsed).TotalSeconds;
            seen.Enqueue((work, Math.Max(0, made - from) * perByte));
            while (seen.Count > 2 && work - seen.Peek().Work > KeepingUp.Window) seen.Dequeue();
            var (w0, m0) = seen.Peek();
            var span = work - w0;
            if (span >= 2) KeepingUp.Saw(job.Key, (Math.Max(0, made - from) * perByte - m0) / span, span);
        }

        /* Let go (under Turns.Gate): it goes on. */
        public void Go()
        {
            if (!stopped) return;
            Release(pid);
            stopped = false;
            held.Stop();
        }

        public void Dispose()
        {
            lock (gate)
            {
                ended = true;
                timer?.Dispose();
                if (stopped) Go();
                Turns.Detach(job, this);
            }
        }
    }
}
