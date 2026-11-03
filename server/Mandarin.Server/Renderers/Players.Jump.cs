// Players.Jump.cs — a renderer told one thing at a time, the last track asked for the one it is sent (bug list
// item 264).
//
// Every tap of Next or Back was a jump of its own, each telling the renderer of a track and to play it, all at once:
// Next three times quickly was three SetAVTransportURIs over one another, and a small renderer (a FiiO SR11) that
// fetches the track it is given before it answers stopped answering at all, Play and Pause with it. And what was
// being made as it played (Upsample/MadeAsPlayed.cs) went on being made for the track skipped from, the track
// skipped to waiting its turn behind it, the renderer waiting on that.
//
// Now a jump moves the queue's place at once (so that the next tap goes on from there, and Now playing says it), and
// what the renderer is told waits its turn on the player's [Player.Commands], as Play, Pause, Stop and seeking do:
// a jump that comes to its turn after a later one was asked for is passed over, so that taps in a row are one jump
// to where they end. What was being made for any track but the one jumped to and the one after it stops.
using Mandarin.Server.Playback;

namespace Mandarin.Server.Renderers;

internal sealed partial class Players
{
    /* [f] said to [p]'s renderer once whatever it is being told now has been. */
    private static async Task Serially(Player p, Func<Task> f)
    {
        await p.Commands.WaitAsync();
        try { await f(); }
        finally { p.Commands.Release(); }
    }

    private async Task Jump(Player p, int index, double seconds = 0)
    {
        UpnpItem it;
        int gen;
        List<string> keep;
        lock (gate)
        {
            if (index < 0 || index >= p.Queue.Count) throw new HubError(500, "Nothing to play");
            p.Verifying = null;         // the device asked again what it plays, for the same track played again too
            it = p.Queue[index];
            p.ExpectStop = false;
            p.Next = null;              // SetAVTransportURI clears a renderer's next
            p.Heard = true;             // started by us: a stop now is this track's
            p.Index = index; p.NamedEarly = -1; p.EndedOn = -1;
            p.LoadingSince = Hub.Now();
            p.Jumping++;
            gen = ++p.JumpGen;
            if (p.Shuffle) p.Played.Add(it);
            var after = NextIndex(p);
            keep = [.. new[] { it, after >= 0 ? p.Queue[after] : null }.Select(MadeKey).OfType<string>()];
        }
        var r = RendererOf(p);
        Optimistic(p.Id, st =>
        {
            st.State = "loading"; st.TrackNumber = index + 1; st.QueueLength = p.Queue.Count; st.OnQueue = true;
            st.TrackUri = it.Uri; st.TrackId = it.TrackId; st.Title = it.Title; st.Artist = it.Artist; st.Album = it.Album; st.ArtUri = it.ArtUri;
            st.Duration = it.Duration; st.Position = seconds; st.Sent = it.Sent; st.Unreachable = false; st.Verified = null;
        });
        // Made no longer: what was being made for the track jumped from (or any but this and the next).
        if (keep.Count > 0) Upsample.MadeAsPlayed.Only(keep, "skipped from");
        await p.Commands.WaitAsync();
        try
        {
            // A later jump asked for while this one waited: it is the one told.
            lock (gate) if (gen != p.JumpGen) return;
            await r.SetUri(it.Uri, it.Meta);
            await r.Play();
            if (seconds > 0) { try { await r.SeekTime(seconds); } catch (RendererError) { /* from the start */ } }
        }
        finally
        {
            p.Commands.Release();
            lock (gate) { p.Jumping--; p.JumpedAt = Hub.Now(); }
        }
    }

    // The cache's name of [it]'s file where it is made as it plays (Upsample/MadeAsPlayed.cs); else null.
    private static string? MadeKey(UpnpItem? it)
    {
        if (it?.Plan == null || it.Track == null || !Jv.T(it.Plan["transcode"])) return null;
        var plan = ConvPlan.Of(it.Plan);
        return Upsample.MadeAsPlayed.Takes(plan) ? Transcoder.KeyFor(new ConvTrack(it.Track.Id, it.Track.Path, Hub.TierOrMtime(it.Track)), plan) : null;
    }
}
