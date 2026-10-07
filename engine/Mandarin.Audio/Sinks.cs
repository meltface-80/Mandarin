// Sinks.cs — where the samples go: an ALSA device, or (for the tests) a file
// written at the speed the device would play it.
using System.Diagnostics;

namespace Mandarin.Audio;

internal sealed class DeviceException(string message) : Exception(message);

internal interface ISink : IDisposable
{
    int Rate { get; }
    int Channels { get; }
    // Opens (or reopens) the device at this format.
    void Open(int rate, int channels);
    // Writes whole frames of 32-bit samples; returns the frames taken.
    // A device that ran dry is put right and counted (Xruns), not thrown.
    unsafe int Write(byte* data, int frames);
    // Frames written that the device has still to play.
    long Delay();
    // Held where it is (true) or carried on (false). False when the device
    // can't pause: the caller drops what it holds and writes it again.
    bool Pause(bool on);
    // Everything the device holds thrown away; ready for more.
    void Drop();
    // What it holds played out, then closed.
    void Drain();
    // Closed at once, for other programs to use.
    void Release();
    long Xruns { get; }
}

internal sealed class AlsaSink(string device, uint latencyUs) : ISink
{
    private IntPtr pcm = IntPtr.Zero;
    public int Rate { get; private set; }
    public int Channels { get; private set; }
    public long Xruns { get; private set; }

    public void Open(int rate, int channels)
    {
        Close();
        int err = Alsa.Open(out pcm, device, Alsa.StreamPlayback, 0);
        if (err < 0) { pcm = IntPtr.Zero; throw new DeviceException(Describe(err)); }
        // No resampling: a rate the device can't take is an error, never a
        // quiet conversion. The plug layer (plughw:) still hands a DAC that
        // takes 24 or 16 bits what it takes, at the same rate.
        err = Alsa.SetParams(pcm, Alsa.FormatS32Le, Alsa.AccessRwInterleaved, (uint)channels, (uint)rate, 0, latencyUs);
        if (err < 0) { Close(); throw new DeviceException("the device won't play " + rate / 1000.0 + " kHz: " + Alsa.StrError(err)); }
        Rate = rate; Channels = channels;
    }

    public unsafe int Write(byte* data, int frames)
    {
        for (int attempt = 0; ; attempt++)
        {
            nint n = Alsa.WriteI(pcm, data, (nuint)frames);
            if (n >= 0) return (int)n;
            int err = (int)n;
            if (err == -32 /* EPIPE: ran dry */ || err == -86 /* ESTRPIPE: suspended */ || err == -4 /* EINTR */)
            {
                if (err == -32) Xruns++;
                if (Alsa.Recover(pcm, err, 1) >= 0 && attempt < 3) continue;
            }
            throw new DeviceException(Describe(err));
        }
    }

    public long Delay() => pcm != IntPtr.Zero && Alsa.Delay(pcm, out var d) == 0 ? Math.Max(0, (long)d) : 0;

    public bool Pause(bool on)
    {
        if (pcm == IntPtr.Zero) return true;
        if (Alsa.Pause(pcm, on ? 1 : 0) == 0) return true;
        if (!on) Alsa.Prepare(pcm);
        return false;
    }

    public void Drop()
    {
        if (pcm == IntPtr.Zero) return;
        Alsa.Drop(pcm);
        Alsa.Prepare(pcm);
    }

    public void Drain()
    {
        if (pcm != IntPtr.Zero) Alsa.Drain(pcm);
        Close();
    }

    public void Release() => Close();

    private void Close()
    {
        if (pcm != IntPtr.Zero) { Alsa.Close(pcm); pcm = IntPtr.Zero; }
        Rate = 0; Channels = 0;
    }

    public void Dispose() => Close();

    // The words the page shows (as the ffmpeg path says them).
    private static string Describe(int err) => err switch
    {
        -16 => "the device is in use by another program",                   // EBUSY
        -2 or -19 or -6 => "the device isn't there any more",               // ENOENT, ENODEV, ENXIO
        _ => "the device stopped: " + Alsa.StrError(err)
    };
}

/*
 * The tests' device: the samples into a file, at the pace they would play.
 * It holds nothing (no delay), so a pause holds it where it is exactly.
 */
internal sealed class FileSink(string path) : ISink
{
    private FileStream? file;
    private readonly Stopwatch clock = new();
    private long framesSinceStart;
    public int Rate { get; private set; }
    public int Channels { get; private set; }
    public long Xruns => 0;

    public void Open(int rate, int channels)
    {
        // Opened once for the whole run, as one long capture; a new format
        // carries on in the same file.
        file ??= new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite, 1 << 16);
        Rate = rate; Channels = channels;
        clock.Restart(); framesSinceStart = 0;
    }

    public unsafe int Write(byte* data, int frames)
    {
        if (file == null) throw new DeviceException("the device isn't open");
        file.Write(new ReadOnlySpan<byte>(data, frames * 4 * Channels));
        file.Flush();
        framesSinceStart += frames;
        // At the device's pace: wait until these frames would have played.
        double due = framesSinceStart * 1000.0 / Rate - clock.Elapsed.TotalMilliseconds;
        if (due > 1) Thread.Sleep((int)due);
        return frames;
    }

    public long Delay() => 0;

    public bool Pause(bool on)
    {
        if (on) clock.Stop(); else clock.Start();
        return true;
    }

    public void Drop() { clock.Restart(); framesSinceStart = 0; }

    public void Drain() { file?.Flush(); }

    public void Release() { file?.Flush(); }

    public void Dispose() { file?.Dispose(); file = null; }
}
