// KeepingUp.cs — how fast each making goes as it goes, Roon's "processing speed" (bug list item 346).
//
// A making's speed was said once it had finished ("made as it played at 3.2× real time", MadeAsPlayed.cs), and the
// Output page said whether the last one kept up. Nothing said, while a track played, whether the one being made was
// keeping up with the device. Now each making's speed is read as it goes (Pace.Holder, every tenth of a second): the
// music made over the last [Window] seconds it worked, never the time it was held ahead of the device, which is no
// work. Its signal path says it ("Processing · 3.2× real time"); a making slower than real time over a whole window
// will run the device dry, and its device's Output is put back to the last that kept up (Renderers/Players.Safety.cs).
using System.Collections.Concurrent;

namespace Mandarin.Server.Upsample;

internal static class KeepingUp
{
    /* The seconds of work a speed is read over. */
    public const double Window = 10;
    /* As fast as this, a making keeps up with room to spare (MadeAsPlayed.Note's word). */
    public const double Room = 1.15;

    /* A making's speed (× real time) over the last [Span] seconds it worked; [Done] once it has made the whole track. */
    public sealed record Speed(double Times, double Span, bool Done);

    private static readonly ConcurrentDictionary<string, Speed> Live = new();

    /* Making [key] read at [times] × real time over [span] s of its work. */
    public static void Saw(string key, double times, double span)
    {
        if (Live.Count > 64) foreach (var k in Live.Where(kv => kv.Value.Done).Select(kv => kv.Key).Take(32).ToList()) Live.TryRemove(k, out _);
        Live.AddOrUpdate(key, new Speed(times, span, false), (_, was) => was.Done ? was : new Speed(times, span, false));
    }

    /* Making [key] finished, at [times] × real time over the whole of it (0: not known, the last read kept). */
    public static void Finished(string key, double times) =>
        Live.AddOrUpdate(key, new Speed(times, 0, true), (_, was) => new Speed(times > 0 ? times : was.Times, was.Span, true));

    /* Making [key]'s speed; null where it hasn't been read (made before, or not yet a window's worth). */
    public static Speed? Of(string? key) => key != null && Live.TryGetValue(key, out var s) ? s : null;

    /* Whether [s] is falling behind: slower than real time over a whole window, and not yet done. */
    public static bool Behind(Speed? s) => s is { Done: false } && s.Span >= Window * 0.8 && s.Times < 1;

    /* [s] in words: "3.2× real time". */
    public static string Words(double times) => Math.Round(times, times < 10 ? 1 : 0).ToString(System.Globalization.CultureInfo.InvariantCulture) + "× real time";
}
