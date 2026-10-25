// Scans.Again.cs — a change the folder watcher heard while a scan was under way (bug list item 181): read by one
// more scan once that one ends. The watcher's scan was turned away ("running") and the change dropped, and music
// copied into a folder the scan had already looked in waited for the next timed scan, six hours on.
//
// Only a change heard since that scan began asks for one more: one from before it is the scan's to read. The
// watcher starts its scan once the changes have been quiet for its quiet time (Watcher.Arm: that, or longer for
// its gap), so the last of them was no later than that long before: taken as then, a change is never missed, and
// a scan is made again for nothing only when the gap held the watcher's back.
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Scans
{
    // A watcher's scan turned away while one was under way (under Gate): one more is made when it ends.
    private static bool again;

    /* The watcher's scan: one now, or, with one under way that began before the change, one more once it ends. */
    private static async Task FromWatcher()
    {
        Task<Scanned> scan;
        lock (Gate)
        {
            if (Running)
            {
                var began = state["startedAt"] is JsonValue v && v.TryGetValue<double>(out var t) ? t : double.MinValue;   // not known: as before the change
                if (NowMs() - Ms("MANDARIN_WATCH_QUIET_MS", 20000) >= began) again = true;
                return;
            }
            scan = Run(false, false);
        }
        await scan;
    }

    /* A scan ended: the one more a change heard meanwhile asked for, unless another has begun since (it reads that change). */
    private static void AgainIfAsked()
    {
        lock (Gate)
        {
            if (!again) return;
            again = false;
            if (!on || stopping || Running) return;
            Server.Log("[watch] the music folders changed during the scan: reading them again");
            Kick();
        }
    }
}
