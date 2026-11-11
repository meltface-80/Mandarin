// Warm.cs — a making of DSD kept on after its track for the next one's (bug list item 262).
//
// A DSF made as it plays, joined to the next track on its album, is made on into the start of that track and then
// waits (UpsampleCommand.Dsds): its modulators as they were where its file ends. When the next track's making comes
// in its turn (MadeAsPlayed.Start, as the device is told of it), it is handed to this one, which goes on into it, so
// that the two files are one stream; a play of something else, or nothing for [Hold], and it is stopped. One is kept
// for each track (audit H2): another room's making, in its turn while this room's device plays on, no longer stops
// the one kept for this room's next track. At most [Most] are kept, the oldest stopped first.
using System.Diagnostics;

namespace Mandarin.Server.Upsample;

internal static class Warm
{
    /* How long a making is kept for the next track's: two minutes, as the next is begun in its turn. */
    public static readonly int Hold = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_MAKE_WARM_MS"), out var h) && h > 0 ? h : 2 * 60 * 1000;

    /* The most kept at once: one for each room's next track, a few rooms' worth. */
    public const int Most = 4;

    private sealed record Kept(Process Proc, Task<string> Trace, Timer Timer);

    private static readonly object Gate = new();
    private static readonly Dictionary<string, Kept> Kepts = [];
    private static readonly List<string> Order = [];   // the keys kept, the oldest first

    /* The making kept for the track of [key], taken; null where none is (or it has ended). */
    public static (Process, Task<string>)? Take(string key)
    {
        lock (Gate)
        {
            if (!Kepts.TryGetValue(key, out var k)) return null;
            if (k.Proc.HasExited) { Drop(key); return null; }
            Forget(key, k);
            return (k.Proc, k.Trace);
        }
    }

    /* [proc] kept for the track of [key], what it says wrong read in [trace]; any kept before it for that track stopped. */
    public static void Keep(Process proc, string key, Task<string> trace)
    {
        lock (Gate)
        {
            Drop(key);
            while (Order.Count >= Most) Drop(Order[0]);
            var timer = new Timer(_ => { lock (Gate) { if (Kepts.TryGetValue(key, out var k) && k.Proc == proc) Drop(key); } }, null, Timeout.Infinite, Timeout.Infinite);
            Kepts[key] = new Kept(proc, trace, timer);
            Order.Add(key);
            timer.Change(Hold, Timeout.Infinite);
        }
    }

    /* Those kept stopped unless kept for one of [keys] (another play: item 246). */
    public static void Unless(IReadOnlySet<string> keys)
    {
        lock (Gate) foreach (var key in Order.Where(k => !keys.Contains(k)).ToList()) Drop(key);
    }

    // The one kept for [key] no longer kept, its timer stopped; still running.
    private static void Forget(string key, Kept k)
    {
        k.Timer.Dispose();
        Kepts.Remove(key);
        Order.Remove(key);
    }

    // The one kept for [key] stopped: told there is nothing more, and ended.
    private static void Drop(string key)
    {
        if (!Kepts.TryGetValue(key, out var k)) return;
        Forget(key, k);
        try { k.Proc.StandardInput.Close(); } catch (IOException) { /* gone */ }
        try { if (!k.Proc.WaitForExit(2000)) k.Proc.Kill(true); } catch (InvalidOperationException) { /* ended */ }
        Cpu.Forget(k.Proc);
        k.Proc.Dispose();
    }
}
