using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// A making kept warm for the next track (items 262, 267): the cores given back while it waits, then taken again for
/// the next track's making, and the making moved back onto all of them. Before, a process already on some of
/// playback's cores was left there when playback was given more: the owner's DSD256, made "on from the track before",
/// ran on one core at 1.15× real time, barely ahead of the device, and the FiiO SR11 stopped answering.
/// </summary>
public sealed partial class CpuAloneTests
{
    // This server's children making as they play (`mandarin-server upsample`).
    private static List<int> Makings(int server) => [.. Directory.GetDirectories("/proc").Select(d => int.TryParse(Path.GetFileName(d), out var pid) ? pid : 0).Where(pid =>
    {
        if (pid == 0) return false;
        try
        {
            var stat = File.ReadAllText($"/proc/{pid}/stat");
            var rest = stat[(stat.LastIndexOf(')') + 2)..].Split(' ');
            return rest.Length > 1 && rest[0] != "Z" && rest[1] == server.ToString(System.Globalization.CultureInfo.InvariantCulture)
                && File.ReadAllText($"/proc/{pid}/cmdline").Split('\0').Contains("upsample");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return false; }
    })];

    [Test]
    public async Task A_making_kept_for_the_next_track_is_moved_back_onto_all_of_playbacks_cores_when_they_are_kept_again()
    {
        NeedReal(); Needs.Ffmpeg();
        var cores = Mine.Value.Take(4).ToList();
        await using var s = await Start(cores, new() { ["MANDARIN_CPU_MAKING_HOLD_MS"] = "0", ["MANDARIN_MAKE_WARM_MS"] = "120000" });
        // An album that runs on, two 44.1 kHz tracks long enough to be making the second for a while.
        foreach (var i in new[] { 1, 2 })
            Fixtures.Gen(Path.Combine(s.Lib.Music, "Artist C", "Run On", $"0{i} Part {i}.flac"), seconds: 40, freq: 300 * i,
                tags: new Dictionary<string, object> { ["title"] = $"Part {i}", ["artist"] = "Artist C", ["album"] = "Run On", ["track"] = i });
        Assert.Equal(200, (await Http.Post(s.Proc.Base + "/api/library/rescan", new { force = true }, s.H)).Status);
        var ids = new List<double>();
        await Session.Until(async () =>
        {
            var albums = (await Http.Get(s.Proc.Base + "/api/library/albums?sort=album", s.H)).J["albums"].Items().ToList();
            if (albums.FirstOrDefault(a => a.Str("title") == "Run On") is not { } al) return false;
            var page = (await Http.Get(s.Proc.Base + "/api/album?offset=" + al.Num("offset"), s.H)).J;
            ids = [.. page["tracks"]!.AsArray().Select(t => t.Num("track_id") ?? 0)];
            return ids.Count == 2;
        }, 60000, "the album read");
        var plain = JsonNode.Parse(Decide(cores))!["playback"]!.AsArray().Select(x => x!.GetValue<int>()).ToList();

        // The first made whole as DSD256, and the making kept for the second: on playback's one core once the cores are given back.
        var first = await Bytes.Get($"{s.Proc.Base}/stream/t{ids[0]}.d256.dsf", s.H);
        Assert.Equal(200, first.Status);
        var server = s.Proc.Proc.Id;
        int warm = 0;
        await Session.Until(() => Task.FromResult(Makings(server) is [var only] && (warm = only) > 0), 10000, "the making kept for the next track");
        await Session.Until(async () => (await s.Cpu()).Bool("making") == false, 10000, "the cores given back");
        await Session.Until(() => Task.FromResult(ThreadsOf(warm).All(x => x == Compact(plain))), 10000, "the kept making on playback's one core");

        // The second asked for: the cores kept again, and the kept making on all of them while it makes the second.
        var second = Bytes.Get($"{s.Proc.Base}/stream/t{ids[1]}.d256.dsf", s.H);
        JsonNode? cpu = null;
        await Session.Until(async () => (cpu = await s.Cpu()).Bool("making") == true, 10000, "the cores kept again");
        var making = Compact([.. cpu!["playback"]!.AsArray().Select(x => x!.GetValue<int>())]);
        Assert.True(making != Compact(plain), "more than one core kept for the making: " + making);
        Assert.Equal([warm], Makings(server));
        await Session.Until(() => Task.FromResult(ThreadsOf(warm) is { Count: > 0 } t && t.All(x => x == making)), 5000,
            $"the kept making moved onto {making} (its threads: {string.Join(" ", ThreadsOf(warm).Distinct())})");
        Assert.Equal(200, (await second).Status);
    }
}
