// Players.Dsd.cs — a track made DSD from PCM (bug list item 243): which of its two entries the renderer is sent.
//
// A queue entry of a track a device is set to have made DSD carries two: the DSF's and, beside it, the PCM's
// (Playback/Items.cs). The DSF goes where it is made. A track started before its DSF is made goes as PCM, and its
// making is dropped from the queue of makings, so that the tracks after it, still to come, are made first. The next
// track is armed as DSF once made (Ready) and waited for; with the track playing in its last [Late], it goes as PCM,
// its conversion begun [Lead] before the end so that it is whole by then (item 246: a ×16 WAV takes its time).
using Mandarin.Server.Playback;

namespace Mandarin.Server.Renderers;

internal sealed partial class Players
{
    /* How near its end (s) the track playing is when the next, not yet made DSD, is armed as PCM instead; the tests' own, if said. */
    private static readonly double Late =
        double.TryParse(Environment.GetEnvironmentVariable("MANDARIN_DSD_LATE_S"), System.Globalization.CultureInfo.InvariantCulture, out var s) && s >= 0 ? s : 30;

    /* How near its end the track playing is when the PCM that may stand in for the next is begun. */
    private static double Lead => Late * 5;

    // [it] and the entry beside it, the two paired: each the other's Instead (ToItem).
    private UpnpItem Paired(PlayItem? instead, UpnpItem it)
    {
        if (instead == null) return it;
        var other = ToItem(instead);
        it.Instead = other; other.Instead = it;
        return it;
    }

    // The DSF's entry of the two, and whether it is made.
    private static (UpnpItem Dsd, UpnpItem Pcm, bool Made) Pair(UpnpItem it)
    {
        var dsd = it.Plan != null && Jv.T(it.Plan["dsdUp"]) ? it : it.Instead!;
        var pcm = ReferenceEquals(dsd, it) ? it.Instead! : it;
        if (dsd.Track == null || dsd.Plan == null) return (dsd, pcm, false);
        var t = new ConvTrack(dsd.Track.Id, dsd.Track.Path, Hub.TierOrMtime(dsd.Track));
        return (dsd, pcm, File.Exists(Transcoder.FinalPath(Transcoder.KeyFor(t, ConvPlan.Of(dsd.Plan)))));
    }

    /* Under the gate: the entry to start at [index], the DSF where it is made, else the PCM (and its making put back). */
    private static UpnpItem Starting(Player p, int index)
    {
        var it = p.Queue[index];
        if (it.Instead == null) return it;
        var (dsd, pcm, made) = Pair(it);
        if (!made && dsd.Track != null && dsd.Plan != null)
            Upsample.WholeJobs.Skip(new ConvTrack(dsd.Track.Id, dsd.Track.Path, Hub.TierOrMtime(dsd.Track)), ConvPlan.Of(dsd.Plan));
        return Put(p, index, made ? dsd : pcm);
    }

    /* The entry to arm next at [n]: the DSF where it is made, or while there is time to wait for it; else the PCM. */
    private UpnpItem Arming(Player p, int n, UpnpItem it)
    {
        if (it.Instead == null) return it;
        var (dsd, pcm, made) = Pair(it);
        double left;
        lock (zm.Gate) left = zm.State.TryGetValue(p.Id, out var st) && st.Duration > 0 ? st.Duration - st.Position : double.MaxValue;
        if (!made && left <= Lead) _ = Ready(pcm);   // begun, so it is there should the DSF not be
        lock (gate) return n < p.Queue.Count && ReferenceEquals(p.Queue[n], it) ? Put(p, n, made || left > Late ? dsd : pcm) : it;
    }

    // [it] at [index] in the queue, in place of the other of its pair (and in shuffle's memory of it).
    private static UpnpItem Put(Player p, int index, UpnpItem it)
    {
        var was = p.Queue[index];
        if (ReferenceEquals(was, it)) return it;
        p.Queue[index] = it;
        if (p.Played.Remove(was)) p.Played.Add(it);
        if (p.Successor is { } s) p.Successor = (ReferenceEquals(s.After, was) ? it : s.After, ReferenceEquals(s.Next, was) ? it : s.Next);
        return it;
    }
}
