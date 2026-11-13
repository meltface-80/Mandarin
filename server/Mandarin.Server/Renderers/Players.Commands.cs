// Players.Commands.cs — what is done to a renderer (players.js's writing half,
// v0.8.49, stage 6 part 3): the next track armed once its file is complete,
// a jump, every command, and what the device says it is really playing.
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

internal sealed partial class Players
{
    /*
     * What the device says it is really playing. A WiiM's own API reports the
     * rate and depth its decoder is running; when they match what was sent,
     * they are marked verified on its page, and the Now playing badge gets
     * its tick. Asked once per track, a few seconds in.
     */
    private async Task Verify(Player p, UpnpItem item)
    {
        var rec = Record(p.Id);
        if (rec != null && rec.Kind == "local") return;   // a sound device on this computer: nothing reads back what it is fed
        if (rec?.Caps["mandarin"] is JsObj mu && Jv.T(mu["base"])) { await VerifyMandarinBridge(p, rec, item, Jv.Str(mu["base"])); return; }
        var lp = rec?.Caps["linkplay"] as JsObj;
        if (lp == null || !Jv.T(lp["base"]) || item.Sent == null || item.Sent.Rate == 0 || item.Sent.Dsd != 0) return;
        var key = p.Index + ":" + item.Uri;
        lock (gate) { if (p.Verifying == key) return; }
        ZoneState? st;
        lock (zm.Gate) st = zm.State.GetValueOrDefault(p.Id);
        if ((st?.Position ?? 0) < 2) return;
        lock (gate) p.Verifying = key;
        JsObj? meta = null;
        try { meta = await LinkPlay.Command(Jv.Str(lp["base"]), "getMetaInfo"); }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or UriFormatException) { meta = null; if (e is not UriFormatException) Unanswered(p); }
        var m = meta?["metaData"] as JsObj;
        if (m == null) return;
        var rate = Tags.Js.ToNumber(m["sampleRate"]) is var rt && !double.IsNaN(rt) ? rt : 0;
        var bits = Tags.Js.ToNumber(m["bitDepth"]) is var bt && !double.IsNaN(bt) ? bt : 0;
        var ok = rate == item.Sent.Rate && (bits == 0 || item.Sent.Bits == 0 || bits == item.Sent.Bits);
        // Kept before the badge's tick is shown, so a page that sees the tick finds the rate verified too.
        if (ok) { using var c = Db.Open(); Register.MarkVerified(c, p.Id, rate, bits != 0 ? bits : item.Sent.Bits); }
        // Its own API's word: the format, nothing of its volume or the samples (item 287).
        var fed = new Fed("its own API", "pcm", rate, bits, 0, null, 0, null, ok);
        var bump = false;
        lock (zm.Gate) { if (zm.State.TryGetValue(p.Id, out var now) && now.TrackUri == item.Uri) { now.Verified = ok ? "yes" : "no"; now.Fed = fed; bump = true; } }
        if (bump) zm.Bump();
        if (!ok)
        {
            var msg = $"Sent {Tags.Js.Num(item.Sent.Bits)}-bit/{Tags.Js.Num(item.Sent.Rate / 1000)} kHz, the device reports {(bits != 0 ? Tags.Js.Num(bits) : "?")}-bit/{Tags.Js.Num(rate / 1000)} kHz";
            lock (gate) p.LastError = (Hub.Now(), msg);
            Log($"[renderers] {rec!.Name ?? rec.NetworkName}: {msg}");
        }
    }

    /* The next file must be complete before the renderer is told about it, so it always sees a length and byte ranges for it;
       a DSF made as it plays once its making has begun, sent with its header's length and ranges as made (item 262);
       its making after that of [after], the room's track playing ("" where none is made as it plays: Upsample/Turns.cs). */
    private static bool Ready(UpnpItem it, string after)
    {
        if (it.Plan == null || !Jv.T(it.Plan["transcode"]) || it.Track == null) return true;
        var t = new ConvTrack(it.Track.Id, it.Track.Path, Hub.TierOrMtime(it.Track));
        var plan = ConvPlan.Of(it.Plan);
        // stream.js status(track, plan): ready (the file is there), running (being made), else none — and then it is started.
        var key = Transcoder.KeyFor(t, plan);
        var ready = File.Exists(Transcoder.FinalPath(key));
        // Not yet: begun (a DSF from PCM, or PCM in a shape, in its turn after what is being made now: item 259).
        if (!ready && !Transcoder.Jobs.ContainsKey(key)) { if (Upsample.MadeAsPlayed.Takes(plan)) { Upsample.Turns.Follows(key, after); Transcoder.Start(t, plan); } else Transcoder.Prefetch([(t, plan)]); }
        // A WAV made as it plays too, its length in its header (item 270), held ahead of the device as a DSF is (item 271).
        return ready || (plan.DsdUp != 0 || plan.Wav) && Upsample.MadeAsPlayed.Takes(plan) && Upsample.MadeAsPlayed.Begun(key);
    }

    /* p.Next is what the device holds as its next URI. Whenever what SHOULD follow differs — the queue was edited, the mode changed — it is told again. */
    private async Task ArmNext(Player p)
    {
        int n;
        UpnpItem? it;
        lock (gate) { n = AfterRun(p); it = n >= 0 ? p.Queue[n] : null; }   // after an album as one stream, what follows it (item 300)
        if (it == null)
        {
            // Nothing follows any more (the queue shrank): withdraw what was set.
            bool withdraw;
            lock (gate) { withdraw = p.Next is { Sent: true }; if (withdraw) p.Next = null; }
            if (withdraw) { try { await RendererOf(p).SetNextUri("", ""); } catch (RendererError) { /* nothing to withdraw */ } }
            return;
        }
        int gen;
        string after;
        lock (gate) { if (p.Next is { Sent: true } nx && nx.Uri == it.Uri) return; gen = p.JumpGen; after = p.Index >= 0 && p.Index < p.Queue.Count ? MadeKey(p.Queue[p.Index]) ?? "" : ""; }
        if (!Ready(it, after)) return;
        try
        {
            // In its turn with what else the renderer is told (item 264); a jump meanwhile, and the next poll arms what follows it.
            var told = false;
            await Serially(p, async () => { lock (gate) if (gen != p.JumpGen) return; await RendererOf(p).SetNextUri(it.Uri, it.Meta); told = true; });
            if (told) lock (gate) p.Next = (n, it.Uri, true);
        }
        catch (RendererError e)
        {
            lock (gate) p.Next = null;
            if (NotSupported.Contains(e.Code))
            {
                p.NoSetNext = true;
                Log($"[renderers] {RendererOf(p).Name}: no SetNextAVTransportURI ({e.Message}); tracks are started by hand");
            }
        }
    }

    private void Fail(Player p, string message)
    {
        lock (gate) p.LastError = (Hub.Now(), message);
        Log($"[renderers] {p.Id}: {message}");
        Optimistic(p.Id, st => st.State = "stopped");
    }

    private void PokeAfter(Player p) => _ = Task.Delay(300).ContinueWith(_ => Poll(p, false)).Unwrap().ContinueWith(_ => { }, TaskContinuationOptions.OnlyOnFaulted);

    /* Straight away, before the renderer is read back, so the page doesn't lag. */
    private void Optimistic(string id, Action<ZoneState> patch)
    {
        lock (zm.Gate)
        {
            var st = zm.State.GetValueOrDefault(id) ?? ZoneState.Blank();
            zm.State[id] = st.Patched(patch);   // a new state: the one kept is never changed in place (ZoneState.Patched)
        }
        zm.Bump();
    }

    // ------------------------------------------------------------ commands

    /* Items arrive as Items.cs builds them — { uri, meta, track, plan } — and the player keeps plain fields beside them. */
    public UpnpItem ToItem(PlayItem it)
    {
        if (it.Upnp != null) return it.Upnp;
        var m = Didl.ParseItems(it.Meta).FirstOrDefault() ?? new JsObj();
        var t = it.Track;
        var p = it.Plan;
        string Or(object? a, string? b) => Jv.T(a) ? Jv.Str(a) : b ?? "";
        return new UpnpItem
        {
            Uri = it.Uri, Meta = it.Meta, Track = t, Plan = p, Output = it.Output,
            TrackId = t?.Id ?? Phones.TrackIdFromUri(it.Uri),
            Title = Or(m["title"], t?.Title), Artist = Or(m["artist"], t?.Artist), Album = Or(m["album"], t?.Album),
            ArtUri = Or(m["artUri"], ""),
            Duration = Jv.T(m["duration"]) ? Jv.Num(m["duration"]) : t?.Duration ?? 0,
            // What the stream carries, for the Now playing badge.
            Sent = p == null ? null : new SentInfo(Jv.T(p["transcode"]),
                Jv.T(p["transcode"]) ? Jv.Num(p["rate"]) : t?.SampleRate ?? 0, Jv.T(p["transcode"]) ? Jv.Num(p["bits"]) : t?.Bits ?? 0,
                Jv.T(p["upsampled"]) ? Jv.Num(p["upsampled"]) : 0, Jv.T(p["dsp"]), Jv.T(p["dsd"]) ? Jv.Num(p["dsd"]) : 0,
                Jv.T(p["ext"]) ? Jv.Str(p["ext"]) : "", Jv.T(p["mime"]) ? Jv.Str(p["mime"]) : "") { Gain = Jv.T(p["gain"]) ? Jv.Num(p["gain"]) : 0, Lowpass = Jv.T(p["lowpass"]) ? Jv.Num(p["lowpass"]) : 0, Shape = p["shape"] as string, Mod = p["mod"] as string, Dither = Upsample.Dither.Of(p["dither"]), RealBits = Upsample.Dither.BitsOf(p["real_bits"]), DsdBase = Jv.Num(p["dsdBase"]) == 48000 ? 48000 : 44100, Headroom = Jv.T(p["headroom"]) ? Jv.Num(p["headroom"]) : 0 }
        };
    }

    public async Task<System.Text.Json.Nodes.JsonObject> Enqueue(string id, List<PlayItem> items, string how, double startAt, double seconds)
    {
        var p = Get(id);
        var list = items.Take(QueueMax).Select(ToItem).ToList();
        if (list.Count == 0) throw new HubError(500, "Nothing to play");
        int? jumpTo = null;
        lock (gate)
        {
            // Started only when the queue was empty: a queue with music in it that isn't playing just takes what's added (v0.8.34).
            var idle = p.Queue.Count == 0;
            if (how == "play_now" || (how != "queue" && p.Queue.Count == 0))
            {
                p.Queue = list;
                p.Played = [];
                jumpTo = (int)Math.Max(0, Math.Min(list.Count - 1, startAt));
            }
            else if (how == "add_next")
            {
                var at = p.Index >= 0 ? Math.Min(p.Queue.Count, p.Index + 1) : 0;
                p.Queue.InsertRange(at, list);
                if (idle) jumpTo = at;
            }
            else
            {
                var at = p.Queue.Count;
                p.Queue.AddRange(list);
                if (idle) jumpTo = at;
            }
        }
        if (jumpTo is { } j) await Jump(p, j, how == "play_now" || how != "queue" && jumpTo == 0 && p.Queue == list ? seconds : 0);
        else Optimistic(id, st => { st.QueueLength = p.Queue.Count; st.OnQueue = true; });
        zm.Persist(id);
        PokeAfter(p);
        return new System.Text.Json.Nodes.JsonObject { ["queued"] = list.Count };
    }

    public async Task Control(string id, string command)
    {
        var p = Get(id);
        var r = RendererOf(p);
        ZoneState st;
        lock (zm.Gate) st = zm.State.GetValueOrDefault(id) ?? new ZoneState();
        switch (command)
        {
            case "play":
                if (p.Index < 0 && p.Queue.Count > 0) { await Jump(p, 0); break; }
                if (st.State == "stopped" && p.Index >= 0 && p.Index < p.Queue.Count) { await Jump(p, p.Index); break; }
                await Serially(p, r.Play);
                Optimistic(id, s => { s.State = "playing"; s.Position = Hub.PositionNow(st); });
                break;
            case "pause":
                await Serially(p, r.Pause);
                Optimistic(id, s => { s.State = "paused"; s.Position = Hub.PositionNow(st); });
                break;
            case "stop":
                p.ExpectStop = true;
                await Serially(p, r.Stop);
                Optimistic(id, s => { s.State = "stopped"; s.Position = 0; });
                break;
            case "next":
            {
                int n;
                lock (gate) n = NextIndex(p);
                if (n < 0) throw new HubError(500, "Nothing after this");
                await Jump(p, n);
                break;
            }
            case "previous":
                // Back to the start of this track first, as every player does: sent again where the device is stuck (item 272).
                // In an album as one stream (item 300), the track is begun again by its run's start there.
                if (Stuck(p, st) || p.Run != null && (Hub.PositionNow(st) > 5 || p.Index <= 0)) await Jump(p, p.Index);
                else if (Hub.PositionNow(st) > 5 || p.Index <= 0) { await Serially(p, () => r.SeekTime(0)); p.SeekedAt = Hub.Now(); Optimistic(id, s => s.Position = 0); }
                else await Jump(p, p.Index - 1);
                break;
            case "playpause":
                await Control(id, st.State is "playing" or "loading" ? "pause" : "play");
                return;
            default: throw new HubError(500, "unknown command " + command);
        }
        PokeAfter(p);
    }

    public async Task Seek(string id, string how, double seconds)
    {
        var p = Get(id);
        ZoneState st;
        lock (zm.Gate) st = zm.State.GetValueOrDefault(id) ?? new ZoneState();
        var target = Math.Max(0, how == "relative" ? Hub.PositionNow(st) + seconds : seconds);
        // In an album as one stream (item 300), its run begun again at the track and the seconds into it.
        if (Stuck(p, st) || p.Run != null) await Jump(p, p.Index, target);
        else await Serially(p, () => RendererOf(p).SeekTime(target));
        p.SeekedAt = Hub.Now(); Optimistic(id, s => s.Position = target);
        PokeAfter(p);
    }

    // A device left starting a track of the queue (still loading after eight seconds, or stopped on it): a seek in
    // it does nothing (the FiiO SR11 left waiting for a seek that hadn't been made: item 272); the track is sent again.
    private static bool Stuck(Player p, ZoneState st) =>
        p.Index >= 0 && p.Index < p.Queue.Count && st.OnQueue && (st.State == "stopped" || st.State == "loading" && Hub.Now() - p.LoadingSince > 8000);

    public async Task PlayFromHere(string id, double position)
    {
        var p = Get(id);
        var i = (int)position - 1;
        bool has;
        lock (gate) has = i >= 0 && i < p.Queue.Count;
        if (!has) throw new HubError(500, "No such track in the queue");
        await Jump(p, i);
        PokeAfter(p);
    }

    public async Task RemoveFromQueue(string id, double position)
    {
        var p = Get(id);
        var i = (int)position - 1;
        bool wasCurrent, hasNext;
        lock (gate)
        {
            if (i < 0 || i >= p.Queue.Count) return;
            wasCurrent = i == p.Index;
            p.Queue.RemoveAt(i);
            if (i < p.Index) p.Index--;
            hasNext = i < p.Queue.Count;
            if (wasCurrent && !hasNext) p.Index = p.Queue.Count - 1;
        }
        if (wasCurrent)
        {
            if (hasNext) await Jump(p, i);
            else
            {
                p.ExpectStop = true;
                try { await RendererOf(p).Stop(); } catch (RendererError) { /* already */ }
                Optimistic(id, s => { s.State = "stopped"; s.Position = 0; });
            }
        }
        Optimistic(id, s => { s.QueueLength = p.Queue.Count; s.OnQueue = p.Queue.Count > 0; s.TrackNumber = p.Index + 1; });
        zm.Persist(id);
    }

    public QueueMoves.Plan MoveAfterCurrent(string id, List<double> positions)
    {
        var p = Get(id);
        QueueMoves.Plan plan;
        lock (gate)
        {
            plan = QueueMoves.PlanMoves((double)p.Queue.Count, (double)(p.Index + 1), positions.Select(x => (object?)x).ToList());
            if (plan.Moves.Count > 0)
            {
                p.Queue = plan.Order.Select(i => p.Queue[(int)i - 1]).ToList();
                p.Index = (int)plan.Current - 1;
                p.Next = null;   // the device's own next is read again at the next poll
            }
        }
        if (plan.Moves.Count > 0)
        {
            Optimistic(id, s => { s.QueueLength = p.Queue.Count; s.TrackNumber = p.Index + 1; });
            zm.Persist(id);
        }
        return plan;
    }

    public Task ClearQueue(string id) => Emptied(Get(id));

    public void SetSettings(string id, bool? shuffle, string? loop)
    {
        var p = Get(id);
        lock (gate)
        {
            if (shuffle != null) { p.Shuffle = shuffle.Value; p.Played = p.Index >= 0 && p.Index < p.Queue.Count ? [p.Queue[p.Index]] : []; }
            if (loop is "disabled" or "loop" or "loop_one") p.Loop = loop;
            p.Successor = null;
        }
        Optimistic(id, s => { s.Shuffle = p.Shuffle; s.Loop = p.Loop; });
    }

    public async Task SetVolume(string id, string how, double value)
    {
        var p = Get(id);
        var rec = Record(id)!;
        if (FixedVolume(rec)) throw new HubError(500, $"{rec.Name ?? rec.NetworkName}'s volume is set on the device itself");
        // A nudge goes from where the device is (item 187): never read yet, it is asked (and refused if it can't say).
        var cur = p.Volume.Value ?? (how is "relative" or "relative_step" ? await RendererOf(p).GetVolume() : 0);
        var target = Math.Max(0, Math.Min(100, Tags.Js.Round(how is "relative" or "relative_step" ? cur + value : value)));
        await RendererOf(p).SetVolume(target);
        lock (gate) p.Volume = (target, p.Volume.Muted);
        if (rec.Kind == "local") { using var c = Db.Open(); Register.SetSettings(c, id, Jv.Obj(("local_volume", target))); }
        Optimistic(id, s => s.VolumeValue = new Volume(p.Volume.Value, p.Volume.Muted));
    }

    public async Task SetMute(string id, bool muted)
    {
        var p = Get(id);
        var rec = Record(id)!;
        if (FixedVolume(rec)) throw new HubError(500, $"{rec.Name ?? rec.NetworkName}'s volume is set on the device itself");
        await RendererOf(p).SetMute(muted);
        lock (gate) p.Volume = (p.Volume.Value, muted);
        Optimistic(id, s => s.VolumeValue = new Volume(p.Volume.Value, p.Volume.Muted));
    }

    public async Task PauseAll()
    {
        List<Player> players;
        lock (gate) players = map.Values.ToList();
        foreach (var p in players)
        {
            ZoneState? st;
            lock (zm.Gate) st = zm.State.GetValueOrDefault(p.Id);
            if (st is { State: "playing" or "loading" }) { try { await RendererOf(p).Pause(); } catch (Exception e) when (e is RendererError or HubError) { /* not there */ } }
        }
    }
}
