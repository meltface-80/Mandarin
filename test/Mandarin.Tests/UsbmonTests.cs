using System.Buffers.Binary;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The bit-perfect check of a USB DAC plugged into the server (bug list item 275, BitPerfect/Usbmon.cs): what went
/// down the cable, read from usbmon's events as read(2) gives them, and compared with what was sent. The stream to
/// the DAC's playback endpoint only (not another device's, not its feedback endpoint's); recorded from the next stream
/// begun after it was asked (not the end of what was playing, not a start that sent only silence before ALSA set up
/// again); the samples however the DAC's slot packs them (32-bit, three bytes, 24 in the low bytes of 32), DoP found
/// by its markers; a transfer lost found as frames lost; and no stream begun, nothing recorded.
/// </summary>
public sealed class UsbmonTests
{
    private const int Bus = 3, Dev = 7, Ep = 1, Rate = 44100;

    // usbmon's events, one after another as read(2) gives them; [At] the clock, in seconds.
    private sealed class Capture
    {
        private readonly MemoryStream o = new();
        private double carry;
        public double At = 100;

        public void Event(char type, int ep, int dev, int status, IReadOnlyList<byte[]> packets, int xfer = 0)
        {
            var h = new byte[48];
            (h[8], h[9], h[10], h[11]) = ((byte)type, (byte)xfer, (byte)ep, (byte)dev);
            BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(12), Bus);
            (h[14], h[15]) = ((byte)'-', (byte)(type == 'S' ? 0 : '>'));
            var sec = (long)Math.Floor(At);
            BinaryPrimitives.WriteInt64LittleEndian(h.AsSpan(16), sec);
            BinaryPrimitives.WriteInt32LittleEndian(h.AsSpan(24), (int)Math.Round((At - sec) * 1e6));
            BinaryPrimitives.WriteInt32LittleEndian(h.AsSpan(28), status);
            var data = type == 'S' ? packets.SelectMany(p => p).ToArray() : [];
            var descs = xfer == 0 ? packets.Count : 0;
            var body = new byte[16 * descs + data.Length];
            for (int d = 0, off = 0; d < descs; off += packets[d].Length, d++)
            {
                BinaryPrimitives.WriteInt32LittleEndian(body.AsSpan(16 * d + 4), off);
                BinaryPrimitives.WriteInt32LittleEndian(body.AsSpan(16 * d + 8), packets[d].Length);
            }
            data.CopyTo(body, 16 * descs);
            BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(32), (uint)packets.Sum(p => p.Length));
            BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(36), (uint)body.Length);
            BinaryPrimitives.WriteInt32LittleEndian(h.AsSpan(44), descs);
            o.Write(h); o.Write(body);
        }

        // [frames] of [frame] bytes each sent to the DAC: transfers of 8 packets, a millisecond's frames a packet, with the
        // DAC's feedback and another device's traffic between them; the transfer numbered [lose] not seen.
        public void Send(byte[] bytes, int frame, int lose = -1)
        {
            var at = 0;
            for (var urb = 0; at < bytes.Length; urb++)
            {
                var packets = new List<byte[]>();
                for (var k = 0; k < 8 && at < bytes.Length; k++)
                {
                    carry += Rate / 1000.0;
                    var n = (int)Math.Floor(carry);
                    carry -= n;
                    var len = Math.Min(n * frame, bytes.Length - at);
                    packets.Add(bytes[at..(at + len)]);
                    at += len;
                }
                if (urb != lose) Event('S', Ep, Dev, -115, packets);
                Event('S', 0x80 | Ep, Dev, -115, [new byte[4]]);                          // its feedback endpoint
                if (urb % 10 == 0) Event('S', Ep, 8, -115, [new byte[192].Select((_, i) => (byte)i).ToArray()]);   // another DAC on the bus
                if (urb % 25 == 0) Event('S', 0, Dev, -115, [new byte[8]], xfer: 2);    // a control transfer
                At += 0.008;
            }
        }

        public void Stop() { Event('C', Ep, Dev, -2, []); Event('C', Ep, Dev, -2, []); }

        public string Save(string path) { File.WriteAllBytes(path, o.ToArray()); return path; }
    }

    // Stereo samples (24-bit values) as the cable carries them in [format].
    private static byte[] Slots(IReadOnlyList<int> s, string format)
    {
        var width = format == "S24_3LE" ? 3 : 4;
        var o = new byte[s.Count * width];
        for (var i = 0; i < s.Count; i++)
        {
            var v = format == "S24_LE" ? (uint)s[i] & 0xFFFFFF : (uint)s[i] << 8;
            if (width == 3) { o[3 * i] = (byte)(v >> 8); o[3 * i + 1] = (byte)(v >> 16); o[3 * i + 2] = (byte)(v >> 24); }
            else BinaryPrimitives.WriteUInt32LittleEndian(o.AsSpan(4 * i), v);
        }
        return o;
    }

    // The old track playing when the check is asked (armed at 100.1), stopped; a start that sent only silence, stopped;
    // then [track] from 100.6, with silence either side; [lose] a transfer of it.
    private static Capture Played(byte[] track, int frame, int lose = -1)
    {
        var c = new Capture();
        c.Send(Slots(BitPerfectTests.Noise(13000, 9), "S32_LE").Take(13000 * frame).ToArray(), frame);
        c.Stop();
        c.At = 100.4;
        c.Send(new byte[3000 * frame], frame);
        c.Stop();
        c.At = 100.6;
        c.Send([.. new byte[8000 * frame], .. track, .. new byte[20000 * frame]], frame, lose < 0 ? -1 : lose + 25);
        c.Stop();
        return c;
    }

    private static object Part(string file, string format, int rate = Rate) => new { usbmon = file, bus = Bus, device = Dev, endpoint = Ep, rate, format, armed_at = 100.1 };

    [Test]
    public async Task What_went_down_the_cable_compared_in_each_slot_from_the_stream_begun_after_the_ask()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("musicd-test-usbmon-").FullName;
        try
        {
            const int frames = 60000;
            var sent = BitPerfectTests.Noise(frames, 1);
            var file = BitPerfectTests.Wav(dir, "sent.wav", sent, 3);
            async Task<JsonObject> Of(object part) => await BitPerfectTests.Check(new { sent = file, rate = Rate, bits = 24, seconds = frames / (double)Rate, parts = new[] { part } });

            foreach (var format in new[] { "S32_LE", "S24_3LE", "S24_LE" })
            {
                var frame = format == "S24_3LE" ? 6 : 8;
                var r = await Of(Part(Played(Slots(sent, format), frame).Save(Path.Combine(dir, format + ".mon")), format));
                Assert.True(((string)r["verdict"]!, (double)r["coverage"]!) == ("bit-perfect", 1.0), format + ": " + r.ToJsonString());
                Assert.Equal(format == "S24_3LE" ? 24 : 32, (int)r["fed"]!["container_bits"]!);
                Assert.Equal(0, (int)r["parts"]![0]!["interruptions"]!);
                Assert.True((int)r["parts"]![0]!["usb"]!["packets"]! > 0);
            }

            // A transfer of the track lost: frames lost, where.
            var lost = await Of(Part(Played(Slots(sent, "S32_LE"), 8, lose: 100).Save(Path.Combine(dir, "lost.mon")), "S32_LE"));
            Assert.True(((string)lost["verdict"]!, (string)lost["dropouts"]![0]!["kind"]!) == ("dropouts", "skip"), lost.ToJsonString());

            // Asked while the track played on and on, no stream begun after: nothing recorded.
            var on = new Capture();
            on.Send(Slots(sent, "S32_LE"), 8);
            var r2 = await ServerCommand.Run(["bitperfect"], stdin: System.Text.Json.JsonSerializer.Serialize(new { sent = file, rate = Rate, bits = 24, seconds = frames / (double)Rate,
                parts = new[] { Part(on.Save(Path.Combine(dir, "on.mon")), "S32_LE") } }) + "\n");
            Assert.NotEqual(0, r2.Code);
            Assert.Contains("nothing was recorded", r2.Err + r2.Out);
        }
        finally { Directory.Delete(dir, true); }
    }

    [Test]
    public async Task DSD_as_DoP_down_the_cable_found_by_its_markers_and_compared()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("musicd-test-usbmon-").FullName;
        try
        {
            var r0 = new Random(7);
            var ch = new[] { new byte[4096 * 40], new byte[4096 * 40] };
            r0.NextBytes(ch[0]); r0.NextBytes(ch[1]);
            var file = BitPerfectTests.Dsf(dir, ch);
            var played = ch.Select(c => c.Select(BitPerfectTests.Turn).ToArray()).ToArray();
            var n = played[0].Length;
            // DoP in S32_LE: each sample [0, later byte, earlier byte, marker], the markers 0x05 and 0xFA by turns.
            var dop = new byte[n / 2 * 8];
            for (var f = 0; f < n / 2; f++) for (var c = 0; c < 2; c++)
                (dop[(f * 2 + c) * 4 + 1], dop[(f * 2 + c) * 4 + 2], dop[(f * 2 + c) * 4 + 3]) = (played[c][2 * f + 1], played[c][2 * f], (byte)(f % 2 == 0 ? 0x05 : 0xFA));
            var cap = new Capture { At = 100.6 };
            cap.Send(dop, 8);
            cap.Stop();
            var r = await BitPerfectTests.Check(new { sent = file, rate = 2822400, dsd = 64, dsd_base = 44100, seconds = n * 8 / 2822400.0,
                parts = new[] { Part(cap.Save(Path.Combine(dir, "dop.mon")), "S32_LE", 176400) } });
            Assert.True(((string)r["verdict"]!, (double)r["coverage"]!) == ("bit-perfect", 1.0), r.ToJsonString());
            Assert.Equal("dop", (string)r["fed"]!["kind"]!);
        }
        finally { Directory.Delete(dir, true); }
    }
}
