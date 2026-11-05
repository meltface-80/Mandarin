using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Gapless (bug list item 262, Upsample/Joins.cs): tracks made as they play, joined to their album's neighbours, are
/// the stream their album makes. A signal is cut in two at a frame that is no DSF block's; each part is made as its
/// album would have it, the one before's end and the one after's start decoded beside it, and the two files laid end to
/// end are set against the whole made at once: as DSD, the same sound at the join as anywhere else (the modulators'
/// noise alone), the first part's file whole blocks, the frames short of one the second's first; as PCM upsampled,
/// the very same samples. Made each on its own, as before, the join is a click.
/// </summary>
public sealed class JoinTests
{
    private const int Rate = 44100;
    private const int Whole = 110250;    // 2.5 s
    private const int Cut = 44177;       // where the first track ends: 86 blocks of DSD64's 512 frames and 145 more

    private static JsonObject J(object o) => JsonNode.Parse(Http.Json(o))!.AsObject();

    private static void Ff(params string[] args)
    {
        var psi = new ProcessStartInfo("ffmpeg") { RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-hide_banner", "-loglevel", "error", "-y" }.Concat(args)) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var err = p.StandardError.ReadToEnd();
        p.WaitForExit();
        Assert.True(p.ExitCode == 0, err);
    }

    // The whole (two tones on the left, one on the right, 24-bit) and its two parts, cut at [Cut]: their paths.
    private static (string Whole, string A, string B) Tracks(string dir)
    {
        var whole = Path.Combine(dir, "whole.flac");
        Ff("-f", "lavfi", "-i", $"aevalsrc=0.45*sin(2*PI*997*t)+0.2*sin(2*PI*5003*t+0.3)|0.3*sin(2*PI*1500*t):s={Rate}:d=2.5", "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", whole);
        var a = Path.Combine(dir, "a.flac");
        var b = Path.Combine(dir, "b.flac");
        Ff("-i", whole, "-af", $"atrim=end_sample={Cut}", "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", a);
        Ff("-i", whole, "-af", $"atrim=start_sample={Cut},asetpts=N/SR/TB", "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", b);
        return (whole, a, b);
    }

    [Test]
    public async Task Two_tracks_made_DSD_joined_are_the_stream_they_were_cut_from_where_made_alone_they_click()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("musicd-test-").FullName;
        try
        {
            var (whole, a, b) = Tracks(dir);
            // Each filter at DSD64, and DSD256 in Gaussian steep (item 299: a Chord Poly's, ×16 to 705.6 kHz and doubled).
            foreach (var (dsd, shape) in new (int, string?)[] { (64, null), (64, "min"), (64, "gauss"), (64, "gauss-steep"), (64, "gauss-hires"), (256, "gauss-steep") })
            {
                var plan = J(new { transcode = true, hq = true, rate = Rate, bits = 1, dsdUp = dsd, inRate = Rate, reason = "", shape });
                var block = 4096 * 8 / dsd;    // a block's frames: 4096 bytes a channel, [dsd] bits a frame (DSD64: 512)
                var cut = Cut % block;
                object Job(string src, string dsf, double frames, object? join) => new object?[] { src, plan, dsf, true, frames / Rate, join };
                var jobs = (await Score.Run(new JsonObject
                {
                    ["fn"] = "plans",
                    ["dsd_job"] = JsonNode.Parse(Http.Json(new[]
                    {
                        Job(whole, Path.Combine(dir, "w.dsf"), Whole, null),
                        Job(a, Path.Combine(dir, "a.dsf"), Cut, new object?[] { null, b, 0, cut }),
                        Job(b, Path.Combine(dir, "b.dsf"), Whole - Cut, new object?[] { a, null, cut, 0 }),
                        Job(a, Path.Combine(dir, "a0.dsf"), Cut, null),
                        Job(b, Path.Combine(dir, "b0.dsf"), Whole - Cut, null),
                    })),
                }))["dsd_job"]!.AsArray();
                // The first part told of the one after and the frames it leaves; the second of the one before and the frames it starts with.
                Assert.Equal((cut, (long?)null), ((long?)jobs[1]!["cut"], (long?)jobs[1]!["carry"]));
                Assert.Contains("-t", jobs[1]!["after"]!.AsArray().Select(x => (string?)x));
                Assert.Equal(cut, (long?)jobs[2]!["carry"]);
                Assert.Contains("-sseof", jobs[2]!["before"]!.AsArray().Select(x => (string?)x));
                foreach (var job in jobs) job!["ffmpeg"] = "ffmpeg";
                // The whole, and each part alone, a making each; the two parts joined in one, the second handed to it
                // as the first is done (as MadeAsPlayed hands the next track on), the modulators running on.
                foreach (var i in new[] { 0, 3, 4 })
                {
                    var said = await Upsample(jobs[i]!.AsObject());
                    Assert.True(said["error"] == null, (string?)said["error"]);
                }
                jobs[1]!["continue"] = true;
                var both = await Upsample(jobs[1]!.AsObject(), jobs[2]!.AsObject());
                Assert.True(both.All(x => x["error"] == null), string.Join(" ", both.Select(x => x.ToJsonString())));
                Assert.Equal((double)(Cut - cut), both[0].Num("frames"));
                var joined = await Score.Run(new { fn = "joins", parts = new[] { Path.Combine(dir, "a.dsf"), Path.Combine(dir, "b.dsf") }, whole = Path.Combine(dir, "w.dsf") });
                var alone = await Score.Run(new { fn = "joins", parts = new[] { Path.Combine(dir, "a0.dsf"), Path.Combine(dir, "b0.dsf") }, whole = Path.Combine(dir, "w.dsf") });
                var what = $"DSD{dsd} " + (shape ?? "standard");
                // Every frame once: the first file whole blocks, the second the frames short of one, then its own.
                JsonAssert.Same($"[{(Cut - cut) * dsd},{(Whole - Cut + cut) * dsd}]", joined["samples"]);
                Assert.Equal((double)Whole * dsd, joined.Num("whole"));
                Assert.True(joined["blocks"]![0]!.GetValue<bool>(), "the first file ends on a whole block");
                // Joined: at the join what there is anywhere else, the modulators' noise.
                Assert.True(joined.Num("join_db") < -100, $"{what}: joined, at the join {joined.Num("join_db"):F1} dB (elsewhere {joined.Num("rest_db"):F1} dB)");
                Assert.True(joined.Num("join_db") < joined.Num("rest_db") + 10, $"{what}: joined, at the join {joined.Num("join_db"):F1} dB, elsewhere {joined.Num("rest_db"):F1} dB");
                // Alone, as before: a click.
                Assert.True(alone.Num("join_db") > -60, $"{what}: alone, at the join {alone.Num("join_db"):F1} dB");
            }
        }
        finally { Directory.Delete(dir, true); }
    }

    [Test]
    public async Task Two_tracks_upsampled_as_PCM_joined_are_the_very_samples_of_the_whole()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("musicd-test-").FullName;
        try
        {
            var (whole, a, b) = Tracks(dir);
            JsonArray Decode(string src, string? edge = null, double seconds = 0)
            {
                var d = new JsonArray("-hide_banner", "-nostdin", "-loglevel", "error");
                if (edge != null) { d.Add(edge); d.Add(edge == "-sseof" ? "-" + seconds.ToString(System.Globalization.CultureInfo.InvariantCulture) : seconds.ToString(System.Globalization.CultureInfo.InvariantCulture)); }
                foreach (var x in new[] { "-i", src, "-map", "0:a:0", "-vn", "-ac", "2", "-ar", Rate.ToString(), "-f", "f64le", "-c:a", "pcm_f64le", "pipe:1" }) d.Add(x);
                return d;
            }
            async Task<double[]> Made(string src, string name, JsonArray? before, JsonArray? after)
            {
                var raw = Path.Combine(dir, name + ".raw");
                var job = new JsonObject
                {
                    ["ffmpeg"] = "ffmpeg", ["decode"] = Decode(src), ["rate"] = Rate, ["factor"] = 4, ["shape"] = "min",
                    ["encode"] = new JsonArray("-hide_banner", "-loglevel", "error", "-f", "f64le", "-ar", (4 * Rate).ToString(), "-ac", "2", "-i", "pipe:0", "-f", "f64le", "-c:a", "pcm_f64le", "-y", raw),
                };
                if (before != null) job["before"] = before;
                if (after != null) job["after"] = after;
                var said = await Upsample(job);
                Assert.True(said["error"] == null, (string?)said["error"]);
                var bytes = File.ReadAllBytes(raw);
                return [.. Enumerable.Range(0, bytes.Length / 8).Select(i => BitConverter.ToDouble(bytes, i * 8))];
            }
            var w = await Made(whole, "w", null, null);
            var ja = await Made(a, "a", null, Decode(b, "-t", 0.35));
            var jb = await Made(b, "b", Decode(a, "-sseof", 0.35), null);
            var la = await Made(a, "a0", null, null);
            var lb = await Made(b, "b0", null, null);
            // Every frame once, four times over, two channels.
            Assert.Equal((Cut * 4 * 2, (Whole - Cut) * 4 * 2), (ja.Length, jb.Length));
            Assert.Equal(w.Length, ja.Length + jb.Length);
            double Worst(double[] x, double[] y) { double m = 0; for (var i = 0; i < w.Length; i++) m = Math.Max(m, Math.Abs((i < x.Length ? x[i] : y[i - x.Length]) - w[i])); return m; }
            var joined = Worst(ja, jb);
            var alone = Worst(la, lb);
            Assert.True(joined < 1e-9, $"joined: {joined:E2} from the whole at worst");
            Assert.True(alone > 1e-3, $"alone: {alone:E2} from the whole at worst");
        }
        finally { Directory.Delete(dir, true); }
    }

    // `mandarin-server upsample` given [first], then each of [then] once the one before is said done: their lines of JSON.
    private static async Task<JsonNode[]> Upsample(JsonObject first, params JsonObject[] then)
    {
        var psi = new ProcessStartInfo(ServerProcess.Bin) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        psi.ArgumentList.Add("upsample");
        using var p = Process.Start(psi)!;
        _ = p.StandardError.ReadToEndAsync();
        var o = new List<JsonNode>();
        foreach (var job in new[] { first }.Concat(then))
        {
            await p.StandardInput.WriteLineAsync(job.ToJsonString());
            await p.StandardInput.FlushAsync();
            if (job == then.LastOrDefault() || then.Length == 0) p.StandardInput.Close();
            o.Add(JsonNode.Parse(await p.StandardOutput.ReadLineAsync() ?? "{\"error\":\"nothing said\"}")!);
        }
        await p.WaitForExitAsync();
        return [.. o];
    }

    // `mandarin-server upsample` given [job]: its line of JSON.
    private static async Task<JsonNode> Upsample(JsonObject job)
    {
        var psi = new ProcessStartInfo(ServerProcess.Bin) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        psi.ArgumentList.Add("upsample");
        using var p = Process.Start(psi)!;
        var output = p.StandardOutput.ReadToEndAsync();
        _ = p.StandardError.ReadToEndAsync();
        await p.StandardInput.WriteLineAsync(job.ToJsonString());
        p.StandardInput.Close();
        await p.WaitForExitAsync();
        return JsonNode.Parse((await output).Trim().Split('\n')[^1])!;
    }
}
