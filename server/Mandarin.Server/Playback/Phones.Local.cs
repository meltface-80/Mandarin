// Phones.Local.cs — the phone playing a list of its own (item 186): its
// downloads, or its own music, held by the app's player (st.Local, p.Local).
// The page shows that list as the queue, so what it does to the queue is done
// to that list, never to the server's queue for the phone behind it. The app
// takes only an album added to its own list (an insert marked local): a
// removal or a move it drops, and a track of the phone's own music the server
// can't hand back, so those are refused in words. Moving what plays to
// another room sends that list, when every track in it is the library's.
namespace Mandarin.Server.Playback;

internal sealed partial class Phones
{
    /* The list the phone is playing when it is its own; null when it plays the queue here. Under the gate. */
    private List<PhoneItem>? OwnList(PhoneRec p) => zm.State.GetValueOrDefault(p.Uid) is { Local: true } && p.Local is { Count: > 0 } l ? l : null;

    private static HubError OwnListRefused() => new(409, "This phone is playing a list of its own (its downloads or its music): change it on the phone");

    /* Refused while the phone plays its own list: what is done to the queue would be done to the one behind it. Under the gate. */
    private void NotOwnList(PhoneRec p) { if (OwnList(p) != null) throw OwnListRefused(); }

    /* The library's ids of what the phone is playing, in order (0 for a track that isn't the library's), for a move to another room. */
    public List<long> TrackIdsFor(string uid)
    {
        var p = Get(uid);
        lock (zm.Gate)
        {
            if (OwnList(p) is not { } own) return p.Queue.Select(it => it.TrackId ?? 0).ToList();
            if (own.Any(it => it.TrackId is null or 0)) throw new HubError(409, "This phone is playing music of its own that isn't in the library: it can't be moved to another room");
            return own.Select(it => it.TrackId!.Value).ToList();
        }
    }

    /* The queue as Sonos-style items, for moving what's playing elsewhere: the phone's own list made again for [toZone] from the library. */
    public async Task<List<PlayItem>> ItemsFor(string uid, string toZone)
    {
        var p = Get(uid);
        lock (zm.Gate)
        {
            if (OwnList(p) == null) return QueueItems(p);
        }
        return await zm.RebuildItems(TrackIdsFor(uid), toZone);
    }
}
