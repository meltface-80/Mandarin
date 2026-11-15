using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// MQA found in a track's samples (bug list item 418, the server's Mqa/MqaDetect.cs and MqaPass.cs), as the open
/// identifiers find it, on signals made to carry its signalling (Harness/MqaSignals.cs): MQA and MQA Studio at 16 and 24
/// bits, at 44.1, 48 and 88.2 kHz, in FLAC and WAV, each with its original rate; and not MQA where the sync word is a
/// bit wrong, carried where the identifiers don't look, only after the first ten seconds, or not there at all. Every
/// answer the same as the open identifier's own logic gives over the same samples (MqaSignals.Reference).
/// </summary>
public sealed class MqaDetectTests
{
    private static async Task<JsonArray> Look(params (string File, int Rate)[] files) =>
        (await Score.Run(new { fn = "mqa", files = files.Select(f => new object[] { f.File, f.Rate }).ToArray() }))["files"]!.AsArray();

    // The file's first [seconds] as ffmpeg decodes them for the server: interleaved stereo, left-justified 32-bit words.
    private static int[] Decoded(string file, double seconds)
    {
        var psi = new ProcessStartInfo(Fixtures.Ffmpeg) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-loglevel", "error", "-i", file, "-t", seconds.ToString(System.Globalization.CultureInfo.InvariantCulture), "-ac", "2", "-f", "s32le", "-" })
            psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        using var ms = new MemoryStream();
        p.StandardOutput.BaseStream.CopyTo(ms);
        p.WaitForExit();
        var b = ms.ToArray();
        var o = new int[b.Length / 4];
        Buffer.BlockCopy(b, 0, o, 0, o.Length * 4);
        return o;
    }

    [Test]
    public async Task MQA_and_MQA_Studio_are_found_with_their_original_rate_and_near_misses_are_not_as_the_open_identifier_reads_them()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("mqa-").FullName;
        try
        {
            var cases = new (string Name, MqaSignals.Spec Spec, bool Wav, (bool Mqa, bool Studio, int Rate) Want)[]
            {
                ("mqa-24-44-352.flac", new(44100, 24, MqaSignals.CodeOf(352800), 3), false, (true, false, 352800)),
                ("studio-24-48-192.flac", new(48000, 24, MqaSignals.CodeOf(192000), 17), false, (true, true, 192000)),
                ("mqa-16-44-44.flac", new(44100, 16, MqaSignals.CodeOf(44100), 2), false, (true, false, 44100)),
                ("studio-24-88-176.wav", new(88200, 24, MqaSignals.CodeOf(176400), 31), true, (true, true, 176400)),
                ("mqa-24-96-384.flac", new(96000, 24, MqaSignals.CodeOf(384000), 8), false, (true, false, 384000)),
                ("mqa-24-44-88-late-in-ten.flac", new(44100, 24, MqaSignals.CodeOf(88200), 9, SyncAt: 9.5, Seconds: 11), false, (true, true, 88200)),
                // Near misses: the sync word's last bit wrong; carried three bits up, where the identifiers don't look;
                // only after the first ten seconds; and no signalling at all (the channels dithered apart).
                ("near-flipped.flac", new(44100, 24, MqaSignals.CodeOf(352800), 3, Flip: 35), false, (false, false, 0)),
                ("near-bit-19.flac", new(44100, 24, MqaSignals.CodeOf(352800), 3, Shift: 3), false, (false, false, 0)),
                ("near-too-late.flac", new(44100, 24, MqaSignals.CodeOf(352800), 3, SyncAt: 10.5, Seconds: 12), false, (false, false, 0)),
                ("plain-24-44.flac", new(44100, 24, -1, 0), false, (false, false, 0)),
            };
            var files = new List<(string, int)>();
            foreach (var (name, spec, wav, _) in cases)
            {
                var f = Path.Combine(dir, name);
                if (wav) MqaSignals.WriteWav(f, spec); else MqaSignals.WriteFlac(f, spec);
                files.Add((f, spec.Rate));
            }
            var got = await Look([.. files]);
            for (var i = 0; i < cases.Length; i++)
            {
                var (name, spec, _, want) = cases[i];
                var g = got[i]!;
                Assert.True(g["error"] == null, name + ": " + g.Str("error"));
                var said = (g.Bool("mqa") ?? false, g.Bool("studio") ?? false, (int)(g.Num("original_rate") ?? 0));
                Assert.True(want == said, $"{name}: {said}, not {want}");
                // The open identifier's logic, over the same ten seconds, says the same.
                var reference = MqaSignals.Reference(Decoded(files[i].Item1, 11), 10L * spec.Rate);
                Assert.True(reference == said, $"{name}: the open identifier says {reference}, the server {said}");
            }
        }
        finally { Directory.Delete(dir, true); }
    }

    [Test]
    public async Task The_original_rates_code_is_read_as_the_identifiers_read_it()
    {
        Needs.Server();
        var rates = (await Score.Run(new { fn = "mqa", rates = new[] { 0, 1, 4, 5, 8, 9, 12, 13 } }))["rates"]!.AsArray().Select(r => (int)r!.GetValue<double>()).ToArray();
        Assert.Equal([44100, 48000, 176400, 192000, 88200, 96000, 352800, 384000], rates);
    }

    [Test]
    public async Task A_stream_address_says_when_its_track_goes_untouched_and_a_Bridge_is_told_in_its_request()
    {
        Needs.Server();
        var j = await Score.Run(new
        {
            fn = "mqa",
            untouched = new[] { "http://h/stream/t1.orig.flac?mqa=1&s=x", "http://h/stream/t1.orig.flac?s=x&mqa=1", "http://h/stream/t1.orig.flac?s=x", "http://h/stream/t1.orig.flac?mqa=10", "http://h/x#mqa=1" },
            headers = new[] { "http://h/stream/t1.orig.flac?mqa=1&s=x", "http://h/stream/t1.orig.flac?s=x" },
        });
        Assert.Equal([true, true, false, false, false], j["untouched"]!.AsArray().Select(x => x!.GetValue<bool>()).ToArray());
        Assert.Equal(["X-Mandarin-Untouched: mqa\r\n", ""], j["headers"]!.AsArray().Select(x => (string)x!).ToArray());
    }
}
