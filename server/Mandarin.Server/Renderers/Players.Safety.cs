// Players.Safety.cs — a device's Output put back to the last that played well, where what it is set to doesn't (bug
// list item 346).
//
// Set to more than the server can make in time (DSD512 by the ninth-order modulator on a small machine), a track made as
// it plays fell behind the device, which ran dry and stopped; set to more than the device takes (DSD to a player that
// takes none), it said it couldn't play the track (SlimProto's STMn) and the room stopped there. Either way the owner had
// to find out why and set it back. Now each device keeps the Output that last played well: a track 20 s in (or half
// through, if shorter), made at least KeepingUp.Room × real time where it was made, or nothing made at all. A making
// slower than real time over a whole window (KeepingUp.Behind), or a device that couldn't play what it was sent, puts
// that Output back, plays the track on under it from where it was, says so on the device's page, and keeps what failed:
// chosen again, the Output page says what happened last time (Devices.cs, MadeAsPlayed.Note). Never a stream of Qobuz's
// or Tidal's, which Mandarin makes nothing of; never when the owner has changed the Output since the track began.
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;
using TJs = Mandarin.Server.Tags.Js;

namespace Mandarin.Server.Renderers;

internal sealed partial class Players
{
    /* The Output settings kept and put back: what is made and sent; never the volume, the player or an album as one stream. */
    internal static readonly string[] OutputKeys = ["mode", "bits", "max_rate", "filter", "filter_hires", "phase", "dsd_lowpass", "dsd_out", "dsd_mod", "dither", "real_bits", "headroom"];
    /* The device settings: the Output that last played well; those that failed, the last few; and the last put back, to say. */
    public const string GoodSetting = "output_good", FailedSetting = "output_failed", PutBackSetting = "output_put_back";
    /* What a device that couldn't play what it was sent says (SlimProto's STMn). */
    public const string CouldNotPlay = "couldn't play the track";

    /* The Output part of device settings [s]. */
    public static JsObj OutputOf(JsObj? s)
    {
        var o = new JsObj();
        if (s != null) foreach (var k in OutputKeys) if (!Jv.Nullish(s[k])) o[k] = s[k];
        return o;
    }

    /* Device [id]'s Output now; null where it isn't a streamer. */
    public static JsObj? OutputNow(string id) => Record(id) is { } r && IsStreamer(r) ? OutputOf(r.Settings) : null;

    private static bool SameOutput(object? a, object? b) => a is JsObj x && b is JsObj y && TJs.Json(OutputOf(x)) == TJs.Json(OutputOf(y));

    private const string Original = "Original (nothing upsampled)";

    /* Output [o] in a few words: "DSD512, 9th-order modulator", "×4, Gaussian filter", "Original (nothing upsampled)". */
    internal static string OutputWords(JsObj? o)
    {
        if (o == null) return Original;
        var parts = new List<string>();
        var shape = Upsample.Shape.OfFilter(o["filter"], Upsample.Shape.MinimumOf(o));
        if (Upsample.DsdPlan.Of(o["dsd_out"]) is { } up) parts.Add($"DSD{up}, {Upsample.DsdOut.Words(Upsample.DsdOut.Of(o["dsd_mod"]))}");
        else if (o["mode"] is "x2" or "x4" or "max") parts.Add((o["mode"] is "max" ? "the highest rate" : "×" + ((string)o["mode"]!)[1..]) + (shape != null ? ", " + Upsample.Shape.Words(shape) : ""));
        if (o["bits"] is double b) parts.Add($"{Tags.Js.Num(b)}-bit");
        return parts.Count == 0 ? Original : string.Join(", ", parts);
    }

    /* The key of what is made as it plays for device [id]'s track playing (its album's run, where it plays one); null where nothing is. */
    public string? MakingOf(string id)
    {
        lock (gate)
            return map.TryGetValue(id, out var p) && p.Index >= 0 && p.Index < p.Queue.Count ? p.Run?.Key ?? MadeKey(p.Queue[p.Index]) : null;
    }

    /* Each read of [p] playing [item] [rel] s in: its Output kept as good, or put back where it falls behind. */
    private void Watch(Player p, UpnpItem item, double rel)
    {
        if (item.Output is not { } output || item.Track == null || StreamPlans.ServiceOf(item.Track.Path) != null) return;
        string? key;
        lock (gate) key = p.Run?.Key ?? MadeKey(item);
        var k = Upsample.KeepingUp.Of(key);
        if (Upsample.KeepingUp.Behind(k))
        {
            _ = PutBack(p, item, rel, $"was made at {Upsample.KeepingUp.Words(k!.Times)}, too slow to keep up").ContinueWith(t => Log("[renderers] " + t.Exception?.InnerException?.Message), TaskContinuationOptions.OnlyOnFaulted);
            return;
        }
        if (rel < Math.Min(20, Math.Max(1, item.Duration / 2))) return;
        if (key != null && k is not { Times: >= Upsample.KeepingUp.Room }) return;   // made before, or only just in time: nothing said of it
        var json = TJs.Json(output);
        lock (gate) { if (p.GoodOutput == json) return; p.GoodOutput = json; }
        using var c = Db.Open();
        if (!SameOutput(Register.Get(c, p.Id)?.Settings[GoodSetting], output)) Register.SetSettings(c, p.Id, Jv.Obj((GoodSetting, output)));
    }

    /* [p] couldn't play what it was sent ([message]): its Output put back, where there is one that played; false where there isn't. */
    private async Task<bool> CantPlay(Player p, string message)
    {
        if (!message.EndsWith(CouldNotPlay, StringComparison.Ordinal)) return false;
        UpnpItem? item;
        lock (gate) item = p.Index >= 0 && p.Index < p.Queue.Count ? p.Queue[p.Index] : null;
        return item?.Output != null && item.Track != null && StreamPlans.ServiceOf(item.Track.Path) == null
            && await PutBack(p, item, 0, "couldn't be played by the device");
    }

    /*
     * [p]'s Output, as [item] was made and sent by, failed ([why]): the one that last played well put back, the track played
     * on under it from [rel] s; once a track. False where there is none, it is the one that failed, or the owner changed it.
     */
    private async Task<bool> PutBack(Player p, UpnpItem item, double rel, string why)
    {
        lock (gate) { if (p.PutBackFor == item.Uri) return false; p.PutBackFor = item.Uri; }
        var name = RendererOf(p).Name;
        DeviceRecord? r;
        using (var c = Db.Open()) r = Register.Get(c, p.Id);
        var good = r?.Settings[GoodSetting] as JsObj;
        if (r == null || !SameOutput(OutputOf(r.Settings), item.Output)) return false;
        if (good == null || SameOutput(good, item.Output))
        {
            Log($"[renderers] {name}: {OutputWords(item.Output)} {why}, and there is no Output that played well to put back");
            return false;
        }
        var message = $"{OutputWords(item.Output)} {why}: the Output is back to {OutputWords(good)}, the last that played well";
        var patch = new JsObj();
        foreach (var key in OutputKeys) patch[key] = good[key];
        var failed = (r.Settings[FailedSetting] as List<object?> ?? []).Where(f => !SameOutput(Jv.Get(f, "output"), item.Output)).TakeLast(4).ToList();
        failed.Add(Jv.Obj(("output", item.Output), ("why", why), ("at", Hub.Now())));
        patch[FailedSetting] = failed;
        patch[PutBackSetting] = Jv.Obj(("at", Hub.Now()), ("message", message));
        using (var c = Db.Open()) Register.SetSettings(c, p.Id, patch);
        Log($"[renderers] {name}: {message}");
        await zm.DeviceChanged(p.Id, ["output"]);
        int index;
        lock (gate) index = p.Index;
        if (await Replan(p.Id)) await Jump(p, index, rel);
        return true;
    }

    /* What device settings [s] say of Output [o] having failed before ("Last time DSD512, … was made at 0.8× real time…"); null where it hasn't. */
    public static string? FailedBefore(JsObj s, JsObj o) =>
        (s[FailedSetting] as List<object?> ?? []).LastOrDefault(f => SameOutput(Jv.Get(f, "output"), o)) is { } f
            ? $"Last time {OutputWords(o)} {Jv.Str(Jv.Get(f, "why"))}, and the Output was put back." : null;
}
