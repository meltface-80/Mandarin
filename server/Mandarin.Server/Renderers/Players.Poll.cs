// Players.Poll.cs — a renderer read (players.js's polling half, v0.8.49,
// stage 6 part 3): GetTransportInfo + GetPositionInfo every second while
// someone is looking or it is playing, every few seconds otherwise; its
// events (GENA) when it gives them, so a playing one that is evented is read
// only for its position; the track it is on found by its URI; a device that
// stopped at the end of a track with a next one waiting started by hand.
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Renderers;

internal sealed partial class Players
{
    // ------------------------------------------------------------ events

    public string? EventsOf(string id) { lock (gate) return subs.TryGetValue(id, out var s) && s.Expires > Hub.Now() ? "live" : null; }

    /* Subscribed to the renderer's AVTransport events, renewed in time. */
    private async Task EnsureSubscribed(Player p, DeviceRecord rec)
    {
        if (stopped) return;
        var url = rec.Caps["events"] is JsObj ev && Jv.T(ev["AVTransport"]) ? Jv.Str(ev["AVTransport"]) : "";
        if (url.Length == 0) return;
        (string Url, string Sid, double Expires, double FailedAt) s;
        bool had;
        lock (gate)
        {
            had = subs.TryGetValue(p.Id, out s);
            if (had && s.Url == url && s.Expires - Hub.Now() > 5 * 60 * 1000) return;
            if (p.Subscribing) return;
            p.Subscribing = true;
        }
        try
        {
            var cb = $"{zm.BaseUrl}/upnp/event/{Uri.EscapeDataString(p.Id)}";
            GenaClient.Subscription next;
            if (had && s.Url == url && s.Expires > Hub.Now())
            {
                try { next = await GenaClient.Renew(url, s.Sid); }
                catch (Exception e) when (e is RendererError or HttpRequestException or OperationCanceledException) { next = await GenaClient.Subscribe(url, cb); }
            }
            else next = await GenaClient.Subscribe(url, cb);
            lock (gate) subs[p.Id] = (url, next.Sid, next.Expires, 0);
            if (!had) Log($"[renderers] {rec.Name ?? rec.NetworkName}: events on ({next.Sid})");
        }
        catch (Exception e) when (e is RendererError or HttpRequestException or OperationCanceledException or UriFormatException)
        {
            // No events from this one: it is polled, and asked again in a while.
            lock (gate) subs[p.Id] = (url, "", 0, Hub.Now());
        }
        finally { lock (gate) p.Subscribing = false; }
    }

    /* A NOTIFY from the renderer: something changed — read it now. */
    public void OnNotify(string id, JsObj vars)
    {
        Player? p;
        lock (gate)
        {
            if (!map.TryGetValue(id, out p)) return;
            p.LastEvent = (Hub.Now(), vars);
            if (p.NotifyTimer != null) return;
            p.NotifyTimer = new Timer(_ =>
            {
                lock (gate) { p.NotifyTimer?.Dispose(); p.NotifyTimer = null; }
                _ = Poll(p, false).ContinueWith(_ => { }, TaskContinuationOptions.OnlyOnFaulted);
            }, null, 150, Timeout.Infinite);
        }
    }

    // ------------------------------------------------------------ polling

    /* Each renderer read on its own (item 184): the loop waits for none, so one that doesn't answer holds up no other room. */
    public Task PollAll(int tick)
    {
        List<Player> players;
        lock (gate) players = map.Values.ToList();
        foreach (var p in players) _ = PollTick(p, tick).ContinueWith(t => Log($"[renderers] {p.Id}: {t.Exception?.InnerException?.Message}"), TaskContinuationOptions.OnlyOnFaulted);
        return Task.CompletedTask;
    }

    private async Task PollTick(Player p, int tick)
    {
        var r = Record(p.Id);
        if (r == null || !Devices.Online(r)) return;
        bool watched, playing, evented, retry;
        lock (zm.Gate)
        {
            watched = Hub.Now() - zm.Hot.GetValueOrDefault(p.Id) < HotMs;
            playing = zm.State.TryGetValue(p.Id, out var st) && st.State is "playing" or "loading";
        }
        lock (gate)
        {
            evented = subs.TryGetValue(p.Id, out var sub) && sub.Expires > Hub.Now();
            retry = !(subs.TryGetValue(p.Id, out var s2) && s2.FailedAt > 0 && Hub.Now() - s2.FailedAt < 10 * 60 * 1000);
        }
        if (retry) _ = EnsureSubscribed(p, r).ContinueWith(_ => { }, TaskContinuationOptions.OnlyOnFaulted);
        // Evented and unwatched: the device says when things change, so a playing one is only read every few seconds, for its position.
        if (!watched && (!playing || evented) && tick % 5 != 0) return;
        // Still being read from the last time: not asked again until it answers.
        try { await Poll(p, watched || tick % 5 == 0, again: false); }
        catch (Exception e) when (e is RendererError or HubError or UPnPError or SqliteException) { Log($"[renderers] {p.Id}: {e.Message}"); }
    }

    /*
     * One read of a renderer at a time (item 184): two at once, at the end of a
     * track, each started the next track — one skipped. A read asked for while
     * one is under way (an event, a command's read-back) is made once that one
     * has answered, so it sees what came after; the loop's is simply skipped.
     */
    private async Task Poll(Player p, bool withVolume, bool again = true)
    {
        lock (gate)
        {
            if (p.Polling) { if (again) { p.PollAgain = true; p.PollAgainVolume |= withVolume; } return; }
            p.Polling = true;
        }
        var done = false;
        try
        {
            while (!done)
            {
                await PollOnce(p, withVolume);
                lock (gate)
                {
                    done = !p.PollAgain;
                    withVolume = p.PollAgainVolume;
                    p.PollAgain = p.PollAgainVolume = false;
                    if (done) p.Polling = false;
                }
            }
        }
        finally { if (!done) lock (gate) { p.Polling = false; p.PollAgain = p.PollAgainVolume = false; } }
    }

    private async Task PollOnce(Player p, bool withVolume)
    {
        var r = RendererOf(p);
        var rec = Record(p.Id);
        ZoneState prev;
        lock (zm.Gate) prev = zm.State.GetValueOrDefault(p.Id) ?? ZoneState.Blank(new Volume(p.Volume.Value, p.Volume.Muted));
        JsObj ti, pi;
        var asked = Hub.Now();
        try
        {
            var t = r.GetTransportInfo(); var q = r.GetPositionInfo();
            await Task.WhenAll(t, q);
            (ti, pi) = (t.Result, q.Result);
        }
        catch (RendererError)
        {
            lock (gate) p.Heard = false;
            var bump = false;
            lock (zm.Gate) { if (!prev.Unreachable) { prev.Unreachable = true; zm.State[p.Id] = prev; bump = true; } }
            if (bump) zm.Bump();
            return;
        }
        // A sound device on this computer says what went wrong itself.
        if (r.TakeError() is { } failed) { Fail(p, failed.Message); return; }
        if (withVolume && !FixedVolume(rec))
        {
            try { var v = r.GetVolume(); var m = r.GetMute(); await Task.WhenAll(v, m); lock (gate) p.Volume = (v.Result, m.Result); }
            catch (RendererError) { /* the last reading stands */ }
        }
        // Answering is being on the network: the register's last_seen follows, so a playing device never reads "offline".
        if (rec != null && rec.Kind != "local" && Hub.Now() - p.TouchedAt > 30000)
        {
            p.TouchedAt = Hub.Now();
            using var c = Db.Open();
            Register.Touch(c, p.Id);
        }
        var tstate = States.GetValueOrDefault(Str(ti["CurrentTransportState"]), "stopped");
        var uri = Str(pi["TrackURI"]);
        UpnpItem? item;
        int index;
        bool heard, stale;
        lock (gate)
        {
            var idx = uri.Length > 0 ? IndexOfUri(p, uri) : -1;
            // The renderer moved on by itself: SetNextAVTransportURI honoured. Not an answer from before a jump of ours
            // was done (item 150): a slow one still names the track jumped from, and took the queue back to it.
            if (idx >= 0 && idx != p.Index && p.Jumping == 0 && asked > p.JumpedAt) { p.Index = idx; p.Next = null; p.Strikes = 0; if (p.Shuffle) p.Played.Add(idx); }
            item = p.Index >= 0 && p.Index < p.Queue.Count ? p.Queue[p.Index] : null;
            index = p.Index;
            heard = p.Heard;
            // Asked before a jump of ours was done: what it says of the transport is from before it too.
            stale = p.Jumping > 0 || asked <= p.JumpedAt;
        }
        // A stop from before a jump is the track jumped from stopping: the jump's own state stands until the next read.
        if (tstate == "stopped" && stale) return;
        // Stopped at the end of a track with more to play: the renderer does not take a next URI — start it by hand.
        // A device still starting a track may say STOPPED for a moment while it buffers; that is given eight seconds.
        // One that stops before ever playing three times running is not taking what it is sent; that is reported rather than looped.
        // Only after the device was heard playing (item 184): back from an outage, or after a restart, the room's "playing" is
        // from before, and a stop then is the device's own, not the end of a track — nothing starts by itself.
        if (tstate == "stopped" && !p.ExpectStop && item != null && prev.State is "playing" or "loading" && heard)
        {
            if (prev.State == "loading" && Hub.Now() - p.LoadingSince < 8000) return;
            p.Strikes = prev.State == "loading" ? p.Strikes + 1 : 0;
            int n;
            lock (gate) n = NextIndex(p);
            if (p.Strikes >= 3) Fail(p, $"{r.Name} stops as soon as each track starts — it may not take what it is sent");
            else if (n >= 0)
            {
                if (p.Next is { Sent: true } && !p.NoSetNext) { p.NoSetNext = true; Log($"[renderers] {r.Name}: ignored SetNextAVTransportURI; tracks are started by hand"); }
                _ = Jump(p, n).ContinueWith(t => Fail(p, t.Exception?.InnerException?.Message ?? "failed"), TaskContinuationOptions.OnlyOnFaulted);
                return;
            }
        }
        lock (gate) p.Heard = true;
        if (tstate == "stopped") p.ExpectStop = false;
        if (tstate == "playing") { p.Strikes = 0; p.LastError = null; }
        var next = ZoneState.Blank(new Volume(p.Volume.Value, p.Volume.Muted));
        next.State = tstate;
        next.TrackUri = item?.Uri ?? uri;
        next.TrackId = item != null ? item.TrackId : Phones.TrackIdFromUri(uri);
        next.TrackNumber = item != null ? index + 1 : 0;
        lock (gate) { next.QueueLength = p.Queue.Count; next.OnQueue = p.Queue.Count > 0; next.Shuffle = p.Shuffle; next.Loop = p.Loop; }
        next.Position = Didl.ToSeconds(pi["RelTime"]);
        var dur = Didl.ToSeconds(pi["TrackDuration"]);
        next.Duration = dur != 0 ? dur : item?.Duration ?? 0;
        next.Title = item?.Title ?? ""; next.Artist = item?.Artist ?? ""; next.Album = item?.Album ?? ""; next.ArtUri = item?.ArtUri ?? "";
        next.MediaUri = uri;
        next.Sent = item?.Sent;
        next.At = Hub.Now(); next.Unreachable = false;
        zm.ApplyState(p.Id, prev, next);
        if (tstate == "playing" && item != null && !p.NoSetNext) _ = ArmNext(p).ContinueWith(_ => { }, TaskContinuationOptions.OnlyOnFaulted);
        if (tstate == "playing" && item != null) _ = Verify(p, item).ContinueWith(_ => { }, TaskContinuationOptions.OnlyOnFaulted);
    }

    private static string Str(object? v) => Jv.T(v) ? Jv.Str(v) : "";

    private static int IndexOfUri(Player p, string uri)
    {
        var from = Math.Max(0, p.Index);
        int Scan(Func<UpnpItem, bool> test)
        {
            for (var i = from; i < p.Queue.Count; i++) if (test(p.Queue[i])) return i;
            for (var i = 0; i < from; i++) if (test(p.Queue[i])) return i;
            return -1;
        }
        var exact = Scan(it => it.Uri == uri);
        if (exact >= 0) return exact;
        // Re-encoded by the device: the track id still says which.
        var id = Phones.TrackIdFromUri(uri);
        return id != null ? Scan(it => it.TrackId == id) : -1;
    }

    private static int NextIndex(Player p)
    {
        if (p.Queue.Count == 0) return -1;
        if (p.Loop == "loop_one") return p.Index;
        if (p.Shuffle)
        {
            var cands = Enumerable.Range(0, p.Queue.Count).Where(i => i != p.Index && !p.Played.Contains(i)).ToList();
            if (cands.Count == 0 && p.Loop == "loop" && p.Queue.Count > 1) { p.Played = [p.Index]; cands = Enumerable.Range(0, p.Queue.Count).Where(i => i != p.Index).ToList(); }
            return cands.Count > 0 ? cands[(int)Math.Floor(Random.Shared.NextDouble() * cands.Count)] : -1;
        }
        var n = p.Index + 1;
        if (n < p.Queue.Count) return n;
        return p.Loop == "loop" ? 0 : -1;
    }
}
