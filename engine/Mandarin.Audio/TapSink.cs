// TapSink.cs — the tap (item 412): the device the engine plays to, wrapped so that what it is handed can be recorded
// (Capture.cs) exactly as it is handed over. Every frame the device took, after every conversion the engine makes (its
// 32-bit words, DoP under its markers, native DSD words, the silence a change of format is given, a gain below 1), is
// told to the capture as the device takes it; an opening is a new stream, a drop (a new play, a seek, a stop) is its
// flush, a drain or a release its end. Nothing is recorded unless a capture was asked for: until then the playback
// thread only looks at one flag.
namespace Mandarin.Audio;

internal sealed class TapSink : ISink
{
    private readonly ISink inner;
    private readonly Capture capture;
    private int stream;   // each opening of the device a new stream

    public TapSink(ISink inner, Capture capture)
    {
        (this.inner, this.capture) = (inner, capture);
        capture.Xruns = () => inner.Xruns;
    }

    public int Rate => inner.Rate;
    public int Channels => inner.Channels;
    public OutFormat Format => inner.Format;
    public long Xruns => inner.Xruns;

    public void Open(int rate, int channels, OutFormat format = OutFormat.Pcm)
    {
        // A device that won't open at the format has let go of the stream it had (AlsaSink closes it first).
        try { inner.Open(rate, channels, format); }
        catch { capture.Ended(); throw; }
        capture.Opened(new Capture.Fed(++stream, rate, channels, format));
    }

    public unsafe int Write(byte* data, int frames)
    {
        int n = inner.Write(data, frames);
        // The frames the device took, as it took them: the first n of those handed it.
        if (n > 0 && capture.Listening) capture.Took(data, n * 4 * inner.Channels);
        return n;
    }

    public long Delay() => inner.Delay();

    public bool Pause(bool on) => inner.Pause(on);

    public void Drop()
    {
        inner.Drop();
        capture.Flushed();
    }

    public void Drain()
    {
        inner.Drain();
        capture.Ended();
    }

    public void Release()
    {
        inner.Release();
        capture.Ended();
    }

    public void Dispose()
    {
        capture.Ended();
        inner.Dispose();
    }
}
