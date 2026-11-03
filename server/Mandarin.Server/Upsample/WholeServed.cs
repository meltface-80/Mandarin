// WholeServed.cs — what a whole-track plan was served as (bug list item 239, after 237): its own file, or the
// standard filter's while its own was made. Now playing says which (NowPlaying.cs), and one play keeps one file.
//
// A renderer reads a track in more than one request: a range at a time, again after a seek or a pause. Each must be
// the same file, and the standard filter's and the whole track's are not (nor, above FLAC's rates, the same kind of
// file). So a track sent with the standard filter keeps it while it is being read, until [Hold] has passed without a
// request for it; played again after that, it is its own file.
namespace Mandarin.Server.Upsample;

internal static class WholeServed
{
    /* How long after its last request a track sent with the standard filter keeps it; the tests' own, if said. */
    public static readonly TimeSpan Hold = TimeSpan.FromMilliseconds(
        int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_WHOLE_HOLD_MS"), out var h) && h >= 0 ? h : 30 * 60 * 1000);

    private static readonly Dictionary<string, (bool Whole, DateTime At)> ByKey = [];
    private static readonly Dictionary<(long Id, long Rate), bool> ByTrack = [];

    /* Whether the plan named [key] went out with the standard filter within Hold of [now]: it stays so. */
    public static bool HeldStandard(string key, DateTime now)
    {
        lock (ByKey) return ByKey.TryGetValue(key, out var v) && !v.Whole && now - v.At < Hold;
    }

    /* The plan named [key], for track [id] at [rate], sent [whole] or not at [now]. */
    public static void Record(string key, long id, long rate, bool whole, DateTime now)
    {
        lock (ByKey)
        {
            ByKey[key] = (whole, now);
            ByTrack[(id, rate)] = whole;
            if (ByKey.Count <= 2000) return;
            foreach (var old in ByKey.Where(kv => now - kv.Value.At >= Hold).Select(kv => kv.Key).ToList()) ByKey.Remove(old);
        }
    }

    /* What track [id] at [rate] was last sent as: true its own file, false the standard filter's, null not yet. */
    public static bool? Last(long id, double rate)
    {
        lock (ByKey) return ByTrack.TryGetValue((id, (long)rate), out var w) ? w : null;
    }

    /*
     * The Now playing badge's words for a whole-track plan sent [sent] (Last), its making [state] (WholeJobs.State),
     * in [shape] (item 248: "minimum phase", "gentle filter"; null: "whole track"): those words when its own file went
     * out; else the standard filter's and why.
     */
    public static string Badge(bool? sent, string? state, string? shape = null)
    {
        var what = WholeShape.Making(shape);
        return sent == true ? $" · {what}"
            : state is "queued" or "making" ? $" · standard ({what} being made)"
            : state == "failed" ? $" · standard ({what} failed: see the log)"
            : $" · standard ({what} next play)";
    }
}
