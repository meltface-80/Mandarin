// Usbmon.cs — what a USB DAC plugged into this server is fed, read from the kernel's usbmon (bug list item 275), as
// SQ-tool reads it (github.com/meltface-80/SQ-tool, usbmon.py): every isochronous transfer the computer sends the
// DAC's playback endpoint, its packets' bytes exactly as they went down the cable, written into a WAV in the DAC's
// slot with its sidecar's "capture" (Recording.cs reads them as it reads Mandarin Bridge's).
//
// usbmon's binary events (Documentation/usb/usbmon.rst), as read(2) gives them: a 48-byte header, then len_cap bytes,
// for an isochronous transfer its packets' descriptors (16 bytes each: status, offset, length, padding) and then its
// data. Only submissions ('S') of isochronous OUT transfers to the DAC's endpoint are its stream; a callback ('C')
// with -ENOENT, -ECONNRESET or -ESHUTDOWN is the stream stopped (ALSA dropped, closed). Asked to record, the writer
// waits for the next stream to begin (a stop, or nothing sent for a while, then the first transfer), so what is
// recorded is the track played again from its start, not the end of what played before it.
using System.Buffers.Binary;
using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Server.BitPerfect;

internal static partial class Usbmon
{
    /* The size of the header read(2) gives. */
    public const int Head = 48;

    /* A stream begun again after this long with nothing sent, in seconds. */
    public const double Gap = 0.05;

    /* The DAC on the bus: its bus and device numbers, and its playback endpoint's number. */
    public sealed record Target(int Bus, int Device, int Endpoint);

    /* One event: what it is, whose, when (seconds), and for a transfer, its packets' data. */
    public sealed record Event(char Type, int Xfer, int Endpoint, bool In, int Device, int Bus, double At, int Status, List<ArraySegment<byte>> Packets);

    /* The event in [head] (48 bytes) and [body] (its len_cap bytes). */
    public static Event Parse(ReadOnlySpan<byte> head, byte[] body)
    {
        var ep = head[10];
        var xfer = head[9];
        var at = BinaryPrimitives.ReadInt64LittleEndian(head[16..]) + BinaryPrimitives.ReadInt32LittleEndian(head[24..]) / 1e6;
        var packets = new List<ArraySegment<byte>>();
        if (xfer == 0 && head[15] == 0)
        {
            // usbmon keeps at most 128 of a transfer's descriptors (ISODESC_MAX).
            var descs = Math.Min(Math.Min(BinaryPrimitives.ReadInt32LittleEndian(head[44..]), 128), body.Length / 16);
            var data = 16 * Math.Max(0, descs);
            for (var d = 0; d < descs; d++)
            {
                var off = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(16 * d + 4));
                var len = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(16 * d + 8));
                if (off >= 0 && len > 0 && data + off + len <= body.Length) packets.Add(new ArraySegment<byte>(body, data + off, len));
            }
        }
        return new Event((char)head[8], xfer, ep & 0x7f, (ep & 0x80) != 0, head[11], BinaryPrimitives.ReadUInt16LittleEndian(head[12..]), at,
            BinaryPrimitives.ReadInt32LittleEndian(head[28..]), packets);
    }

    /* The next event of a capture [s] (events one after another, as read(2) gives them); null at its end. */
    public static Event? Read(Stream s)
    {
        var head = new byte[Head];
        if (s.ReadAtLeast(head, Head, throwOnEndOfStream: false) < Head) return null;
        var body = new byte[BinaryPrimitives.ReadUInt32LittleEndian(head.AsSpan(36))];
        if (s.ReadAtLeast(body, body.Length, throwOnEndOfStream: false) < body.Length) return null;
        return Parse(head, body);
    }

    [GeneratedRegex(@"^\s*([0-9]+)\s+\[(\S+)\s*\]", RegexOptions.Multiline)]
    private static partial Regex CardLine();

    [GeneratedRegex(@"^alsa:plughw:CARD=([^,]+),DEV=([0-9]+)$")]
    private static partial Regex AlsaLocation();

    [GeneratedRegex(@"Endpoint:\s*(?:0x([0-9a-fA-F]+)\s*\()?\s*([0-9]+)\s+OUT")]
    private static partial Regex OutEndpoint();

    /* Where the DAC at [location] (alsa:plughw:CARD=…,DEV=…) is on the USB bus; null where it isn't a USB device. */
    public static Target? Of(string? location, string root = "/proc/asound")
    {
        var m = AlsaLocation().Match(location ?? "");
        if (!m.Success) return null;
        var card = CardLine().Matches(Text(Path.Combine(root, "cards"))).FirstOrDefault(c => c.Groups[2].Value == m.Groups[1].Value);
        if (card == null) return null;
        var dir = Path.Combine(root, "card" + card.Groups[1].Value);
        var bus = Regex.Match(Text(Path.Combine(dir, "usbbus")), @"^([0-9]+)/([0-9]+)");
        var ep = OutEndpoint().Match(Text(Path.Combine(dir, "stream" + m.Groups[2].Value)));
        if (!bus.Success || !ep.Success) return null;
        var n = ep.Groups[1].Success ? int.Parse(ep.Groups[1].Value, NumberStyles.HexNumber, CultureInfo.InvariantCulture) & 0x7f : int.Parse(ep.Groups[2].Value, CultureInfo.InvariantCulture);
        return new Target(int.Parse(bus.Groups[1].Value, CultureInfo.InvariantCulture), int.Parse(bus.Groups[2].Value, CultureInfo.InvariantCulture), n);
    }

    private static string Text(string path)
    {
        try { return File.ReadAllText(path); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return ""; }
    }

    /* An ALSA format as it goes down the cable: its slot's bytes, whether DSD (and its words' order), and PCM's S24_LE (low 3 of 4 bytes). */
    public static (int Width, string Kind, string Setting, bool Low24)? Slot(string format) => format switch
    {
        "S16_LE" => (2, "pcm", "", false),
        "S24_3LE" => (3, "pcm", "", false),
        "S24_LE" => (4, "pcm", "", true),
        "S32_LE" => (4, "pcm", "", false),
        "DSD_U32_BE" => (4, "dsd", "native", false),
        "DSD_U32_LE" => (4, "dsd", "native_le", false),
        "DSD_U16_BE" => (2, "dsd", "native", false),
        "DSD_U16_LE" => (2, "dsd", "native_le", false),
        _ => null,
    };

    /*
     * The DAC [target]'s stream from the next one begun after [armedAt] (seconds), into a WAV at [path]: [seconds] of
     * it, at what [open] says ALSA has the DAC open at as the stream begins ({ rate, format }).
     */
    public sealed class Writer(string path, Target target, double armedAt, Func<(double Rate, string Format)?> open) : IDisposable
    {
        private FileStream? file;
        private double last = armedAt, rate;
        private bool stopped, heard;
        private (int Width, string Kind, string Setting, bool Low24) slot;
        private string format = "";
        private long want;

        /* "armed" (waiting for the stream to begin), "recording", "done", or "failed" (and why). */
        public volatile string State = "armed";
        public string? Why;
        public long Frames, Packets;
        public int Interruptions;
        public double Rate => rate;

        /* How long to record, in seconds. */
        public int Seconds { get; set; } = Check.Most;

        /* [e] taken: true once the recording is over. */
        public bool Take(Event e)
        {
            if (State is "done" or "failed") return true;
            if (e.Bus != target.Bus || e.Device != target.Device || e.Xfer != 0 || e.In || e.Endpoint != target.Endpoint) return false;
            if (e.Type == 'C')
            {
                if (e.Status is -2 or -104 or -108)
                {
                    stopped = true;
                    if (State == "recording" && heard) return Done();
                    // Stopped before anything but silence was sent (ALSA set up again): the stream to come is the one.
                    if (State == "recording") State = "armed";
                }
                return false;
            }
            if (e.Type != 'S') return false;
            var gap = e.At - last;
            last = e.At;
            if (State == "armed")
            {
                if (!stopped && gap < Gap) return false;
                if (!Begin()) return true;
            }
            else if (gap >= Gap) Interruptions++;
            stopped = false;
            var frame = 2 * slot.Width;
            foreach (var p in e.Packets)
            {
                Packets++;
                var n = Math.Min(p.Count / frame, want - Frames);
                if (n <= 0) break;
                var bytes = p.AsSpan(0, (int)(n * frame));
                if (slot.Low24)
                {
                    var b = bytes.ToArray();
                    for (var i = 0; i + 4 <= b.Length; i += 4) BinaryPrimitives.WriteUInt32LittleEndian(b.AsSpan(i), BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(i)) << 8);
                    file!.Write(b);
                }
                else file!.Write(bytes);
                heard = heard || bytes.ContainsAnyExcept((byte)0);
                Frames += n;
            }
            return Frames >= want && Done();
        }

        private bool Begin()
        {
            var at = open();
            if (at is not { } o || o.Rate <= 0) return Fail("ALSA doesn't say what the DAC is open at");
            if (Slot(o.Format) is not { } s) return Fail($"the DAC is open as {o.Format}, which the check doesn't read");
            (rate, format, slot) = (o.Rate, o.Format, s);
            want = (long)Math.Ceiling(Seconds * rate);
            file ??= File.Create(path);
            file.SetLength(0);
            file.Position = 0;
            file.Write(new byte[44]);
            Frames = Packets = 0;
            Interruptions = 0;
            heard = false;
            State = "recording";
            return true;
        }

        private bool Fail(string why) { Why = why; State = "failed"; return false; }

        private bool Done() { State = "done"; return true; }

        /* The recording closed: its header written, and its sidecar's "capture". */
        public JsonObject Finish(long dropped)
        {
            if (file == null) throw new InvalidOperationException("nothing was recorded");
            var bytes = Frames * 2 * slot.Width;
            var h = new byte[44];
            "RIFF"u8.CopyTo(h); BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(4), (uint)Math.Min(uint.MaxValue, 36 + bytes)); "WAVE"u8.CopyTo(h.AsSpan(8));
            "fmt "u8.CopyTo(h.AsSpan(12)); BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(16), 16); BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(20), 1);
            BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(22), 2); BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(24), (uint)rate);
            BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(28), (uint)(rate * 2 * slot.Width)); BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(32), (ushort)(2 * slot.Width));
            BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(34), (ushort)(8 * slot.Width)); "data"u8.CopyTo(h.AsSpan(36));
            BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(40), (uint)Math.Min(uint.MaxValue, bytes));
            file.Position = 0;
            file.Write(h);
            var head = new byte[Math.Min(bytes, 2L * slot.Width * 512)];
            file.Position = 44;
            file.ReadExactly(head);
            file.Dispose();
            file = null;
            var kind = slot.Kind == "pcm" && Dop(head, slot.Width) ? "dop" : slot.Kind;
            return new JsonObject
            {
                ["kind"] = kind, ["dsd_setting"] = kind == "dsd" ? slot.Setting : null, ["rate"] = rate, ["container_bits"] = 8 * slot.Width,
                ["format"] = format, ["interruptions"] = Interruptions, ["device"] = "a USB DAC on this server",
                ["usb"] = new JsonObject { ["bus"] = target.Bus, ["device"] = target.Device, ["endpoint"] = target.Endpoint, ["packets"] = Packets, ["dropped"] = dropped },
            };
        }

        public void Dispose() => file?.Dispose();
    }

    /* Whether PCM [frames] ([width]-byte samples, stereo) are DoP: each sample's top byte a marker, 0x05 and 0xFA by turns. */
    public static bool Dop(ReadOnlySpan<byte> frames, int width)
    {
        if (width < 3) return false;
        var n = frames.Length / (2 * width);
        if (n < 32) return false;
        byte? was = null;
        for (var i = 0; i < n; i++)
        {
            var l = frames[i * 2 * width + width - 1];
            var r = frames[i * 2 * width + 2 * width - 1];
            if (l != r || (l != 0x05 && l != 0xFA) || l == was) return false;
            was = l;
        }
        return true;
    }
}
