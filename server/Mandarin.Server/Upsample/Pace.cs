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

    private static int StopSignal => OperatingSystem.IsMacOS() ? 17 : 19;
    private static int ContinueSignal => OperatingSystem.IsMacOS() ? 19 : 18;

    /* [pid] let go, should it be held (before it is stopped or ended). */
    public static void Release(int pid)
    {
        if (OperatingSystem.IsLinux() || OperatingSystem.IsMacOS()) { try { Kill(pid, ContinueSignal); } catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException) { /* no libc */ } }
    }

    /* [proc] making [job], a file of [bytes] holding [seconds] of music, held [LeadSeconds] ahead of its readers until disposed. */
    public static Holder Hold(Process proc, ConvJob job, long bytes, double seconds)
    {
        var lead = LeadSeconds > 0 && bytes > 0 && seconds > 0 && (OperatingSystem.IsLinux() || OperatingSystem.IsMacOS())
            ? (long)(bytes / seconds * LeadSeconds) : 0;
        return new Holder(proc, job, lead);
    }

    /* A making held: how long it was held (to say its speed by the time it worked). */
    public sealed class Holder : IDisposable
    {
        private readonly int pid;
        private readonly ConvJob job;
        private readonly long lead;
        private readonly Timer? timer;
        private readonly object gate = new();
        private readonly Stopwatch held = new();
        private bool stopped, ended;

        internal Holder(Process proc, ConvJob job, long lead)
        {
            this.job = job;
            this.lead = lead;
            try { pid = proc.Id; } catch (InvalidOperationException) { return; }
            if (lead > 0) timer = new Timer(_ => Tick(), null, 100, 100);
        }

        /* The seconds it was held. */
        public double HeldSeconds => held.Elapsed.TotalSeconds;

        private void Tick()
        {
            lock (gate)
            {
                if (ended) return;
                long made;
                try { made = new FileInfo(job.Part).Length; } catch (IOException) { return; }
                var ahead = made - Interlocked.Read(ref job.Wanted);
                if (!stopped && ahead > lead && Kill(pid, StopSignal) == 0) { stopped = true; held.Start(); }
                else if (stopped && ahead < lead / 2) Go();
            }
        }

        private void Go()
        {
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
            }
        }
    }
}
