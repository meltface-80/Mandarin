using System.Collections.Concurrent;
using System.Diagnostics;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// MusicBrainz's one request a second, for the whole server (bug list item 417, Identify/MbSlot.cs). The wait let the
/// next request go 1.1 s after the last one began, so a slow answer and the next request reached MusicBrainz moments
/// apart; and the rest after a 503 was looked at before the wait, so every asker already waiting sent its request into
/// the refusal (the owner's log: a second 503 1.1 s after the first). Now one request at a time, the next a gap after the
/// last one's answer (here MUSICBRAINZ_GAP_MS, for a MusicBrainz of the test's own); the rest looked at once a turn has
/// come; and a 503's Retry-After rests it as long, where that is longer than its own rest.
/// </summary>
public sealed class MusicBrainzSlotTests
{
    /* A MusicBrainz that answers each request half a second after it came (/ws/2/busy: a 503 asking for 3 s), noting when. */
    private sealed class Slow : IAsyncDisposable
    {
        private FakeServer? srv;
        private readonly Stopwatch clock = Stopwatch.StartNew();
        public readonly ConcurrentQueue<(string Path, double Came, double Answered)> Asked = new();
        public string Base => srv!.Base + "/ws/2";

        public static async Task<Slow> Start()
        {
            var me = new Slow();
            me.srv = await FakeServer.Start(me.Answer);
            return me;
        }

        private async Task Answer(HttpContext ctx)
        {
            var came = clock.Elapsed.TotalMilliseconds;
            await Task.Delay(500);
            var path = ctx.Request.Path.Value ?? "";
            if (path.EndsWith("/busy", StringComparison.Ordinal)) { ctx.Response.StatusCode = 503; ctx.Response.Headers.RetryAfter = "3"; }
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsync("{}");
            Asked.Enqueue((path, came, clock.Elapsed.TotalMilliseconds));
        }

        public ValueTask DisposeAsync() => srv?.DisposeAsync() ?? ValueTask.CompletedTask;
    }

    [Test]
    public async Task Many_asking_at_once_reach_MusicBrainz_one_at_a_time_a_second_after_the_last_answer()
    {
        await using var mb = await Slow.Start();
        var r = await Score.Run(new { fn = "mbask", @base = mb.Base, asks = Enumerable.Range(0, 4).Select(i => new { at = 0, path = $"/release/{i}" }) },
            new Dictionary<string, string> { ["MUSICBRAINZ_GAP_MS"] = "1000" });
        Assert.All(r["asked"]!.AsArray(), a => Assert.Equal(true, a.Bool("ok")));
        var asked = mb.Asked.OrderBy(a => a.Came).ToList();
        Assert.Equal(4, asked.Count);
        for (var i = 1; i < asked.Count; i++)
            Assert.True(asked[i].Came - asked[i - 1].Answered >= 950,
                $"request {i + 1} came {Math.Round(asked[i].Came - asked[i - 1].Answered)} ms after the answer before it: {string.Join(", ", asked.Select(a => $"{Math.Round(a.Came)}–{Math.Round(a.Answered)}"))}");
    }

    [Test]
    public async Task After_a_503_those_waiting_their_turn_send_nothing_and_its_Retry_After_is_honoured()
    {
        await using var mb = await Slow.Start();
        // The 503 at once; two waiting their turn behind it; one 2 s on (the rest's own 0.5 s gone, Retry-After's 3 s not);
        // one after both.
        var asks = new[] { (0, "/busy"), (50, "/release/x"), (100, "/release/y"), (2000, "/release/z"), (4500, "/release/w") };
        var r = await Score.Run(new { fn = "mbask", @base = mb.Base, asks = asks.Select(a => new { at = a.Item1, path = a.Item2 }) },
            new Dictionary<string, string> { ["MUSICBRAINZ_GAP_MS"] = "200", ["MUSICBRAINZ_REST_MS"] = "500" });
        var answers = r["asked"]!.AsArray().Select(a => (a.Bool("ok"), a.Bool("paused"))).ToList();
        Assert.Equal([(false, true), (false, true), (false, true), (false, true), (true, null)], answers);
        Assert.Equal(["/ws/2/busy", "/ws/2/release/w"], mb.Asked.OrderBy(a => a.Came).Select(a => a.Path));
    }
}
