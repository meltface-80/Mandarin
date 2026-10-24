// CoreAudioSink.cs — a Mac's sound device as the engine's sink (bug list item 155; the calls are in
// CoreAudio.cs). Write puts whole frames into a ring and waits while it is full; the device's own
// thread takes them out as it plays (Render), and plays silence where there are none (counted as a
// run dry while playing). Where the device is: what the ring holds, plus the device's own latency.
using System.Runtime.InteropServices;
using static Mandarin.Audio.CoreAudioNative;

namespace Mandarin.Audio;

internal sealed unsafe class CoreAudioSink(string name, uint latencyMs) : ISink
{
    private readonly object gate = new();
    private nint unit;
    private uint device;
    private GCHandle self;
    private bool hogged, running;
    private byte[] ring = [];
    private int head, count, frameBytes;
    private long deviceLatency;
    public int Rate { get; private set; }
    public int Channels { get; private set; }
    public long Xruns { get; private set; }

    public void Open(int rate, int channels)
    {
        Close();
        device = Find(name) ?? throw new DeviceException("the device isn't there any more");
        SetRate(rate);
        Hog(true);
        var d = new ComponentDescription { Type = Code("auou"), SubType = Code("ahal"), Manufacturer = Code("appl") };
        var comp = FindComponent(0, d);
        if (comp == 0 || NewUnit(comp, out unit) != 0) { unit = 0; Close(); throw new DeviceException("Core Audio's output unit couldn't be made"); }
        var dev = device;
        Check(SetUnit(unit, 2000 /* CurrentDevice */, 0 /* global */, 0, &dev, sizeof(uint)), "the device couldn't be chosen");
        // The engine's 32-bit samples as they are, interleaved, at the device's own rate.
        var f = new StreamFormat
        {
            SampleRate = rate, FormatId = Code("lpcm"), FormatFlags = 4 /* signed integer */ | 8 /* packed */,
            BytesPerPacket = (uint)(4 * channels), FramesPerPacket = 1, BytesPerFrame = (uint)(4 * channels),
            ChannelsPerFrame = (uint)channels, BitsPerChannel = 32
        };
        Check(SetUnit(unit, 8 /* StreamFormat */, 1 /* input scope */, 0, &f, (uint)sizeof(StreamFormat)), "the device won't take " + rate / 1000.0 + " kHz");
        self = GCHandle.Alloc(this);
        var cb = new RenderCallback { Proc = &Render, RefCon = GCHandle.ToIntPtr(self) };
        Check(SetUnit(unit, 23 /* SetRenderCallback */, 1, 0, &cb, (uint)sizeof(RenderCallback)), "the device couldn't be fed");
        Check(Initialize(unit), "the device couldn't be started");
        frameBytes = 4 * channels;
        lock (gate) { ring = new byte[(int)Math.Max(rate * (long)latencyMs / 1000, 4096) * frameBytes]; head = 0; count = 0; }
        deviceLatency = Latency();
        Rate = rate; Channels = channels;
        Check(Start(unit), "the device couldn't be started");
        running = true;
    }

    public int Write(byte* data, int frames)
    {
        var bytes = frames * frameBytes;
        lock (gate)
        {
            while (ring.Length - count < frameBytes && unit != 0) Monitor.Wait(gate, 200);
            if (unit == 0) throw new DeviceException("the device isn't open");
            var n = Math.Min(bytes, (ring.Length - count) / frameBytes * frameBytes);
            var tail = (head + count) % ring.Length;
            var first = Math.Min(n, ring.Length - tail);
            new ReadOnlySpan<byte>(data, first).CopyTo(ring.AsSpan(tail));
            if (n > first) new ReadOnlySpan<byte>(data + first, n - first).CopyTo(ring.AsSpan(0));
            count += n;
            return n / frameBytes;
        }
    }

    [UnmanagedCallersOnly]
    private static int Render(nint refCon, uint* flags, void* time, uint bus, uint frames, BufferList* list)
    {
        if (GCHandle.FromIntPtr(refCon).Target is not CoreAudioSink s) return 0;
        var buf = &list->First;
        var want = (int)buf->Bytes;
        lock (s.gate)
        {
            var n = Math.Min(want, s.count);
            var first = Math.Min(n, s.ring.Length - s.head);
            s.ring.AsSpan(s.head, first).CopyTo(new Span<byte>(buf->Data, first));
            if (n > first) s.ring.AsSpan(0, n - first).CopyTo(new Span<byte>(buf->Data + first, n - first));
            if (n < want)
            {
                new Span<byte>(buf->Data + n, want - n).Clear();
                if (s.running && n > 0) s.Xruns++;
            }
            s.head = (s.head + n) % Math.Max(s.ring.Length, 1);
            s.count -= n;
            Monitor.PulseAll(s.gate);
        }
        return 0;
    }

    public long Delay()
    {
        lock (gate) return unit == 0 ? 0 : count / Math.Max(frameBytes, 1) + deviceLatency;
    }

    public bool Pause(bool on)
    {
        if (unit == 0) return true;
        if (on) { running = false; return Stop(unit) == 0; }
        running = true;
        return Start(unit) == 0;
    }

    public void Drop()
    {
        lock (gate) { head = 0; count = 0; Monitor.PulseAll(gate); }
    }

    public void Drain()
    {
        // What the ring holds played out, and what the device holds after it.
        var until = Environment.TickCount64 + 10000;
        lock (gate) while (count > 0 && unit != 0 && running && Environment.TickCount64 < until) Monitor.Wait(gate, 100);
        if (Rate > 0) Thread.Sleep((int)Math.Min(2000, deviceLatency * 1000 / Rate));
        Close();
    }

    public void Release() => Close();

    private void Close()
    {
        if (unit != 0)
        {
            Stop(unit); Uninitialize(unit); DisposeUnit(unit);
            lock (gate) { unit = 0; Monitor.PulseAll(gate); }
        }
        running = false;
        if (self.IsAllocated) self.Free();
        if (hogged) Hog(false);
        Rate = 0; Channels = 0;
    }

    public void Dispose() => Close();

    private static void Check(int status, string what)
    {
        if (status != 0) throw new DeviceException(what + " (Core Audio " + status + ")");
    }

    /* The output device of this name, or null. */
    public static uint? Find(string name)
    {
        foreach (var id in OutputDevices())
            if (NameOf(id) == name) return id;
        return null;
    }

    /* Every device that plays (has an output stream). */
    public static List<uint> OutputDevices()
    {
        var a = new Address { Selector = Code("dev#"), Scope = Global };
        if (GetSize(SystemObject, a, 0, 0, out var size) != 0 || size == 0) return [];
        var ids = new uint[size / sizeof(uint)];
        fixed (uint* p = ids) if (Get(SystemObject, a, 0, 0, ref size, p) != 0) return [];
        return ids.Where(Outputs).ToList();
    }

    /* `mandarin-audio --devices`: each output device as a line of JSON, its name and the rates it takes ("44100,48000,…"). */
    public static void List(Action<string> say)
    {
        foreach (var id in OutputDevices())
            say(Json.Obj("name", NameOf(id), "rates", string.Join(",", Rates(id).Where(r => r > 0).OrderBy(r => r).Select(r => ((long)r).ToString(System.Globalization.CultureInfo.InvariantCulture)))));
    }

    public static string NameOf(uint id)
    {
        var a = new Address { Selector = Code("lnam"), Scope = Global };
        nint s = 0;
        uint size = (uint)sizeof(nint);
        return Get(id, a, 0, 0, ref size, &s) == 0 ? Text(s) : "";
    }

    private static bool Outputs(uint id)
    {
        var a = new Address { Selector = Code("stm#"), Scope = OutputScope };
        return GetSize(id, a, 0, 0, out var size) == 0 && size > 0;
    }

    /* The rates the device takes, as Core Audio lists them (each range's ends). */
    public static List<double> Rates(uint id)
    {
        var a = new Address { Selector = Code("nsr#"), Scope = Global };
        var list = new List<double>();
        if (GetSize(id, a, 0, 0, out var size) != 0 || size == 0) return list;
        var ranges = new RateRange[size / (uint)sizeof(RateRange)];
        fixed (RateRange* p = ranges) if (Get(id, a, 0, 0, ref size, p) != 0) return list;
        foreach (var r in ranges) { if (!list.Contains(r.Min)) list.Add(r.Min); if (!list.Contains(r.Max)) list.Add(r.Max); }
        return list;
    }

    /* The device set to [rate], waited for (a DAC can take a moment); an error where it can't take it. */
    private void SetRate(int rate)
    {
        var a = new Address { Selector = Code("nsrt"), Scope = Global };
        double now = 0;
        uint size = sizeof(double);
        if (Get(device, a, 0, 0, ref size, &now) == 0 && now == rate) return;
        if (!Rates(device).Contains(rate)) throw new DeviceException("the device won't play " + rate / 1000.0 + " kHz");
        double want = rate;
        if (Set(device, a, 0, 0, sizeof(double), &want) != 0) throw new DeviceException("the device won't play " + rate / 1000.0 + " kHz");
        for (var i = 0; i < 40; i++)
        {
            size = sizeof(double);
            if (Get(device, a, 0, 0, ref size, &now) == 0 && now == rate) return;
            Thread.Sleep(50);
        }
        throw new DeviceException("the device didn't change to " + rate / 1000.0 + " kHz");
    }

    /* The device for this program alone (true), or let go (false); refused, it plays all the same. */
    private void Hog(bool take)
    {
        var a = new Address { Selector = Code("oink"), Scope = Global };
        int pid = take ? Environment.ProcessId : -1;
        hogged = Set(device, a, 0, 0, sizeof(int), &pid) == 0 && take;
    }

    /* Frames the device holds past what it is given: its latency, safety offset and buffer. */
    private long Latency()
    {
        long total = 0;
        foreach (var (sel, scope) in new[] { ("ltnc", OutputScope), ("saft", OutputScope), ("fsiz", Global) })
        {
            var a = new Address { Selector = Code(sel), Scope = scope };
            uint v = 0, size = sizeof(uint);
            if (Get(device, a, 0, 0, ref size, &v) == 0) total += v;
        }
        return total;
    }
}
