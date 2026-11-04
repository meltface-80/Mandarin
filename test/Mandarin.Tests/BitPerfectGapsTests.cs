using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// What a bit-perfect check didn't record, said (item 286, BitPerfect/Check.cs): a track recorded in two parts with
/// two seconds between them is bit-perfect where it was recorded, and the verdict names the part no recording
/// covered ("not recorded: 0:03–0:05"), as the report's "unrecorded" lists it; recorded whole, nothing is named.
/// </summary>
public sealed class BitPerfectGapsTests
{
    private const int Rate = 44100;

    [Test]
    public async Task What_no_recording_covered_is_named_with_the_verdict()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("musicd-test-bitperfect-gaps-").FullName;
        try
        {
            var sent = BitPerfectTests.Noise(10 * Rate, 286);
            var file = BitPerfectTests.Wav(dir, "sent.wav", sent, 3);
            List<int> Span(int from, int to) => [.. sent.Skip(from * Rate * 2).Take((to - from) * Rate * 2)];

            // 0:00–0:03 and 0:05–0:10: bit-perfect where recorded, the two seconds between named.
            var r = await BitPerfectTests.Check(new
            {
                sent = file, rate = Rate, bits = 24, seconds = 10.0,
                parts = new[] { new { wav = BitPerfectTests.Wav(dir, "a.wav", Span(0, 3), 4) }, new { wav = BitPerfectTests.Wav(dir, "b.wav", Span(5, 10), 4) } },
            });
            Assert.Equal("bit-perfect", (string)r["verdict"]!);
            Assert.Equal("Bit-perfect: 80% of the track reached the DAC exactly as it was sent; not recorded: 0:03–0:05", (string)r["says"]!);
            var gap = Assert.Single(r["unrecorded"]!.AsArray());
            Assert.Equal((3.0, 5.0), ((double)gap!["from"]!, (double)gap["to"]!));

            // The first three seconds unrecorded too: both named, in order.
            r = await BitPerfectTests.Check(new
            {
                sent = file, rate = Rate, bits = 24, seconds = 10.0,
                parts = new[] { new { wav = BitPerfectTests.Wav(dir, "c.wav", Span(3, 6), 4) }, new { wav = BitPerfectTests.Wav(dir, "d.wav", Span(8, 10), 4) } },
            });
            Assert.EndsWith("; not recorded: 0:00–0:03 and 0:06–0:08", (string)r["says"]!);

            // Recorded whole: every sample, nothing named.
            r = await BitPerfectTests.Check(new { sent = file, rate = Rate, bits = 24, seconds = 10.0, parts = new[] { new { wav = BitPerfectTests.Wav(dir, "e.wav", sent, 4) } } });
            Assert.Equal("Bit-perfect: every sample of the track reached the DAC exactly as it was sent", (string)r["says"]!);
            Assert.Empty(r["unrecorded"]!.AsArray());
        }
        finally { Directory.Delete(dir, true); }
    }
}
