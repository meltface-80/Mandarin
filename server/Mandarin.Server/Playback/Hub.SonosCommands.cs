// Hub.SonosCommands.cs — what is done to a Sonos group (zones.js's writing
// half, v0.8.49, stage 6 part 2), in the exact order the Node server did it:
// enqueue (clear, the first track alone so the speaker can begin while the
// rest load, SetAVTransportURI, seek, play, the rest; a queue with music in it
// isn't cleared and one that isn't playing isn't started, v0.8.34), sixteen
// tracks a round trip (one at a time on older firmware), each command read
// back promptly (pokeAfter) so the page sees the result without waiting for
// the next poll.
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

internal sealed partial class Hub
{
    private ZoneState StateOr(string uid) { lock (Gate) return State.GetValueOrDefault(uid) ?? new ZoneState(); }

    /* Read the speaker back promptly, so the page sees the result of a command without waiting for the next poll. */
    private async Task PokeAfter(string zoneId)
    {
        var g = SonosGroupOf(zoneId);
        if (g == null) return;
        await Task.Delay(250);
        try { await PollGroup(g.Value); } catch (UPnPError) { /* the next poll */ }
    }
    private void Poke(string zoneId) => _ = PokeAfter(zoneId).ContinueWith(_ => { }, TaskContinuationOptions.OnlyOnFaulted);

    private async Task<JsonObject> SonosEnqueue(string zoneId, List<PlayItem> items, string how, double startAt, double seconds)
    {
        var c = Coordinator(zoneId) ?? throw NoRoom();
        if (items.Count == 0) throw new HubError(500, "Nothing to play");
        items = items.Take(QueueMax).ToList();
        // Where the speaker is NOW, not at the last poll: "play next" straight after "play now" must count from the track that has just started.
        var g = SonosGroupOf(c.Uid);
        if (how != "play_now" && g != null) { try { await PollGroup(g.Value); } catch (UPnPError) { /* as last read */ } }
        var st = StateOr(c.Uid);
        if (how == "play_now")
        {
            await c.ClearQueue();
            var first = (int)Math.Max(0, Math.Min(items.Count - 1, startAt));
            await AddBatch(c, items.Take(first + 1).ToList(), 0);
            await c.SetAVTransportURI(c.QueueUri());
            await c.SeekTrack(first + 1);
            if (seconds > 0) { try { await c.SeekTime(seconds); } catch (UPnPError) { /* from the start */ } }
            await c.Play();
            if (items.Count > first + 1) await AddBatch(c, items.Skip(first + 1).ToList(), 0);
        }
        else
        {
            var playing = st.State == "playing";
            double held;
            if (st.OnQueue) held = st.QueueLength;
            else { try { held = (await c.BrowseQueue(0, 1)).Total; } catch (UPnPError) { held = 0; } }
            if (!playing && held > 0)
            {
                await AddBatch(c, items, how == "add_next" && st.OnQueue && st.TrackNumber != 0 ? st.TrackNumber + 1 : 0);
            }
            else if (how == "add_next")
            {
                var at = st.OnQueue && st.TrackNumber != 0 ? st.TrackNumber + 1 : 0;
                await AddBatch(c, items, at);
                if (!st.OnQueue || st.State == "stopped")
                {
                    if (!st.OnQueue) await c.SetAVTransportURI(c.QueueUri());
                    if (!playing)
                    {
                        try { await c.SeekTrack(at != 0 ? at : 1); } catch (UPnPError) { /* where it is */ }
                        await c.Play();
                    }
                }
            }
            else
            {
                var before = held;
                await AddBatch(c, items, 0);
                if (!st.OnQueue || st.State == "stopped")
                {
                    await c.SetAVTransportURI(c.QueueUri());
                    try { await c.SeekTrack(before + 1); } catch (UPnPError) { /* where it is */ }
                    await c.Play();
                }
            }
        }
        Poke(c.Uid);
        return new JsonObject { ["queued"] = items.Count };
    }

    private static async Task AddBatch(SonosDevice c, List<PlayItem> items, double position)
    {
        var at = position;
        for (var i = 0; i < items.Count; i += Batch)
        {
            var chunk = items.Skip(i).Take(Batch).ToList();
            try { await c.AddMultipleToQueue(chunk, at, false); }
            catch (UPnPError)
            {
                // Older firmware without the batch verb: one at a time.
                for (var j = 0; j < chunk.Count; j++) await c.AddToQueue(chunk[j].Uri, chunk[j].Meta, at != 0 ? at + j : 0, false);
            }
            if (at != 0) at += chunk.Count;
        }
    }

    /*
     * A Sonos room's settings changed (Volume Levelling): the queue it holds is
     * planned again — new addresses, the gain in them — and it carries on from
     * the same track and second; paused, it stays paused. A queue holding
     * anything that isn't from the library is left as it is.
     */
    public async Task<bool> ReplanSonos(string id)
    {
        var g = SonosGroupOf(id);
        if (g == null || g.Value.Coordinator.Uid != id) return false;
        var c = Coordinator(id)!;
        try { await PollGroup(g.Value); } catch (UPnPError) { /* as last read */ }
        var st = StateOr(c.Uid);
        if (!st.OnQueue || st.QueueLength == 0) return false;
        var q = await c.BrowseQueue(0, QueueMax);
        var ids = q.Items.Select(it => Phones.TrackIdFromUri(Str(it["uri"]))).ToList();
        if (ids.Count == 0 || ids.Any(x => x == null)) return false;
        var items = await RebuildItems(ids.Select(x => x!.Value).ToList(), c.Uid);
        if (items.Count != ids.Count) return false;
        static string Unsigned(string u) => u.Split("&s=")[0].Split("?s=")[0];
        if (items.Select((it, i) => Unsigned(it.Uri) == Unsigned(Str(q.Items[i]["uri"]))).All(x => x)) return false;
        var index = Math.Max(0, Math.Min(items.Count - 1, (st.TrackNumber != 0 ? st.TrackNumber : 1) - 1));
        var seconds = PositionNow(st);
        if (st.State is "playing" or "loading") await SonosEnqueue(c.Uid, items, "play_now", index, seconds);
        else
        {
            await c.ClearQueue();
            await AddBatch(c, items, 0);
            await c.SetAVTransportURI(c.QueueUri());
            try { await c.SeekTrack(index + 1); } catch (UPnPError) { /* where it is */ }
            if (seconds > 0) { try { await c.SeekTime(seconds); } catch (UPnPError) { /* from the start */ } }
            Poke(c.Uid);
        }
        return true;
    }

    private async Task SonosControl(string zoneId, string command)
    {
        var c = Coordinator(zoneId) ?? throw NoRoom();
        var st = StateOr(c.Uid);
        switch (command)
        {
            case "play": await c.Play(); break;
            case "pause": await c.Pause(); break;
            case "stop": await c.Stop(); break;
            case "next": await c.Next(); break;
            case "previous":
                // Back to the start of this track first, as every player does.
                if (PositionNow(st) > 5) await c.SeekTime(0); else await c.Previous();
                break;
            case "playpause":
                if (st.State is "playing" or "loading") await c.Pause(); else await c.Play();
                break;
            default: throw new HubError(500, "unknown command " + command);
        }
        Poke(c.Uid);
    }

    private async Task SonosSeek(string zoneId, string how, double seconds)
    {
        var c = Coordinator(zoneId) ?? throw NoRoom();
        var st = StateOr(c.Uid);
        var target = how == "relative" ? PositionNow(st) + seconds : seconds;
        await c.SeekTime(Math.Max(0, target));
        lock (Gate) { st.Position = Math.Max(0, target); st.At = Now(); }
        Bump();
        Poke(c.Uid);
    }

    private async Task SonosPlayFromHere(string zoneId, double position)
    {
        var c = Coordinator(zoneId) ?? throw NoRoom();
        var st = StateOr(c.Uid);
        if (!st.OnQueue) await c.SetAVTransportURI(c.QueueUri());
        await c.SeekTrack(position);
        await c.Play();
        // Read back before answering (v0.8.35): the Queue screen asks for the queue as soon as this answers.
        await PokeAfter(c.Uid);
    }

    private async Task SonosRemoveFromQueue(string zoneId, double position)
    {
        var c = Coordinator(zoneId) ?? throw NoRoom();
        await c.RemoveTrackFromQueue(position);
        Poke(c.Uid);
    }

    private async Task<QueueMoves.Plan> SonosMoveAfterCurrent(string zoneId, List<double> positions)
    {
        var c = Coordinator(zoneId) ?? throw NoRoom();
        var q = await SonosQueue(zoneId);
        var plan = QueueMoves.PlanMoves((double)q.Items.Count, q.Current, positions.Select(p => (object?)p).ToList());
        foreach (var m in plan.Moves) await c.ReorderQueue(m.From, 1, m.InsertBefore);
        Poke(c.Uid);
        return plan;
    }

    private async Task SonosClearQueue(string zoneId)
    {
        var c = Coordinator(zoneId) ?? throw NoRoom();
        await c.ClearQueue();
        Poke(c.Uid);
    }

    private async Task SonosSetSettings(string zoneId, bool? shuffle, string? loop)
    {
        var c = Coordinator(zoneId) ?? throw NoRoom();
        var st = StateOr(c.Uid);
        await c.SetPlayMode(SonosDevice.PlayModeFor(shuffle ?? st.Shuffle, loop ?? st.Loop));
        Poke(c.Uid);
    }

    private async Task SonosSetVolume(string outputId, string how, double value)
    {
        var m = Sonos.Member(outputId) ?? throw NoRoom();
        var d = new SonosDevice(m.Ip, m.Uid, m.Name);
        (double? Value, bool Muted, double At) v;
        lock (Gate) volumes.TryGetValue(m.Uid, out v);
        var target = how is "relative" or "relative_step" ? Math.Max(0, Math.Min(100, (v.Value ?? 0) + value)) : Math.Max(0, Math.Min(100, value));
        await d.SetVolume(target);
        lock (Gate) volumes[m.Uid] = (target, v.Muted, Now());
        Bump();
    }

    private async Task SonosSetMute(string outputId, bool muted)
    {
        var m = Sonos.Member(outputId) ?? throw NoRoom();
        await new SonosDevice(m.Ip, m.Uid, m.Name).SetMute(muted);
        lock (Gate) { volumes.TryGetValue(m.Uid, out var v); volumes[m.Uid] = (v.Value, muted, Now()); }
        Bump();
    }

    private Task SonosPauseAll() => Task.WhenAll(Sonos.Groups().Select(async g =>
    {
        try { await new SonosDevice(g.Coordinator.Ip, g.Coordinator.Uid).Pause(); } catch (UPnPError) { /* not playing, or not there */ }
    }));

    /* The first output becomes (or stays) the coordinator; the rest join it. */
    private async Task SonosGroup(List<string> outputIds)
    {
        var lead = outputIds.FirstOrDefault();
        var leadMember = Sonos.Member(lead) ?? throw NoRoom();
        // A lead that is a member of someone else's group keeps its audio only by staying where it is: its coordinator is the anchor.
        var coord = Sonos.CoordinatorOf(lead) ?? leadMember;
        foreach (var id in outputIds.Skip(1))
        {
            var m = Sonos.Member(id);
            if (m == null || m.Uid == coord.Uid) continue;
            await new SonosDevice(m.Ip, m.Uid, m.Name).JoinGroup(coord.Uid);
        }
        await Task.Delay(500);
        await RefreshTopology();
    }

    private async Task SonosUngroup(List<string> outputIds)
    {
        foreach (var id in outputIds)
        {
            var m = Sonos.Member(id);
            if (m == null) continue;
            try { await new SonosDevice(m.Ip, m.Uid, m.Name).BecomeStandalone(); } catch (UPnPError) { /* already on its own */ }
        }
        await Task.Delay(500);
        await RefreshTopology();
    }

    /* A group's queue as the ids of the library tracks in it, with its state (a transfer to a renderer). */
    private async Task<(List<long>, ZoneState)> SonosTrackIds(string zoneId)
    {
        var from = Coordinator(zoneId) ?? throw NoRoom();
        var st = StateOr(from.Uid);
        var q = await from.BrowseQueue(0, QueueMax);
        return (q.Items.Select(it => Phones.TrackIdFromUri(Str(it["uri"])) ?? 0).ToList(), st);
    }

    /* A group's queue as items, each with the DIDL built again from what the speaker says (a transfer to a phone or another room). */
    private async Task<(List<PlayItem>, ZoneState)> SonosItems(string zoneId)
    {
        var from = Coordinator(zoneId) ?? throw NoRoom();
        var st = StateOr(from.Uid);
        var q = await from.BrowseQueue(0, QueueMax);
        return (q.Items.Select(it =>
        {
            var uri = Str(it["uri"]);
            var meta = Jv.Obj(("title", it["title"]), ("artist", it["artist"]), ("album", it["album"]), ("artUri", it["artUri"]), ("duration", it["duration"]), ("mime", MimeFromUri(uri)));
            return new PlayItem { Uri = uri, Meta = Didl.Build(uri, meta) };
        }).ToList(), st);
    }

    /* Move what is playing from one group to another: copy the queue, pick up at the same track and second, then stop the old room. */
    private async Task SonosTransfer(string fromZone, string toZone)
    {
        var from = Coordinator(fromZone);
        var to = Coordinator(toZone);
        if (from == null || to == null) throw NoRoom();
        if (from.Uid == to.Uid) return;
        var (items, st) = await SonosItems(fromZone);
        if (items.Count == 0) throw new HubError(500, "Nothing is queued in that room");
        var startAt = Math.Max(0, (st.TrackNumber != 0 ? st.TrackNumber : 1) - 1);
        await SonosEnqueue(to.Uid, items, "play_now", startAt, PositionNow(st));
        try { await from.Stop(); } catch (UPnPError) { /* already */ }
        Poke(from.Uid);
    }
}
