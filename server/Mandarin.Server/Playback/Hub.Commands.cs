// Hub.Commands.cs — what is done to a zone (zones.js's writing half): each
// id handed to its kind. A phone's commands are its own (Phones.cs); a
// renderer's come in part 3; a Sonos room's in part 2. Until a kind is here,
// its ids get the hub's own refusal, as a room that isn't there gets it.
using System.Text.Json.Nodes;

namespace Mandarin.Server.Playback;

internal sealed partial class Hub
{
    private static HubError NoRoom() => new(500, "That room isn't available");

    /*
     * Put tracks on a zone. how: "play_now" (replace the queue and play),
     * "add_next" (after the current track), "queue" (at the end; starts
     * playback if idle). startAt: 0-based index into items to start from.
     */
    public Task<JsonObject> Enqueue(string zoneId, List<PlayItem> items, string how, double startAt = 0, double seconds = 0)
    {
        if (Phones.IsPhoneId(zoneId)) return Task.FromResult(Phones.Enqueue(zoneId, items, how, startAt, seconds));
        if (IsUpnp(zoneId)) return UpnpEnqueue(zoneId, items, how, startAt, seconds);
        return SonosEnqueue(zoneId, items, how, startAt, seconds);
    }

    public Task Control(string zoneId, string command)
    {
        // A room playing Spotify's live stream (item 142): its controls are Spotify's (SpotifyLive.cs).
        if (Spotify.SpotifyLive.Intercepts(this, zoneId, command)) return Task.CompletedTask;
        return ControlDevice(zoneId, command);
    }

    /* The command to the room's device itself, whatever it plays (SpotifyLive follows Spotify with it). */
    public Task ControlDevice(string zoneId, string command)
    {
        if (Phones.IsPhoneId(zoneId)) { Phones.Control(zoneId, command); return Task.CompletedTask; }
        if (IsUpnp(zoneId)) return UpnpControl(zoneId, command);
        return SonosControl(zoneId, command);
    }

    public Task Seek(string zoneId, string how, double seconds)
    {
        if (how == "absolute" && Spotify.SpotifyLive.Intercepts(this, zoneId, "seek", seconds)) return Task.CompletedTask;
        if (Phones.IsPhoneId(zoneId)) { Phones.Seek(zoneId, how, seconds); return Task.CompletedTask; }
        if (IsUpnp(zoneId)) return UpnpSeek(zoneId, how, seconds);
        return SonosSeek(zoneId, how, seconds);
    }

    public Task PlayFromHere(string zoneId, double position)
    {
        if (Phones.IsPhoneId(zoneId)) { Phones.PlayFromHere(zoneId, position); return Task.CompletedTask; }
        if (IsUpnp(zoneId)) return UpnpPlayFromHere(zoneId, position);
        return SonosPlayFromHere(zoneId, position);
    }

    public Task RemoveFromQueue(string zoneId, double position)
    {
        if (Phones.IsPhoneId(zoneId)) { Phones.RemoveFromQueue(zoneId, position); return Task.CompletedTask; }
        if (IsUpnp(zoneId)) return UpnpRemoveFromQueue(zoneId, position);
        return SonosRemoveFromQueue(zoneId, position);
    }

    /* Picks moved to just after the track playing, in the order they were picked. Returns the plan. */
    public Task<QueueMoves.Plan> MoveAfterCurrent(string zoneId, List<double> positions)
    {
        if (Phones.IsPhoneId(zoneId)) return Task.FromResult(Phones.MoveAfterCurrent(zoneId, positions));
        if (IsUpnp(zoneId)) return UpnpMoveAfterCurrent(zoneId, positions);
        return SonosMoveAfterCurrent(zoneId, positions);
    }

    public Task ClearQueue(string zoneId)
    {
        if (Phones.IsPhoneId(zoneId)) { Phones.ClearQueue(zoneId); return Task.CompletedTask; }
        if (IsUpnp(zoneId)) return UpnpClearQueue(zoneId);
        return SonosClearQueue(zoneId);
    }

    public Task SetSettings(string zoneId, bool? shuffle, string? loop)
    {
        if (Phones.IsPhoneId(zoneId)) { Phones.SetSettings(zoneId, shuffle, loop); return Task.CompletedTask; }
        if (IsUpnp(zoneId)) return UpnpSetSettings(zoneId, shuffle, loop);
        return SonosSetSettings(zoneId, shuffle, loop);
    }

    public Task SetVolume(string outputId, string how, double value)
    {
        if (Phones.IsPhoneId(outputId)) { Phones.SetVolume(outputId, how, value); return Task.CompletedTask; }
        if (IsUpnp(outputId)) return UpnpSetVolume(outputId, how, value);
        return SonosSetVolume(outputId, how, value);
    }

    public Task SetMute(string outputId, bool muted)
    {
        if (Phones.IsPhoneId(outputId)) { Phones.SetMute(outputId, muted); return Task.CompletedTask; }
        if (IsUpnp(outputId)) return UpnpSetMute(outputId, muted);
        return SonosSetMute(outputId, muted);
    }

    public async Task PauseAll()
    {
        Phones.PauseAll();
        await UpnpPauseAll();
        await SonosPauseAll();
        Bump();
    }

    /* The first output becomes (or stays) the coordinator; the rest join it. */
    public Task Group(List<string> outputIds)
    {
        if (outputIds.Any(Phones.IsPhoneId)) throw new HubError(500, "A phone plays on its own — it can't be grouped with Sonos rooms");
        if (outputIds.Any(IsUpnp)) throw new HubError(500, "A streamer plays on its own — it can't be grouped with Sonos rooms");
        return SonosGroup(outputIds);
    }

    public Task Ungroup(List<string> outputIds) => SonosUngroup(outputIds.Where(id => !Phones.IsPhoneId(id) && !IsUpnp(id)).ToList());

    /*
     * Move what is playing to another room: copy the queue, pick up at the same
     * track and second, then stop the old room.
     */
    public async Task Transfer(string fromZone, string toZone)
    {
        // To or from a renderer: the queue is rebuilt from the library for the
        // player it is going to, since each kind is handed its own best stream.
        if (IsUpnp(fromZone) || IsUpnp(toZone))
        {
            if (fromZone == toZone) return;
            List<long> ids;
            ZoneState st;
            if (IsUpnp(fromZone)) { ids = UpnpTrackIds(fromZone); st = StateOf(fromZone) ?? new ZoneState(); }
            else if (Phones.IsPhoneId(fromZone)) { ids = Phones.ItemsFor(fromZone).Select(it => it.Phone!.TrackId ?? 0).ToList(); st = StateOf(fromZone) ?? new ZoneState(); }
            else (ids, st) = await SonosTrackIds(fromZone);
            var items = await RebuildItems(ids.Where(id => id > 0).ToList(), toZone);
            if (items.Count == 0) throw new HubError(500, "Nothing queued there is from the library");
            var startAt = Math.Min(items.Count - 1, Math.Max(0, (st.TrackNumber > 0 ? st.TrackNumber : 1) - 1));
            await Enqueue(toZone, items, "play_now", startAt, PositionNow(st));
            try { await Control(fromZone, "stop"); } catch (HubError) { /* already */ }
            return;
        }
        // To or from a phone: the same idea, with the phone's queue on one side.
        if (Phones.IsPhoneId(fromZone) || Phones.IsPhoneId(toZone))
        {
            if (fromZone == toZone) return;
            List<PlayItem> items;
            ZoneState st;
            if (Phones.IsPhoneId(fromZone)) { items = Phones.ItemsFor(fromZone); st = StateOf(fromZone) ?? new ZoneState(); }
            else (items, st) = await SonosItems(fromZone);
            if (items.Count == 0) throw new HubError(500, "Nothing is queued there");
            var startAt = Math.Max(0, (st.TrackNumber > 0 ? st.TrackNumber : 1) - 1);
            await Enqueue(toZone, items, "play_now", startAt, PositionNow(st));
            try { await Control(fromZone, "stop"); } catch (HubError) { /* already */ }
            return;
        }
        await SonosTransfer(fromZone, toZone);
    }
}
