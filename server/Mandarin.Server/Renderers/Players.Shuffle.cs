// Players.Shuffle.cs — the track after this one with shuffle on (item 183).
// Picked once for the track playing and kept: a renderer is read every second
// or so and armed with what follows at each read, and a new pick at each read
// told it another next track every time, a conversion of each started. The
// pick is made again only when it no longer holds: another track playing,
// the one picked gone from the queue or played, the modes changed.
namespace Mandarin.Server.Renderers;

internal sealed partial class Players
{
    /* Under the gate. -1 when every track has played (and the queue doesn't go round). */
    private static int ShuffleNext(Player p)
    {
        var cur = p.Index >= 0 && p.Index < p.Queue.Count ? p.Queue[p.Index] : null;
        if (p.Successor is { } s && ReferenceEquals(s.After, cur) && !p.Played.Contains(s.Next))
        {
            var at = p.Queue.IndexOf(s.Next);
            if (at >= 0 && at != p.Index) return at;
        }
        var cands = Unplayed(p);
        if (cands.Count == 0 && p.Loop == "loop" && p.Queue.Count > 1)
        {
            // Round again: everything but the track playing is to come.
            p.Played = cur != null ? [cur] : [];
            cands = Unplayed(p);
        }
        var n = cands.Count > 0 ? cands[(int)Math.Floor(Random.Shared.NextDouble() * cands.Count)] : -1;
        p.Successor = n >= 0 && cur != null ? (cur, p.Queue[n]) : null;
        return n;
    }

    private static List<int> Unplayed(Player p) => Enumerable.Range(0, p.Queue.Count).Where(i => i != p.Index && !p.Played.Contains(p.Queue[i])).ToList();
}
