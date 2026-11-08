// Scans.Again.cs — a change the folder watcher heard while a scan was under way (bug list item 181): read by one
// more scan once that one ends. The watcher's scan was turned away ("running") and the change dropped, and music
// copied into a folder the scan had already looked in waited for the next timed scan, six hours on.
//
// Any change heard while a scan runs asks for one more (item 356): the watcher reads a long copy while it is still
// going (Watcher.Arm), so its last change may be from a moment ago, after the scan under way looked in its folder.
// A scan made again for nothing (a change from before that scan began) costs a walk of the folders.

namespace Mandarin.Server;

internal static partial class Scans
{
    // A watcher's scan turned away while one was under way (under Gate): one more is made when it ends.
    private static bool again;

    /* The watcher's scan: one now, or, with one under way, one more once it ends. */
    private static async Task FromWatcher()
    {
        Task<Scanned> scan;
        lock (Gate)
        {
            if (Running) { again = true; return; }
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
