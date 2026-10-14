using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The identification scan made by the C# server (v0.8.19, Identify/) decides what the Node server's
/// decided: the scorer asked — `mandarin-server score` — over a corpus of awkward names and hundreds of
/// generated albums and candidate releases, every number, part, pair and verdict compared; and a file's
/// waveform decoded, bucket for bucket. The jobs its JavaScript made, seeded, are kept as they were sent
/// (test/golden/identify-csharp.jobs.json.gz), the Node server's answers beside them
/// (identify-csharp.json); a waveform is held to the Node server's rule as WaveformRule keeps it, on this
/// machine's ffmpeg (test/identify-csharp.test.js, in C#).
/// </summary>
public sealed class IdentifyCsharpTests(IdentifyCsharpTests.Book book) : IClassFixture<IdentifyCsharpTests.Book>
{
    /// <summary>test/golden/identify-csharp.json, every kept answer asked for by the class's end.</summary>
    public sealed class Book() : KeptBook("identify-csharp");

    private static readonly Lazy<List<JsonObject>> Jobs = new(() => [.. Golden.Jobs("identify-csharp").Select(j => j!.AsObject())]);

    private static List<JsonObject> Of(string fn) => [.. Jobs.Value.Where(j => j.Str("fn") == fn)];

    [Test]
    public async Task The_scorers_names_tidied_bare_clean_compared_edition_years_disc_marks_the_same_both_ways()
    {
        Needs.Server();
        var job = Of("names").Single();
        var c = (await Golden.ScoreMany([job]))[0];
        var names = job["names"]!.AsArray().ToList();
        book.Kept.Same("names", [.. names.Cast<object?>()], names, [.. c["names"]!.AsArray()]);
    }

    [Test]
    public async Task The_scorers_distances_between_names_and_suspect_artists_the_same_both_ways()
    {
        Needs.Server();
        var job = Of("pairs").Single();
        var c = (await Golden.ScoreMany([job]))[0];
        var pairs = job["pairs"]!.AsArray().ToList();
        book.Kept.Same("pairs", [.. pairs.Select(_ => (object?)"pair")], pairs, [.. c["pairs"]!.AsArray()]);
    }

    [Test]
    public async Task The_scorers_verdicts_over_generated_albums_every_distance_part_pair_and_verdict_the_same_both_ways()
    {
        Needs.Server();
        var jobs = Of("decide");
        Assert.Equal(700, jobs.Count);
        var got = await Golden.ScoreMany(jobs);
        Assert.Equal(jobs.Count, got.Count);
        book.Kept.Same("decide", [.. jobs.Select((_, i) => (object?)("case " + i))], [.. jobs.Select(j => j["album"])], [.. got]);
    }

    [Test]
    public async Task A_waveform_decoded_by_the_CSharp_server_is_the_Node_servers_bucket_for_bucket()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("musicd-wave-").FullName;
        try
        {
            async Task<string> Server(string f, string? seconds) => (await ServerCommand.Run(seconds == null ? ["waveform", f] : ["waveform", f, seconds])).Out.Trim();
            var files = new (string Name, Action<string> Make)[]
            {
                ("sine.flac", f => Fixtures.Gen(f, freq: 440, seconds: 4)),
                ("short.flac", f => Fixtures.Gen(f, freq: 220, seconds: 0.3)),
                ("hires.flac", f => Fixtures.Gen(f, freq: 1000, seconds: 3, rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"])),
                ("lossy.mp3", f => Fixtures.Gen(f, freq: 330, seconds: 5, fmt: null, codecArgs: ["-b:a", "128k"]))
            };
            foreach (var (name, make) in files)
            {
                var f = Path.Combine(dir, name);
                make(f);
                var want = WaveformRule.Of(f, 0);
                Assert.True(want != null, name + ": a waveform");
                Assert.True(await Server(f, "0") == want, name);
            }
            // One said to be far longer than it is: no waveform either way.
            var sine = Path.Combine(dir, "sine.flac");
            Assert.Null(WaveformRule.Of(sine, 60));
            Assert.Equal("null", await Server(sine, "60"));
            // Not audio at all.
            var junk = Path.Combine(dir, "junk.flac");
            await File.WriteAllTextAsync(junk, "not audio");
            Assert.Null(WaveformRule.Of(junk, 0));
            Assert.Equal("null", await Server(junk, null));
        }
        finally { Directory.Delete(dir, true); }
    }
}
