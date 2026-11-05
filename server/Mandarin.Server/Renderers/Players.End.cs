// Players.End.cs — a renderer that says PLAYING at the end of a track and goes no further (bug list item 246).
//
// A track ends one of two ways: the renderer moves on to the next URI it was given, or it stops and the next is
// started by hand (Players.Poll.cs). A FiiO SR11 at the end of a WAV whose length is left open (item 238) does
// neither: it waits for more that never comes, still PLAYING, its position at the end. With nothing armed (the next
// track not yet ready, or a device without SetNextAVTransportURI), the room stopped there. So a track whose own
// length has run out, its position past the end or standing still at it, is moved on from by hand, once.
using Mandarin.Server.Playback;

namespace Mandarin.Server.Renderers;

internal sealed partial class Players
{
    /* How long a position may stand still at a track's end, or run on past it, before the next is started (ms; s). */
    private const double StillAtEnd = 6000, PastEnd = 4;

    /*
     * Read playing [item], track [index], at [rel] s: the next started by hand when the track has run out and the
     * renderer has nothing to go on to.
     */
    private void Overrun(Player p, UpnpItem item, int index, double rel)
    {
        int n;
        lock (gate)
        {
            var now = Hub.Now();
            if (p.EndIndex != index || Math.Abs(rel - p.EndRel) > 0.5) { p.EndIndex = index; p.EndRel = rel; p.EndSince = now; }
            var known = item.Duration;
            var stuck = now - p.EndSince >= StillAtEnd && rel >= known - 2;
            if (known <= 0 || p.Jumping > 0 || p.EndedOn == index || !(stuck || rel >= known + PastEnd)) return;
            // Something armed and taken by the device would have moved the room on already; with it armed and not
            // taken, the device has shown it won't.
            n = NextIndex(p);
            if (n < 0 || n == index) return;
            p.EndedOn = index;
        }
        Log($"[renderers] {RendererOf(p).Name}: still playing at the end of track {index + 1} ({Math.Round(rel)} s of {Math.Round(item.Duration)} s); track {n + 1} started by hand");
        _ = Jump(p, n).ContinueWith(t => Fail(p, t.Exception?.InnerException?.Message ?? "failed"), TaskContinuationOptions.OnlyOnFaulted);
    }
}
