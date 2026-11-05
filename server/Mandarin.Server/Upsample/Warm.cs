// Warm.cs — a making of DSD kept on after its track for the next one's (bug list item 262).
//
// A DSF made as it plays, joined to the next track on its album, is made on into the start of that track and then
// waits (UpsampleCommand.Dsds): its modulators as they were where its file ends. When the next track's making comes
// in its turn (MadeAsPlayed.Start, as the device is told of it), it is handed to this one, which goes on into it, so
// that the two files are one stream; a making that comes for anything else, or a play of something else, or nothing
// for [Hold], and it is stopped. One is kept at most: one making runs at a time.
using System.Diagnostics;

namespace Mandarin.Server.Upsample;

internal static class Warm
{
    /* How long a making is kept for the next track's: two minutes, as the next is begun in its turn. */
    public static readonly int Hold = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_MAKE_WARM_MS"), out var h) && h > 0 ? h : 2 * 60 * 1000;

    private static readonly object Gate = new();
    private static (Process Proc, string Key, Task<string> Trace)? kept;
    private static Timer? timer;

    /* The making kept for the track of [key], taken; any other kept, stopped. */
    public static (Process, Task<string>)? Take(string key)
    {
        lock (Gate)
        {
            if (kept is { } k && k.Key == key && !k.Proc.HasExited)
            {
                kept = null;
                timer?.Dispose(); timer = null;
                return (k.Proc, k.Trace);
            }
            Drop();
            return null;
        }
    }

    /* [proc] kept for the track of [key], what it says wrong read in [trace]; any kept before it stopped. */
    public static void Keep(Process proc, string key, Task<string> trace)
    {
        lock (Gate)
        {
            Drop();
            kept = (proc, key, trace);
            timer = new Timer(_ => { lock (Gate) { if (kept?.Proc == proc) Drop(); } }, null, Hold, Timeout.Infinite);
        }
    }

    /* The one kept stopped unless it is kept for one of [keys] (another play: item 246). */
    public static void Unless(IReadOnlySet<string> keys)
    {
        lock (Gate) if (kept is { } k && !keys.Contains(k.Key)) Drop();
    }

    // The one kept stopped: told there is nothing more, and ended.
    private static void Drop()
    {
        timer?.Dispose(); timer = null;
        if (kept is not { } k) return;
        kept = null;
        try { k.Proc.StandardInput.Close(); } catch (IOException) { /* gone */ }
        try { if (!k.Proc.WaitForExit(2000)) k.Proc.Kill(true); } catch (InvalidOperationException) { /* ended */ }
        Cpu.Forget(k.Proc);
        k.Proc.Dispose();
    }
}
