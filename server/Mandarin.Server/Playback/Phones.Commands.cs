// Phones.Commands.cs — what is done to a phone zone (phones.js's commands):
// each becomes a command the app collects, and the zone's state moves at
// once, before the phone reports back, so the page doesn't lag.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using AJs = Mandarin.Server.Js;
using TJs = Mandarin.Server.Tags.Js;

internal sealed partial class Phones
{
    [GeneratedRegex(@"/stream/t(\d+)(?:\.(?:orig|\d+-\d+))?\.[a-z0-9]+(?:\?|$)", RegexOptions.IgnoreCase)] private static partial Regex StreamUri();

    /* trackIdFromUri (lib/server/playback.js): the track a stream address names, or null. */
    public static long? TrackIdFromUri(string? uri)
    {
        var m = StreamUri().Match(uri ?? "");
        return m.Success && long.TryParse(m.Groups[1].Value, out var id) ? id : null;
    }

    /* The phone's DSP setting was saved (Audio Devices): the app is told, and runs it from the next buffer. */
    public bool DspChanged(string uid, JsObj? dsp)
    {
        lock (zm.Gate)
        {
            if (!Map.TryGetValue(uid, out var p)) return false;
            Push(p, new JsonObject { ["op"] = "dsp", ["dsp"] = ToNode(dsp) });
            return true;
        }
    }

    /* This phone's Volume Levelling changed: the app is told, for what it plays by itself. */
    public bool LevellingChanged(string uid, JsObj lv)
    {
        lock (zm.Gate)
        {
            if (!Map.TryGetValue(uid, out var p)) return false;
            Push(p, new JsonObject { ["op"] = "replaygain", ["replaygain"] = ToNode(lv) });
            return true;
        }
    }

    public static JsonNode? ToNode(object? v) => TJs.Json(v) is { } text ? JsonNode.Parse(text) : null;

    /* Under the gate. The sequence number comes last, as the Node server adds it. */
    private void Push(PhoneRec p, JsonObject cmd)
    {
        cmd["seq"] = (double)++Seq;
        p.Commands.Add(cmd);
        if (p.Commands.Count > KeepCommands) p.Commands.RemoveRange(0, p.Commands.Count - KeepCommands);
        foreach (var w in p.Waiters.ToList()) w.TrySetResult();
    }

    /* The queue's items built again for the phone's target as it is now, and handed back in place. */
    private async Task Replan(PhoneRec p)
    {
        List<long> ids;
        lock (zm.Gate)
        {
            if (p.Queue.Count == 0) return;
            if (p.Queue.Any(it => it.TrackId is null or 0)) return;
            ids = p.Queue.Select(it => it.TrackId!.Value).ToList();
        }
        List<PhoneItem> items;
        try { items = (await zm.RebuildItems(ids, p.Uid)).Select(ToItem).ToList(); } catch (Exception e) when (e is HubError or JsError) { return; }
        lock (zm.Gate)
        {
            if (items.Count != p.Queue.Count) return;
            if (items.Select(it => it.Uri).SequenceEqual(p.Queue.Select(it => it.Uri))) return;
            p.Queue = items;
            var st = zm.State.GetValueOrDefault(p.Uid) ?? new ZoneState();
            var snap = Snapshot(p);
            var cmd = new JsonObject { ["op"] = "load" };
            foreach (var (k, v) in snap.ToList()) { snap.Remove(k); cmd[k] = v; }
            cmd["play"] = st.State is "playing" or "loading";
            Push(p, cmd);
            var index = (int)(double)cmd["index"]!;
            if (index < p.Queue.Count) st.TrackUri = p.Queue[index].Uri;
        }
        zm.Persist(p.Uid);
    }

    /* Straight away, before the phone reports back, so the page doesn't lag. */
    private void Optimistic(string uid, Action<ZoneState> patch)
    {
        lock (zm.Gate)
        {
            if (!zm.State.TryGetValue(uid, out var st)) return;
            patch(st);
            st.At = Hub.Now();
        }
        zm.Bump();
    }

    /* { items, index, seconds, play }: the queue as the app is handed it. Under the gate. */
    private JsonObject Snapshot(PhoneRec p)
    {
        var st = zm.State.GetValueOrDefault(p.Uid) ?? new ZoneState();
        return new JsonObject
        {
            ["items"] = new JsonArray(p.Queue.Select(it => (JsonNode)it.Public()).ToArray()),
            ["index"] = Math.Max(0, (st.TrackNumber > 0 ? st.TrackNumber : 1) - 1),
            ["seconds"] = Hub.PositionNow(st),
            ["play"] = st.State == "playing"
        };
    }

    /* Items arrive as the Sonos code builds them — { uri, meta, track? } — and the phone needs plain fields. */
    public PhoneItem ToItem(PlayItem it)
    {
        if (it.Phone != null) return it.Phone;
        var m = Didl.ParseItems(it.Meta).FirstOrDefault() ?? new JsObj();
        var t = it.Track;
        string Or(object? a, string? b) => Jv.T(a) ? Jv.Str(a) : b is { Length: > 0 } ? b : "";
        return new PhoneItem
        {
            Uri = it.Uri,
            TrackId = t?.Id ?? TrackIdFromUri(it.Uri),
            Title = Or(m["title"], t?.Title), Artist = Or(m["artist"], t?.Artist), Album = Or(m["album"], t?.Album),
            ArtUri = Jv.T(m["artUri"]) ? Jv.Str(m["artUri"]) : "",
            Duration = Jv.T(m["duration"]) ? Jv.Num(m["duration"]) : t?.Duration ?? 0,
            Gain = it.Gain
        };
    }

    public JsonObject Enqueue(string uid, List<PlayItem> items, string how, double startAt = 0, double seconds = 0)
    {
        var p = Get(uid);
        var list = items.Select(ToItem).ToList();
        if (list.Count == 0) throw new HubError(500, "Nothing to play");
        var st = zm.StateOf(uid) ?? new ZoneState();
        lock (zm.Gate)
        {
            // The phone playing a list of its own: an album added goes into that list, where the phone is.
            if (how != "play_now" && st.Local && p.Local is { Count: > 0 })
            {
                var at = how == "add_next" ? (int)Math.Min(p.Local.Count, st.TrackNumber) : p.Local.Count;
                p.Local.InsertRange(at, list.Select(it => new PhoneItem { Uri = it.Uri, TrackId = it.TrackId, Title = it.Title, Artist = it.Artist, Album = it.Album, ArtUri = it.ArtUri, Duration = it.Duration, Gain = it.Gain, ImageKey = null, AlbumKey = null, Ext = "" }));
                Push(p, new JsonObject { ["op"] = "insert", ["at"] = at, ["local"] = true, ["items"] = Publics(list), ["play"] = false });
                var n = p.Local.Count;
                OptimisticLocked(uid, s => { s.QueueLength = n; s.OnQueue = true; });
                return new JsonObject { ["queued"] = list.Count };
            }
            // Started only when the queue was empty: one with music in it that isn't playing just takes what's added (v0.8.34).
            var idle = p.Queue.Count == 0;
            if (how == "play_now" || (how != "queue" && idle))
            {
                p.Queue = list;
                var index = (int)Math.Max(0, Math.Min(list.Count - 1, startAt));
                Push(p, new JsonObject { ["op"] = "load", ["items"] = Publics(list), ["index"] = index, ["seconds"] = seconds, ["play"] = true });
                var it = list[index];
                OptimisticLocked(uid, s =>
                {
                    s.Local = false; s.ImageKey = null; s.AlbumOffset = null; s.State = "loading"; s.TrackNumber = index + 1; s.QueueLength = list.Count; s.OnQueue = true;
                    s.TrackUri = it.Uri; s.TrackId = it.TrackId; s.Title = it.Title; s.Artist = it.Artist; s.Album = it.Album; s.ArtUri = it.ArtUri; s.Duration = it.Duration; s.Position = seconds;
                });
            }
            else if (how == "add_next")
            {
                var at = (int)Math.Min(p.Queue.Count, st.TrackNumber);
                p.Queue.InsertRange(at, list);
                Push(p, new JsonObject { ["op"] = "insert", ["at"] = at, ["items"] = Publics(list), ["play"] = idle });
                var n = p.Queue.Count;
                OptimisticLocked(uid, s => { s.QueueLength = n; s.OnQueue = true; });
            }
            else
            {
                var at = p.Queue.Count;
                p.Queue.AddRange(list);
                Push(p, new JsonObject { ["op"] = "insert", ["at"] = at, ["items"] = Publics(list), ["play"] = idle });
                var n = p.Queue.Count;
                OptimisticLocked(uid, s => { s.QueueLength = n; s.OnQueue = true; });
            }
        }
        zm.Bump();
        zm.Persist(uid);
        return new JsonObject { ["queued"] = list.Count };
    }

    private static JsonArray Publics(IEnumerable<PhoneItem> list) => new(list.Select(it => (JsonNode)it.Public()).ToArray());

    /* Optimistic, already under the gate: the bump is the caller's. */
    private void OptimisticLocked(string uid, Action<ZoneState> patch)
    {
        if (!zm.State.TryGetValue(uid, out var s)) return;
        patch(s);
        s.At = Hub.Now();
    }

    public void Control(string uid, string command)
    {
        var p = Get(uid);
        var st = zm.StateOf(uid) ?? new ZoneState();
        var cmd = command;
        if (cmd == "playpause") cmd = st.State is "playing" or "loading" ? "pause" : "play";
        if (cmd is not ("play" or "pause" or "stop" or "next" or "previous")) throw new HubError(500, "unknown command " + command);
        lock (zm.Gate) Push(p, new JsonObject { ["op"] = cmd });
        if (cmd == "play") Optimistic(uid, s => { s.State = "playing"; s.Position = Hub.PositionNow(st); });
        if (cmd is "pause" or "stop") Optimistic(uid, s => { s.State = cmd == "stop" ? "stopped" : "paused"; s.Position = Hub.PositionNow(st); });
    }

    public void Seek(string uid, string how, double seconds)
    {
        var p = Get(uid);
        var st = zm.StateOf(uid) ?? new ZoneState();
        var target = Math.Max(0, how == "relative" ? Hub.PositionNow(st) + seconds : seconds);
        lock (zm.Gate) Push(p, new JsonObject { ["op"] = "seek", ["seconds"] = target });
        Optimistic(uid, s => s.Position = target);
    }

    public void PlayFromHere(string uid, double position)
    {
        var p = Get(uid);
        PhoneItem? it;
        int index;
        lock (zm.Gate)
        {
            var st = zm.State.GetValueOrDefault(uid) ?? new ZoneState();
            var list = st.Local && p.Local != null ? p.Local : p.Queue;
            index = (int)Math.Max(0, Math.Min(list.Count - 1, position - 1));
            Push(p, new JsonObject { ["op"] = "jump", ["index"] = index });
            it = index >= 0 && index < list.Count ? list[index] : null;
        }
        if (it != null) Optimistic(uid, s => { s.State = "loading"; s.TrackNumber = index + 1; s.TrackUri = it.Uri; s.TrackId = it.TrackId; s.Title = it.Title; s.Position = 0; });
    }

    public void RemoveFromQueue(string uid, double position)
    {
        var p = Get(uid);
        int n;
        lock (zm.Gate)
        {
            var index = (int)(position - 1);
            if (index < 0 || index >= p.Queue.Count) return;
            p.Queue.RemoveAt(index);
            Push(p, new JsonObject { ["op"] = "remove", ["index"] = index });
            n = p.Queue.Count;
        }
        Optimistic(uid, s => s.QueueLength = n);
        zm.Persist(uid);
    }

    public QueueMoves.Plan MoveAfterCurrent(string uid, List<double> positions)
    {
        var p = Get(uid);
        QueueMoves.Plan plan;
        lock (zm.Gate)
        {
            var st = zm.State.GetValueOrDefault(uid) ?? new ZoneState();
            plan = QueueMoves.PlanMoves((double)p.Queue.Count, st.TrackNumber, positions.Select(x => (object?)x).ToList());
            // The phone has remove and insert: each move is the two, in the server's order.
            foreach (var m in plan.Moves)
            {
                var item = p.Queue[(int)m.From - 1];
                p.Queue.RemoveAt((int)m.From - 1);
                p.Queue.Insert((int)m.At - 1, item);
                Push(p, new JsonObject { ["op"] = "remove", ["index"] = m.From - 1 });
                Push(p, new JsonObject { ["op"] = "insert", ["at"] = m.At - 1, ["items"] = new JsonArray(item.Public()), ["play"] = false });
            }
        }
        if (plan.Moves.Count > 0) { Optimistic(uid, s => s.TrackNumber = plan.Current); zm.Persist(uid); }
        return plan;
    }

    public void ClearQueue(string uid)
    {
        var p = Get(uid);
        lock (zm.Gate)
        {
            p.Queue = [];
            Push(p, new JsonObject { ["op"] = "clear" });
            var volume = (zm.State.GetValueOrDefault(uid) ?? new ZoneState()).VolumeValue;
            zm.State[uid] = ZoneState.Blank(volume);
        }
        zm.Bump();
        zm.Persist(uid);
    }

    public void SetSettings(string uid, bool? shuffle, string? loop)
    {
        var p = Get(uid);
        var st = zm.StateOf(uid) ?? new ZoneState();
        var nextShuffle = shuffle ?? st.Shuffle;
        var nextLoop = loop ?? (st.Loop is { Length: > 0 } l ? l : "disabled");
        lock (zm.Gate) Push(p, new JsonObject { ["op"] = "mode", ["shuffle"] = nextShuffle, ["loop"] = nextLoop });
        Optimistic(uid, s => { s.Shuffle = nextShuffle; s.Loop = nextLoop; });
    }

    public void SetVolume(string uid, string how, double value)
    {
        var p = Get(uid);
        var st = zm.StateOf(uid) ?? new ZoneState();
        var cur = st.VolumeValue?.Value ?? 0;
        var relative = how is "relative" or "relative_step";
        var target = Math.Max(0, Math.Min(100, TJs.Round(relative ? cur + value : value)));
        // To one of the phone's own steps, as it will set and report it; a nudge that would round back to where it is moves one whole step.
        var steps = p.VolumeSteps;
        if (steps is > 0 and < 100)
        {
            var s = TJs.Round(target * steps.Value / 100);
            var now = TJs.Round(cur * steps.Value / 100);
            if (relative && value != 0 && s == now) s = now + Math.Sign(value);
            s = Math.Max(0, Math.Min(steps.Value, s));
            target = TJs.Round(s * 100 / steps.Value);
        }
        lock (zm.Gate) Push(p, new JsonObject { ["op"] = "volume", ["value"] = target });
        var muted = st.VolumeValue?.Muted ?? false;
        Optimistic(uid, s => s.VolumeValue = new Volume(target, muted));
    }

    public void SetMute(string uid, bool muted)
    {
        var p = Get(uid);
        var st = zm.StateOf(uid) ?? new ZoneState();
        lock (zm.Gate) Push(p, new JsonObject { ["op"] = "mute", ["muted"] = muted });
        var value = st.VolumeValue?.Value;
        Optimistic(uid, s => s.VolumeValue = new Volume(value, muted));
    }

    public void PauseAll()
    {
        lock (zm.Gate) foreach (var p in Map.Values) if (Present(p)) Push(p, new JsonObject { ["op"] = "pause" });
    }

    /* The queue as Sonos-style items, for moving what's playing elsewhere. */
    public List<PlayItem> ItemsFor(string uid)
    {
        var p = Get(uid);
        lock (zm.Gate)
            return p.Queue.Select(it => new PlayItem
            {
                Uri = it.Uri, Phone = it,
                Meta = Didl.Build(it.Uri, Jv.Obj(("title", it.Title), ("artist", it.Artist), ("album", it.Album), ("artUri", it.ArtUri), ("duration", it.Duration)))
            }).ToList();
    }
}
