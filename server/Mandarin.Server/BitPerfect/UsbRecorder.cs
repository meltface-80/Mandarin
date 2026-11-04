// UsbRecorder.cs — the bit-perfect check's recording of a USB DAC plugged into this server (bug list item 275): the
// kernel's usbmon on the DAC's bus (/dev/usbmonN, the usbmon module loaded; root, or a privileged container), read on
// a thread of its own while the track plays again from its start, every transfer to the DAC's playback endpoint
// written as it went down the cable (Usbmon.cs). One recording holds the whole track; what usbmon couldn't keep up
// with (its ring full) is said in the sidecar, and found by the comparison as frames lost.
using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace Mandarin.Server.BitPerfect;

/* The DAC [target], recorded through [device] (its bus's /dev/usbmonN) into [dir]; [open] says what ALSA has it open at. */
internal sealed partial class UsbRecorder(Usbmon.Target target, string dir, Func<(double Rate, string Format)?> open, string? device = null) : IRecorder
{
    private const int ORdOnly = 0, ONonBlock = 0x800, OCloExec = 0x80000, PollIn = 1;
    private const int RingSize = 1200 * 1024;                    // usbmon's largest ring
    private const nuint SetRingSize = 0x9204, GetStats = 0x80089203;  // MON_IOCT_RING_SIZE, MON_IOCG_STATS

    [StructLayout(LayoutKind.Sequential)]
    private struct PollFd { public int Fd; public short Events; public short Revents; }

    [LibraryImport("libc", EntryPoint = "open", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial int Open(string path, int flags);

    [LibraryImport("libc", EntryPoint = "ioctl", SetLastError = true)]
    private static partial int Ioctl(int fd, nuint request, nint arg);

    [LibraryImport("libc", EntryPoint = "poll", SetLastError = true)]
    private static unsafe partial int Poll(PollFd* fds, nuint n, int timeout);

    [LibraryImport("libc", EntryPoint = "read", SetLastError = true)]
    private static unsafe partial nint Read(int fd, byte* buf, nuint count);

    [LibraryImport("libc", EntryPoint = "close")]
    private static partial int Close(int fd);

    private Usbmon.Writer? writer;
    private Thread? thread;
    private volatile bool stop;
    private volatile string? error;
    private int fd = -1;
    private long dropped;

    private string DevicePath => device ?? $"/dev/usbmon{target.Bus}";
    private string Wav => Path.Combine(dir, "usbmon.wav");

    /* Why the DAC [target]'s bus can't be read: null where it can. */
    public static string? Why(Usbmon.Target target)
    {
        var path = $"/dev/usbmon{target.Bus}";
        var f = Open(path, ORdOnly | ONonBlock | OCloExec);
        if (f >= 0) { _ = Close(f); return null; }
        return Said(path, Marshal.GetLastPInvokeError());
    }

    private static string Said(string path, int errno) => errno switch
    {
        2 => $"{path} isn't there: load usbmon on the computer the DAC is plugged into (sudo modprobe usbmon), and run the server's container privileged",
        13 or 1 => $"the server may not read {path}: it needs root, or its container privileged",
        _ => $"{path} couldn't be opened (error {errno})",
    };

    /* The whole track is one recording. */
    public int Most => 24 * 3600;

    public Task Ask(int seconds, CancellationToken ct)
    {
        if (writer != null) { writer.Seconds = seconds; return Task.CompletedTask; }
        fd = Open(DevicePath, ORdOnly | ONonBlock | OCloExec);
        if (fd < 0) throw new InvalidOperationException(Said(DevicePath, Marshal.GetLastPInvokeError()));
        _ = Ioctl(fd, SetRingSize, RingSize);   // the default ring is smaller; a refusal leaves it as it was
        writer = new Usbmon.Writer(Wav, target, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0, open) { Seconds = seconds };
        thread = new Thread(Loop) { IsBackground = true, Name = "usbmon" };
        thread.Start();
        return Task.CompletedTask;
    }

    // Each event as usbmon gives it (one a read), to the writer until its recording is over.
    private unsafe void Loop()
    {
        var buf = new byte[RingSize + Usbmon.Head];
        try
        {
            while (!stop)
            {
                var p = new PollFd { Fd = fd, Events = PollIn };
                if (Poll(&p, 1, 200) <= 0) continue;
                nint n;
                fixed (byte* b = buf) n = Read(fd, b, (nuint)buf.Length);
                if (n < 0)
                {
                    var errno = Marshal.GetLastPInvokeError();
                    if (errno is 4 or 11) continue;   // EINTR, EAGAIN
                    error = $"reading {DevicePath} failed (error {errno})";
                    return;
                }
                if (n < Usbmon.Head) continue;
                var len = (int)Math.Min(BinaryPrimitives.ReadUInt32LittleEndian(buf.AsSpan(36)), (uint)(n - Usbmon.Head));
                if (writer!.Take(Usbmon.Parse(buf.AsSpan(0, Usbmon.Head), buf.AsSpan(Usbmon.Head, len).ToArray()))) return;
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { error = e.Message; }
        finally
        {
            ulong stats = 0;
            if (Ioctl(fd, GetStats, (nint)(&stats)) == 0) dropped = (long)(stats >> 32);
        }
    }

    public async Task<(double Seconds, bool Whole)> Wait(Check.Run run, double before, CancellationToken ct)
    {
        var w = writer ?? throw new InvalidOperationException("nothing was asked to record");
        var armedSince = DateTime.UtcNow;
        while (true)
        {
            await Task.Delay(250, ct);
            if (error != null) throw new InvalidOperationException(error);
            if (w.State == "failed") throw new InvalidOperationException(w.Why ?? "the recording failed");
            var seconds = w.Rate > 0 ? w.Frames / w.Rate : 0;
            if (w.State == "done") return (seconds, seconds + 1 >= w.Seconds);
            if (w.State == "armed" && DateTime.UtcNow - armedSince > TimeSpan.FromSeconds(30)) throw new TimeoutException("the DAC was never sent the track");
            if (w.State == "recording") run.Said = $"Recording what the DAC is fed ({Math.Round(before + seconds)} s)";
        }
    }

    public Task<JsonObject?> Take(string wav, CancellationToken ct)
    {
        thread?.Join();
        var said = writer!.Finish(dropped);
        File.Move(Wav, wav, true);
        return Task.FromResult<JsonObject?>(said);
    }

    public Task Stop(bool failed)
    {
        stop = true;
        thread?.Join(2000);
        if (fd >= 0) { _ = Close(fd); fd = -1; }
        writer?.Dispose();
        return Task.CompletedTask;
    }
}
