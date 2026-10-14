using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// ReplayGain, a zone's DSP and 32-bit output, converted by the C# server as the Node server converted
/// them: the Node server's plan, its name for the file (the track's id and time aside) and its ffmpeg
/// arguments (the file in and out marked; soxr's as this machine's ffmpeg has it) are kept
/// (test/golden/conversions-csharp.json), and the file this machine's ffmpeg makes with them is the one
/// held to (test/conversions-csharp.test.js, in C#: the first test's steps, in order, in one test).
/// </summary>
public sealed partial class ConversionsCsharpTests(ConversionsCsharpTests.Book book) : IClassFixture<ConversionsCsharpTests.Book>
{
    /// <summary>test/golden/conversions-csharp.json, every kept answer asked for by the class's end.</summary>
    public sealed class Book() : KeptBook("conversions-csharp");

    [GeneratedRegex(@"resampler=soxr:precision=\d+:")] private static partial Regex Soxr();

    // The Node server's way with a conversion, as kept: the plan, its name and its ffmpeg arguments as a template.
    private JsonNode Way(string what) => book.Kept.Input(what)!;

    private static List<string> ArgsFor(JsonNode way, string input, string output) =>
        [.. way["args"]!.AsArray().Select(a => (string)a! switch { "<in>" => input, "<out>" => output, var x => Fixtures.HaveSoxr ? x : Soxr().Replace(x, "") })];

    private static string KeyOf(Dictionary<string, object?> r, JsonNode way) =>
        $"{r["id"]}-{Math.Floor(Convert.ToDouble(r["mtime"], System.Globalization.CultureInfo.InvariantCulture))}-{way.Str("name")}";

    private sealed record Got(int Status, string? By, string? Type, byte[] Body);

    private static async Task<Got> FetchAll(Session s, string addr)
    {
        var r = await Bytes.Get(s.Base + addr, s.H);
        return new Got(r.Status, r.Header("x-mandarin-answered"), r.Header("content-type"), r.Body);
    }

    [Test]
    public async Task ReplayGain_a_zones_DSP_and_32_bit_output_converted_by_the_CSharp_server_as_the_Node_server_converts_them()
    {
        await using var s = await Session.Started();
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 3, 30000, "the library");
        async Task<bool> Dsp() => (await s.Api("cpu")).J.Bool("dsp") == true;
        Dictionary<string, object?> Row(string title) => s.Server.Rows("SELECT * FROM tracks WHERE title = $1", title)[0];
        var song = Row("Song 1");
        var hi = Row("Hi 1");
        var made = Path.Combine(s.Lib.Data, "transcode");
        int n = 0;
        // The file ffmpeg makes with the Node server's own arguments for this plan.
        byte[] NodeMade(Dictionary<string, object?> r, JsonNode way)
        {
            var output = Path.Combine(s.Lib.Root, "node-made-" + (++n) + ".flac");
            var x = Fixtures.Run(ArgsFor(way, (string)r["path"]!, output));
            Assert.True(x.Code == 0, x.Err);
            return File.ReadAllBytes(output);
        }
        // Converted here, the very file the Node server's plan makes, kept under the Node server's name for it.
        async Task<string> ConvertedAsNode(string addr, Dictionary<string, object?> r, JsonNode way, string what)
        {
            var got = await FetchAll(s, addr);
            Assert.True((got.Status, got.By, got.Type) == (200, "C#", "audio/flac"), what + ": " + got.Status + " " + got.By + " " + got.Type);
            var key = KeyOf(r, way);
            var file = Path.Combine(made, key + ".flac");
            await Session.Until(() => Task.FromResult(File.Exists(file)), 10000, what + ": kept as " + key);
            var want = NodeMade(r, way);
            Assert.True(got.Body.Length == want.Length, what + ": as long as the Node server's");
            var kept = await File.ReadAllBytesAsync(file);
            Assert.True(kept.AsSpan().SequenceEqual(want), what + ": the file ffmpeg makes with the Node server's plan, byte for byte");
            var again = await FetchAll(s, addr);
            Assert.True((again.Status, again.By, again.Type) == (200, "C#", "audio/flac"), what + ": again, from the cache");
            Assert.True(again.Body.AsSpan().SequenceEqual(want), what + ": the same file");
            return key;
        }

        // A ReplayGain: on Sonos's rule (the file as it is, or the 24/48 rule) and on a renderer's rate.
        {
            // 16/44.1 FLAC, which Sonos takes as it is: with a gain, FLAC at its own rate, 24 bits.
            var p1 = Way("16/44.1 with -3 dB");
            Assert.Equal((44100.0, 24.0, -3.0, false), (p1["plan"].Num("rate") ?? 0, p1["plan"].Num("bits") ?? 0, p1["plan"].Num("gain") ?? 0, p1["plan"].Bool("hq") ?? false));
            Assert.Matches("-44100-24-g-3$", await ConvertedAsNode($"/stream/t{song["id"]}.flac?g=-3", song, p1, "16/44.1 with -3 dB"));
            // 24/96, which the 24/48 rule converts: the gain in the same conversion.
            var p2 = Way("24/96 with +2.5 dB");
            Assert.Equal((48000.0, 24.0, 2.5), (p2["plan"].Num("rate") ?? 0, p2["plan"].Num("bits") ?? 0, p2["plan"].Num("gain") ?? 0));
            await ConvertedAsNode($"/stream/t{hi["id"]}.flac?g=2.5", hi, p2, "24/96 with +2.5 dB");
            // A renderer's: the high-quality settings, the gain to a tenth of a dB.
            var p3 = Way("a renderer's 24/96 with -6 dB");
            Assert.Equal(-6, p3["plan"].Num("gain"));
            Assert.Matches("-96000-24-hq-g-6$", await ConvertedAsNode($"/stream/t{song["id"]}.96000-24.flac?g=-6.04", song, p3, "a renderer's 24/96 with -6 dB"));
            // A gain too small to hear is none: the file as it is.
            var quiet = await FetchAll(s, $"/stream/t{song["id"]}.flac?g=0.04");
            var asItIs = await File.ReadAllBytesAsync((string)song["path"]!);
            Assert.Equal((200, "C#", true), (quiet.Status, quiet.By, quiet.Body.AsSpan().SequenceEqual(asItIs)));
        }

        // A zone's DSP, read as the device fetches; a Sonos room's left out; with a gain too.
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            foreach (var (id, kind) in new[] { ("UPNP_test-dsp", "upnp"), ("RINCON_TESTDSP01400", "sonos") })
                s.Server.Exec("INSERT INTO audio_devices(id, kind, network_name, first_seen, last_seen) VALUES($1, $2, $3, $4, $5)", id, kind, id, now, now);
            var set = await Http.Send(HttpMethod.Patch, s.Base + "/api/audio-devices/UPNP_test-dsp", new StringContent(Http.Json(new
            {
                dsp = new { enabled = true, peq = new { bands = new object[] { new { type = "peak", freq = 1000, gain = 4, q = 1.2 }, new { type = "low_shelf", freq = 90, gain = -3, q = 0.7 } } } }
            }), System.Text.Encoding.UTF8, "application/json"), s.H);
            Assert.True(set.Status == 200, set.Text);
            // A Sonos room is tuned with Trueplay: a setting written for one anyway is left out, as the Node server leaves it.
            s.Server.Exec("UPDATE audio_devices SET settings = $1 WHERE id = $2", Http.Json(new { dsp = new { enabled = true, peq = new { bands = new[] { new { type = "peak", freq = 500, gain = 6, q = 1 } } } } }), "RINCON_TESTDSP01400");
            var dspBefore = await Dsp();
            var p1 = Way("24/96 to 48 kHz with the zone's DSP");
            Assert.True(p1["plan"]?["dsp"].Str("hash") is { Length: > 0 }, "the Node server's plan has the DSP");
            var k1 = await ConvertedAsNode($"/stream/t{hi["id"]}.48000-24.flac?o=UPNP_test-dsp", hi, p1, "24/96 to 48 kHz with the zone's DSP");
            Assert.Matches($"-48000-24-hq-d{p1["plan"]?["dsp"].Str("hash")}$", k1);
            Assert.False(dspBefore, "no DSP in use before");
            await Session.Until(Dsp, 5000, "playback's second core while DSP runs, and for a while after");
            // With a gain as well: the gain first, then the DSP.
            var p2 = Way("the zone's DSP and -4 dB");
            Assert.Matches("-hq-d[0-9a-f]+-g-4$", await ConvertedAsNode($"/stream/t{hi["id"]}.96000-24.flac?o=UPNP_test-dsp&g=-4", hi, p2, "the zone's DSP and -4 dB"));
            // A Sonos room's, or a zone that isn't one: no DSP, the conversion alone.
            foreach (var o in new[] { "RINCON_TESTDSP01400", "nobody" })
            {
                var p = Way("?o=" + o);
                Assert.Null(p["plan"]?["dsp"]);
                Assert.Matches("-44100-24-hq$", await ConvertedAsNode($"/stream/t{hi["id"]}.44100-24.flac?o={o}", hi, p, "?o=" + o));
            }
        }

        // 32-bit output: made here where this ffmpeg writes 32-bit FLAC, else refused as before.
        {
            var addr = $"/stream/t{hi["id"]}.96000-32.flac";
            var way = Way("a renderer's 32/96");
            if (FfmpegOut.HaveFlac32) await ConvertedAsNode(addr, hi, way, "a renderer's 32/96");
            else
            {
                var got = await FetchAll(s, addr);
                Assert.True((got.Status, got.By) == (400, "C#"), "this ffmpeg caps FLAC at 24 bits: a 400, as the Node server said it");
            }
        }

        // A gain as Express read it: a list of one is that gain; two, or one out of range, a 400.
        foreach (var (q, status) in new[] { ("g%5B%5D=-3", 200), ("g[]=-3", 200), ("g[0]=-3", 200), ("g=-3&g=-3", 400), ("g[a]=-3", 400), ("g=99", 400), ("g=-30", 400), ("g=loud", 400) })
        {
            var got = await FetchAll(s, $"/stream/t{song["id"]}.flac?{q}");
            Assert.True((got.Status, got.By) == (status, "C#"), q);
        }
    }

    // 32-bit output end to end, on any machine: the server started behind an ffmpeg that says, when asked,
    // that it writes 32-bit FLAC and is otherwise the real one.
    [Test]
    public async Task Output_of_32_bits_end_to_end_an_ffmpeg_that_writes_it()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        var wrapper = Path.Combine(lib.Root, "ffmpeg-32");
        await File.WriteAllTextAsync(wrapper, """
            #!/bin/sh
            # The 32-bit FLAC probe answered yes: a STREAMINFO of 32 bits per sample. Anything else: the real ffmpeg.
            case " $* " in *" anullsrc=r=44100:cl=stereo "*) printf 'fLaC\200\000\000\042'; head -c 12 /dev/zero; printf '\001\360'; head -c 28 /dev/zero; exit 0;; esac
            exec "$REAL_FFMPEG" "$@"

            """);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(wrapper, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var real = Fixtures.Ffmpeg;
        await using var s = await Session.Started(lib: lib, env: new Dictionary<string, string> { ["FFMPEG_PATH"] = wrapper, ["REAL_FFMPEG"] = FfmpegPath(real) });
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 3, 30000, "the library");
        var hi = s.Server.Rows("SELECT * FROM tracks WHERE title = $1", "Hi 1")[0];
        var way = Way("a renderer's 32/96, end to end");
        var r = await Bytes.Get(s.Base + $"/stream/t{hi["id"]}.96000-32.flac", s.H);
        Assert.True((r.Status, r.Header("x-mandarin-answered")) == (200, "C#"), "a renderer's 32/96, converted by C#");
        var file = Path.Combine(lib.Data, "transcode", KeyOf(hi, way) + ".flac");
        Assert.Matches(@"-96000-32-hq\.flac$", Path.GetFileName(file));
        await Session.Until(() => Task.FromResult(File.Exists(file)), 10000, "kept as " + Path.GetFileName(file));
        var output = Path.Combine(lib.Root, "node-made-32.flac");
        var x = Fixtures.Run(ArgsFor(way, (string)hi["path"]!, output));
        Assert.True(x.Code == 0, x.Err);
        var want = await File.ReadAllBytesAsync(output);
        var kept = await File.ReadAllBytesAsync(file);
        Assert.True(kept.AsSpan().SequenceEqual(want), "the file the Node server's 32-bit plan makes, byte for byte");
        Assert.Equal(want.Length, r.Body.Length);
    }

    // The real ffmpeg's whole path, for a script that runs it.
    private static string FfmpegPath(string ffmpeg)
    {
        if (Path.IsPathRooted(ffmpeg)) return ffmpeg;
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(':'))
            if (File.Exists(Path.Combine(dir, ffmpeg))) return Path.Combine(dir, ffmpeg);
        return ffmpeg;
    }
}
