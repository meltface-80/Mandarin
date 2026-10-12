// Phones.Report.cs — what the app says it is doing (phones.js report), and
// the phone as a zone: the list the page sees and its queue.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using AJs = Mandarin.Server.Js;
using TJs = Mandarin.Server.Tags.Js;

internal sealed partial class Phones
{
    [GeneratedRegex(@"^(\d+/\d+|dsd\d+|dop\d+)$")] private static partial Regex UsbShape();
    [GeneratedRegex(@"/api/image/([^?#/]+)")] private static partial Regex OwnImage();

    /* The image key in one of this server's own cover addresses (/api/image/<key>?…), or null. */
    private static string? OwnImageKey(JsonNode? url)
    {
        var m = OwnImage().Match(AJs.Str(url));
        if (!m.Success) return null;
        return Signing.DecodeURIComponent(m.Groups[1].Value);
    }

    private static string JsText(JsonNode? v) => v == null ? "" : v is JsonValue jv && jv.TryGetValue<string>(out var s) ? s : AJs.Str(v);

    /* What the app says it is doing. */
    public void Report(string uid, JsonObject r)
    {
        ZoneState prev, next;
        PhoneRec p;
        bool replan = false;
        lock (zm.Gate)
        {
            if (!Map.TryGetValue(uid, out p!)) return;
            p.LastSeen = Hub.Now();
            // The player holding a list of its own (the phone's music; a download the server doesn't know).
            if (AJs.Truthy(r["local"]) && r["local_items"] is JsonArray items)
            {
                p.Local = items.Take(500).Select(it0 =>
                {
                    var it = it0 as JsonObject ?? [];
                    var tid = it["track_id"] is JsonValue tv && tv.TryGetValue<double>(out var td) && double.IsInteger(td) && td > 0 ? (long?)td : null;
                    return new PhoneItem
                    {
                        Uri = "", TrackId = tid, Title = JsText(it["title"]), Artist = JsText(it["artist"]), Album = JsText(it["album"]),
                        ArtUri = "", ImageKey = AJs.Truthy(it["image_key"]) ? AJs.Str(it["image_key"]) : OwnImageKey(it["art_url"]),
                        AlbumKey = AJs.Truthy(it["album_key"]) ? AJs.Str(it["album_key"]) : null,
                        Duration = JsNumber(it["duration"]) is var du && !double.IsNaN(du) ? du : 0, Ext = AJs.Truthy(it["ext"]) ? AJs.Str(it["ext"]) : ""
                    };
                }).ToList();
            }
            var local = AJs.Truthy(r["local"]) && p.Local is { Count: > 0 };
            var list = local ? p.Local! : p.Queue;
            var count = list.Count;
            var index = r["index"] is JsonValue iv && iv.TryGetValue<double>(out var idx) && double.IsInteger(idx) && idx >= 0 && idx < count ? (int)idx : -1;
            var item = index >= 0 ? list[index] : null;
            prev = zm.State.GetValueOrDefault(uid) ?? ZoneState.Blank();
            next = ZoneState.Blank();
            next.Local = local;
            next.ImageKey = local && item != null ? item.ImageKey : null;
            next.AlbumOffset = local && item is { AlbumKey: { } ak } ? "phone:" + ak : null;
            next.LocalExt = local && item != null ? item.Ext : "";
            var state = AJs.Str(r["state"]);
            next.State = state is "playing" or "paused" or "loading" or "stopped" ? state : "stopped";
            next.TrackUri = item?.Uri ?? "";
            next.TrackId = item?.TrackId;
            next.TrackNumber = item != null ? index + 1 : 0;
            next.QueueLength = count;
            next.OnQueue = count > 0;
            var pos = JsNumber(r["position"]);
            next.Position = Math.Max(0, double.IsNaN(pos) ? 0 : pos);
            var dur = JsNumber(r["duration"]);
            next.Duration = !double.IsNaN(dur) && dur != 0 ? dur : item?.Duration ?? 0;
            next.Title = item?.Title ?? ""; next.Artist = item?.Artist ?? ""; next.Album = item?.Album ?? ""; next.ArtUri = item?.ArtUri ?? "";
            next.Shuffle = AJs.Truthy(r["shuffle"]);
            var loop = AJs.Str(r["loop"]);
            next.Loop = loop is "disabled" or "loop" or "loop_one" ? loop : "disabled";
            var format = AJs.Str(r["format"]);
            next.Format = format == "opus24" ? "opus24" : format == "opus" ? "opus" : "original";
            next.Dsp = AJs.Truthy(r["dsp"]);
            next.Usb = r["usb"] is JsonValue uv && uv.TryGetValue<string>(out var usb) && UsbShape().IsMatch(usb) ? usb : null;
            var vol = r.ContainsKey("volume") ? JsNumber(r["volume"]) : double.NaN;
            next.VolumeValue = new Volume(double.IsFinite(vol) ? Math.Max(0, Math.Min(100, TJs.Round(vol))) : prev.VolumeValue?.Value, AJs.Truthy(r["muted"]));
            next.At = Hub.Now();
        }
        zm.ApplyState(uid, prev, next);
        lock (zm.Gate)
        {
            // How many steps the phone's volume really has (v0.8.11): known, the page steps by one of them.
            var steps = TJs.Round(JsNumber(r["volume_steps"]));
            p.VolumeSteps = steps >= 1 && steps <= 1000 ? steps : null;
            // The DAC came, went or changed: the queue's addresses are planned for it again.
            var caps = UsbCaps(r["usb_caps"]);
            if (TJs.Json(caps) != TJs.Json(p.UsbCaps)) { p.UsbCaps = caps; replan = true; }
        }
        if (replan) _ = Replan(p).ContinueWith(t => zm.Log("[phones] replan: " + t.Exception?.InnerException?.Message), TaskContinuationOptions.OnlyOnFaulted);
    }

    // ------------------------------------------------------------ zones

    public List<ZoneInfo> Zones()
    {
        var out_ = new List<ZoneInfo>();
        lock (zm.Gate)
        {
            foreach (var p in Map.Values)
            {
                if (!Present(p)) continue;
                var st = zm.State.GetValueOrDefault(p.Uid) ?? ZoneState.Blank();
                out_.Add(new ZoneInfo
                {
                    ZoneId = p.Uid, DisplayName = p.Name, State = st, Outputs = [OutputJson(p, st)],
                    IsPhone = true, DeviceId = p.DeviceId
                });
            }
        }
        return out_;
    }

    private static OutputInfo OutputJson(PhoneRec p, ZoneState st)
    {
        var v = st.VolumeValue ?? new Volume(null, false);
        return new OutputInfo
        {
            OutputId = p.Uid, ZoneId = p.Uid, DisplayName = p.Name, Model = "Phone", StereoPair = false, IsMuted = v.Muted,
            VolumeValue = v.Value, Step = p.VolumeSteps is > 0 ? 100 / p.VolumeSteps.Value : 1, CanGroupWith = [p.Uid]
        };
    }

    public QueueView Queue(string uid)
    {
        var p = Get(uid);
        lock (zm.Gate)
        {
            var st = zm.State.GetValueOrDefault(uid) ?? new ZoneState();
            var list = st.Local && p.Local != null ? p.Local : p.Queue;
            return new QueueView
            {
                Items = list.Select((it, i) => it.Entry(i + 1)).ToList(),
                Total = list.Count,
                Current = st.TrackNumber
            };
        }
    }
}
