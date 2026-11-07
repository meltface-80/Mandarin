// Players.Keep.cs — what every room is still to play, as the makings it needs (item 337). A play that replaces one
// room's queue stops what was being made for that room's play before (item 246); never what another room plays or has
// queued, whose stream would break mid-track (MadeAsPlayed.Only keeps these).
using Mandarin.Server.Playback;

namespace Mandarin.Server.Renderers;

internal sealed partial class Players
{
    /* The made-as-it-plays keys of every room's tracks but [except]'s, from the one playing on. */
    public List<string> StillWanted(string? except)
    {
        var tracks = new List<(PlayTrack Track, Tags.JsObj Plan)>();
        lock (gate)
            foreach (var p in map.Values)
            {
                if (p.Id == except) continue;
                foreach (var it in p.Queue.Skip(Math.Max(0, p.Index)))
                    if (it.Track != null && it.Plan != null && Jv.T(it.Plan["transcode"])) tracks.Add((it.Track, it.Plan));
            }
        return [.. tracks.Select(x => Transcoder.KeyFor(new ConvTrack(x.Track.Id, x.Track.Path, Hub.TierOrMtime(x.Track)), ConvPlan.Of(x.Plan)))];
    }
}
