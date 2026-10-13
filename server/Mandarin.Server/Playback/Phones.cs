// Phones.cs — an Android phone running the Mandarin app, as one more zone
// (lib/sonos/phones.js, v0.8.49, stage 6). The phone plays through its own
// speaker or headphones; to everything else — the page, the zone picker, the
// queue, history, the radio — it is simply another room. The server keeps the
// phone's queue and sends it COMMANDS (load, insert, play, pause, seek…) that
// the app collects with a long poll; the app reports back what it is doing,
// and that report becomes the zone's state, the same shape a Sonos poll
// produces. A phone is a zone only while its app is connected: it disappears
// about 45 s after the app stops asking for commands. The shapes are the
// app's and don't move.
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using TJs = Mandarin.Server.Tags.Js;

/* One phone: its queue, the commands waiting for it, when it was last heard. */
internal sealed class PhoneRec
{
    public string Uid = "", DeviceId = "", Name = "Phone";
    public List<PhoneItem> Queue = [];
    public List<JsonObject> Commands = [];
    public double LastSeen;
    public bool Gone;
    public bool? Away;                      // null until its first request says
    public List<TaskCompletionSource> Waiters = [];
    public List<PhoneItem>? Local;          // the player's own list (the phone's music)
    public double? VolumeSteps;
    public JsObj? UsbCaps;                  // { rates, bits, dsd }
}

internal sealed partial class Phones
{
    public const int PresentMs = 45000;
    private const int KeepCommands = 200;
    // What the app's player (Media3) reads as it is; the rest comes as FLAC.
    private static readonly string[] PhoneContainers = ["flac", "mp3", "aac", "alac", "wav", "aiff", "ogg", "opus"];

    private readonly Hub zm;
    public readonly Dictionary<string, PhoneRec> Map = [];
    public long Seq;
    private readonly Timer sweeper;

    public Phones(Hub hub)
    {
        zm = hub;
        sweeper = new Timer(_ => Sweep(), null, 10000, 10000);
    }

    public void Stop() => sweeper.Dispose();

    public static string UidFor(string deviceId) => "PHONE_" + deviceId;
    public bool IsPhoneId(string? id) => (id ?? "").StartsWith("PHONE_", StringComparison.Ordinal);

    /* Where the phone is, as its own requests show: a phone away from home is a player for itself only. */
    public void SetAway(string? uid, bool away)
    {
        bool bump;
        lock (zm.Gate)
        {
            if (!Map.TryGetValue(uid ?? "", out var p) || p.Away == away) return;
            p.Away = away;
            bump = true;
        }
        if (bump) zm.Bump();
    }
    public bool IsAway(string? uid) { lock (zm.Gate) return !Map.TryGetValue(uid ?? "", out var p) || p.Away != false; }
    public bool Present(PhoneRec? p) => p != null && Hub.Now() - p.LastSeen < PresentMs;
    public bool Has(string? id) { lock (zm.Gate) return Present(Map.GetValueOrDefault(id ?? "")); }
    public PhoneRec Get(string? id)
    {
        lock (zm.Gate)
        {
            var p = Map.GetValueOrDefault(id ?? "");
            if (!Present(p)) throw new HubError(409, "That phone isn't connected — open the Mandarin app on it");
            return p!;
        }
    }

    private void Sweep()
    {
        var changed = false;
        lock (zm.Gate)
            foreach (var p in Map.Values)
                if (!Present(p) && !p.Gone) { p.Gone = true; changed = true; }
        if (changed) zm.Bump();
    }

    // ------------------------------------------------------------ the app

    /*
     * The app's player has (re)started with nothing loaded. Its queue here is
     * kept and handed back as `resume`: the same tracks, the same place,
     * paused. A phone the server never met, or one whose queue was empty,
     * starts blank.
     */
    public JsonObject Hello(string deviceId, string? name)
    {
        var uid = UidFor(deviceId);
        JsonObject? resume = null;
        lock (zm.Gate)
        {
            if (!Map.TryGetValue(uid, out var p)) p = new PhoneRec { Uid = uid, DeviceId = deviceId };
            p.Name = Register.CleanName(name ?? "Phone") is { Length: > 0 } n ? n : "Phone";
            p.Commands = [];
            p.LastSeen = Hub.Now();
            p.Gone = false;
            Map[uid] = p;
            var prev = zm.State.GetValueOrDefault(uid) ?? new ZoneState();
            if (p.Queue.Count > 0)
            {
                var snap = Snapshot(p);
                var seconds = (double)snap["seconds"]!;
                resume = new JsonObject { ["op"] = "load" };
                foreach (var (k, v) in snap.ToList()) { snap.Remove(k); resume[k] = v; }
                resume["play"] = false;
                var next = prev.Clone();
                next.State = "paused"; next.Position = seconds; next.At = Hub.Now(); next.Unreachable = false;
                next.VolumeValue = prev.VolumeValue ?? new Volume(null, false);
                zm.State[uid] = next;
            }
            else zm.State[uid] = ZoneState.Blank(prev.VolumeValue);
        }
        zm.Bump();
        zm.Persist(uid);
        return new JsonObject { ["zone_id"] = uid, ["seq"] = Seq, ["resume"] = resume };
    }

    /* What the store keeps of this phone's queue; null when empty. */
    public QueueSnapshot? Saved(string uid)
    {
        var p = Map.GetValueOrDefault(uid);
        if (p == null || p.Queue.Count == 0) return null;
        return new QueueSnapshot { Kind = "phone", DeviceId = p.DeviceId, Name = p.Name, Ids = p.Queue.Select(it => it.TrackId).ToList() };
    }

    /* A queue kept from before a restart, back on the server's side; until the app is heard, the phone is not in the zone list. */
    public void Restore(QueueSnapshot snap, List<PlayItem> items)
    {
        var uid = UidFor(snap.DeviceId ?? "");
        var list = items.Select(ToItem).ToList();
        lock (zm.Gate)
        {
            if (!Map.TryGetValue(uid, out var p)) p = new PhoneRec { Uid = uid, DeviceId = snap.DeviceId ?? "" };
            p.Name = snap.Name is { Length: > 0 } n ? n : p.Name is { Length: > 0 } pn ? pn : "Phone";
            p.Queue = list;
            p.LastSeen = 0;
            p.Gone = true;
            Map[uid] = p;
            var index = (int)Math.Max(0, Math.Min(list.Count - 1, snap.Index));
            var it = list[index];
            var st = ZoneState.Blank(snap.VolumeValue);
            st.State = snap.State == "stopped" ? "stopped" : "paused";
            st.TrackUri = it.Uri; st.TrackId = it.TrackId; st.TrackNumber = index + 1; st.QueueLength = list.Count; st.OnQueue = true;
            st.Position = Math.Max(0, snap.Seconds); st.Duration = it.Duration;
            st.Title = it.Title; st.Artist = it.Artist; st.Album = it.Album; st.ArtUri = it.ArtUri;
            st.Shuffle = snap.Shuffle; st.Loop = snap.Loop is { Length: > 0 } lp ? lp : "disabled"; st.At = Hub.Now();
            zm.State[uid] = st;
        }
    }

    /* Commands after `after`, waiting up to `timeoutMs` for one to arrive. */
    public async Task<JsonObject> Commands(string uid, double after, int timeoutMs)
    {
        PhoneRec p;
        TaskCompletionSource? wait = null;
        bool bump = false;
        lock (zm.Gate)
        {
            p = Map.GetValueOrDefault(uid) ?? throw new HubError(409, "Say hello first");
            var wasGone = !Present(p);
            p.LastSeen = Hub.Now();
            if (wasGone) { p.Gone = false; bump = true; }
            // The app is ahead of us: this server has restarted with the phone's queue put back, and counts from nought again.
            if (after > Seq) after = Seq;
            if (!p.Commands.Any(c => (double)c["seq"]! > after) && timeoutMs > 0)
            {
                wait = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                p.Waiters.Add(wait);
            }
        }
        if (bump) zm.Bump();
        if (wait != null)
        {
            using var cts = new CancellationTokenSource(timeoutMs);
            using (cts.Token.Register(() => wait.TrySetResult())) await wait.Task;
            lock (zm.Gate) { p.Waiters.Remove(wait); p.LastSeen = Hub.Now(); }
        }
        lock (zm.Gate)
        {
            // Missed some (the list was trimmed): start again from a full picture.
            if (after > 0 && p.Commands.Count > 0 && (double)p.Commands[0]["seq"]! > after + 1)
            {
                var sync = new JsonObject { ["seq"] = Seq, ["op"] = "sync" };
                foreach (var (k, v) in Snapshot(p).ToList()) sync[k] = v?.DeepClone();
                return new JsonObject { ["seq"] = Seq, ["commands"] = new JsonArray(sync) };
            }
            var pending = p.Commands.Where(c => (double)c["seq"]! > after).Select(c => (JsonNode)c.DeepClone()).ToArray();
            return new JsonObject { ["seq"] = Seq, ["commands"] = new JsonArray(pending) };
        }
    }

    /* The phone's USB DAC as a stream target: null (the Sonos rule) with no DAC in use. */
    public JsObj? TargetFor(string uid)
    {
        lock (zm.Gate)
        {
            var p = Map.GetValueOrDefault(uid);
            if (p?.UsbCaps is not { } c) return null;
            var bits = c["bits"] as List<object?> ?? [];
            return Jv.Obj(("id", p.Uid), ("name", p.Name), ("rates", c["rates"]), ("maxBits", bits.Count > 0 ? bits.Max(b => Jv.Num(b)) : 24),
                ("containers", PhoneContainers.Select(x => (object?)x).ToList()), ("mode", "original"), ("bits", "auto"), ("dsd", c["dsd"]), ("dsp", null));
        }
    }

    /* The app's usb_caps, checked: { rates, bits, dsd } or null. */
    public static JsObj? UsbCaps(JsonNode? v)
    {
        if (v is not JsonObject o) return null;
        static List<object?> Ints(JsonNode? a, Func<double, bool> ok) => a is JsonArray arr
            ? arr.Select(x => JsNumber(x)).Where(ok).Distinct().OrderBy(x => x).Select(x => (object?)x).ToList() : [];
        var rates = Ints(o["rates"], n => double.IsInteger(n) && n >= 8000 && n <= 768000);
        if (rates.Count == 0) return null;
        return Jv.Obj(("rates", rates), ("bits", Ints(o["bits"], n => n is 16 or 24 or 32)), ("dsd", Ints(o["dsd"], n => n is 64 or 128 or 256 or 512)));
    }

    /* Number(v) of a JSON value: nothing is NaN, null is 0, text as JavaScript reads it. */
    public static double JsNumber(JsonNode? v) => v switch
    {
        null => 0,
        JsonValue jv when jv.TryGetValue<double>(out var d) => d,
        JsonValue jv when jv.TryGetValue<bool>(out var b) => b ? 1 : 0,
        JsonValue jv when jv.TryGetValue<string>(out var s) => TJs.StringToNumber(s),
        JsonArray a when a.Count == 0 => 0,
        JsonArray a when a.Count == 1 => JsNumber(a[0]),
        _ => double.NaN
    };
}
