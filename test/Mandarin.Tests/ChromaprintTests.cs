using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// A track's Chromaprint fingerprint (bug list item 414c, Identify/Chromaprint.cs, Identify/Fingerprints.cs): the
/// string AcoustID takes, byte for byte the reference fpcalc's (chromaprint 1.5.1) for the same audio. The expected
/// strings are fpcalc's own, kept in test/golden/chromaprint.json, so the test needs no fpcalc; where one is
/// installed, it is asked too. Signals.cs makes the audio by arithmetic: silence, a tone, a sweep, music-like sound, a
/// piece longer than the 120 s fingerprinted, and a 44.1 kHz stereo clip decoded and resampled as the scan does it.
/// </summary>
public sealed class ChromaprintTests
{
    private static readonly JsonObject Expected = JsonNode.Parse(File.ReadAllText(Path.Combine(ServerProcess.Root, "test", "golden", "chromaprint.json")))!.AsObject();

    private static string Tmp() => Directory.CreateTempSubdirectory("mandarin-chromaprint-").FullName;

    private static async Task<List<string?>> Fingerprints(IEnumerable<object> calls)
    {
        var r = await Score.Run(new { fn = "scorecall", calls = calls.Select(c => new object[] { "fingerprint", c }) });
        return [.. r["results"]!.AsArray().Select(x => (string?)x)];
    }

    /* fpcalc's own answer, where it is installed. */
    private static string? Fpcalc(string file)
    {
        try
        {
            var psi = new ProcessStartInfo("fpcalc") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            psi.ArgumentList.Add("-plain");
            psi.ArgumentList.Add(file);
            using var p = Process.Start(psi)!;
            var o = p.StandardOutput.ReadToEnd().Trim();
            p.WaitForExit();
            return p.ExitCode == 0 ? o : null;
        }
        catch (System.ComponentModel.Win32Exception) { return null; }
    }

    [Test]
    public async Task The_fingerprint_of_11025_Hz_mono_samples_is_fpcalcs_byte_for_byte()
    {
        var dir = Tmp();
        var sets = new (string Name, short[] Samples)[]
        {
            ("silence", Signals.Silence(30)), ("tone", Signals.Tone(440, 20)), ("sweep", Signals.Sweep(30)),
            ("music", Signals.Music(45)), ("long", Signals.Music(150, seed: 3)),
        };
        var calls = new List<object>();
        foreach (var (name, s) in sets)
        {
            var raw = Path.Combine(dir, name + ".raw");
            var bytes = new byte[s.Length * 2];
            Buffer.BlockCopy(s, 0, bytes, 0, bytes.Length);
            await File.WriteAllBytesAsync(raw, bytes);
            await File.WriteAllBytesAsync(Path.Combine(dir, name + ".wav"), Signals.Wav(s, 11025, 1));
            calls.Add(new { raw });
        }
        var got = await Fingerprints(calls);
        for (var i = 0; i < sets.Length; i++)
        {
            var name = sets[i].Name;
            Assert.True((string?)Expected[name] == got[i], name + ": " + got[i]);
            if (Fpcalc(Path.Combine(dir, name + ".wav")) is { } live) Assert.True(live == got[i], name + ", fpcalc here: " + live);
        }
        // The long piece is 150 s, and fpcalc's string its first 120 s': no more is fingerprinted.
    }

    [Test]
    public async Task A_44_1_kHz_stereo_file_decoded_as_fpcalc_decodes_it_gives_its_fingerprint()
    {
        Needs.Server();
        Needs.Ffmpeg();
        var dir = Tmp();
        var wav = Path.Combine(dir, "clip.wav");
        await File.WriteAllBytesAsync(wav, Signals.Wav(Signals.Music(40, 44100, 2, 7), 44100, 2));
        var flac = Path.Combine(dir, "clip.flac");
        var (code, _, err) = FfmpegOut.Run(["-hide_banner", "-loglevel", "error", "-y", "-i", wav, flac]);
        Assert.True(code == 0, err);
        var got = await Fingerprints([new { file = wav }, new { file = flac }]);
        Assert.True((string?)Expected["clip"] == got[0], "the WAV: " + got[0]);
        Assert.True((string?)Expected["clip"] == got[1], "the FLAC, the same samples: " + got[1]);
        if (Fpcalc(flac) is { } live) Assert.True(live == got[1], "fpcalc here: " + live);
    }
}
