// MbSlot.cs — MusicBrainz's one request a second, for the whole server (bug list item 417).
//
// Lookups.MbWait (v0.8.19) let each request go 1.1 s after the last one had been let go, measured from that one's
// start: a request that took a second to be answered (a search on a busy MusicBrainz, a new connection's handshake)
// and the next one, sent 1.1 s after it began, reached musicbrainz.org a tenth of a second apart, or at once where the
// first was slow to leave. And the rest after a 503 (MusicBrainz.Ask) was looked at before the wait: every asker
// already queued in it (the scan's next release, the cover finder, the credits, the release days) still sent its
// request into the refusal: on the owner's server a second 503 1.1 s after the first (13 Nov 08:49:10 and :11, 14 Nov
// 17:12:05 and :07), the rest doubled. And Edit album's Find asked musicbrainz.org outside the wait (ArtFind.Web).
//
// Now a request to musicbrainz.org is made inside the slot: one at a time, the next sent [GapMs] after the last one's
// answer was had (its end, not its start), and whatever is asked once its turn has come (whether MusicBrainz rests
// still) is asked then. MusicBrainz.Ask honours a 503's Retry-After in its rest. A MusicBrainz the configuration puts
// elsewhere (the tests' fakes) is asked without the slot, unless MUSICBRAINZ_GAP_MS gives it one: a test's own gap.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal static class MbSlot
{
    /* The gap after a request's answer before the next request goes: 1.1 s at musicbrainz.org. */
    public const int GapMs = 1100;

    // A gap for a MusicBrainz elsewhere (MUSICBRAINZ_GAP_MS: a test's, to see the slot kept); none by default.
    private static readonly int ElsewhereMs = int.TryParse(Environment.GetEnvironmentVariable("MUSICBRAINZ_GAP_MS"), out var g) && g > 0 ? g : 0;

    private static readonly SemaphoreSlim Lock = new(1, 1);
    private static long lastEnd = long.MinValue / 2;   // Environment.TickCount64 when the last request's answer was had

    /* The gap kept for the MusicBrainz at [baseUrl]: musicbrainz.org's, a test's own elsewhere, or 0 (no slot). */
    public static int GapFor(string baseUrl) => baseUrl == MusicBrainz.DefaultBase ? GapMs : ElsewhereMs;

    /*
     * [ask] made in the slot, [gapMs] after the last request's end: alone (whoever else asks waits for its answer), its
     * end the next one's start of the gap, whether it was answered, refused or failed.
     */
    public static async Task<T> Run<T>(int gapMs, Func<Task<T>> ask, CancellationToken ct = default)
    {
        await Lock.WaitAsync(ct);
        try
        {
            var wait = Volatile.Read(ref lastEnd) + gapMs - Environment.TickCount64;
            if (wait > 0) await Task.Delay(TimeSpan.FromMilliseconds(wait), ct);
            try { return await ask(); }
            finally { Volatile.Write(ref lastEnd, Environment.TickCount64); }
        }
        finally { Lock.Release(); }
    }

    /*
     * `mandarin-server score`'s { fn: "mbask", base, asks: [{ at, path }] } (the tests): each path asked of the MusicBrainz
     * at [base] [at] ms after the first, all at once, as MusicBrainz.Ask asks it → { asked: [{ ok, status, paused, error }] }.
     */
    public static JsObj Command(JsObj job)
    {
        var bas = Js.Str(job["base"]).TrimEnd('/');
        var asks = (job["asks"] as List<object?> ?? []).OfType<JsObj>().ToList();
        // What the rest says in the log, kept off the command's own answer (standard output).
        var was = Console.Out;
        Console.SetOut(Console.Error);
        try
        {
            var all = asks.Select(async a =>
            {
                await Task.Delay(TimeSpan.FromMilliseconds(Js.ToNumber(a["at"]) is var at && at > 0 ? at : 0));
                var o = new JsObj();
                try
                {
                    await MusicBrainz.Ask(bas, bas + Js.Str(a["path"]), [("User-Agent", "Mandarin/test")], 15000);
                    o["ok"] = true;
                }
                catch (LookupError e) { o["ok"] = false; o["status"] = (double)e.Status; o["paused"] = e.Paused; o["error"] = e.Message; }
                return (object?)o;
            }).ToList();
            return new JsObj { ["asked"] = Task.WhenAll(all).GetAwaiter().GetResult().ToList() };
        }
        finally { Console.SetOut(was); }
    }
}
