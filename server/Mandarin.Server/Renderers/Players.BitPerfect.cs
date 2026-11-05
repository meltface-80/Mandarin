// Players.BitPerfect.cs — the bit-perfect check of a renderer's room (bug list item 275, BitPerfect/Check.cs): asked
// for the track playing, of a Mandarin Bridge renderer whose app records what it feeds its DAC (/dac.json says
// "capture"), or of a USB DAC plugged into this server, recorded off its bus (BitPerfect/UsbRecorder.cs). One at a
// time for each room; its progress and its report are the room's until the next, kept beside the data (BitPerfect/Kept.cs,
// item 286) so that the verdict outlasts the track and a restart.
using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Mandarin.Server.BitPerfect;
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

internal sealed partial class Players
{
    private static readonly ConcurrentDictionary<string, (Check.Run Run, string Title, string Uri)> checks = new();

    /* Room [id]'s check begun for the track playing; null and why not, where it can't be. */
    public async Task<(bool Ok, string Said)> CheckBitPerfect(string id)
    {
        var p = Get(id);
        if (checks.TryGetValue(id, out var was) && was.Run.State is "starting" or "recording" or "comparing") return (false, "A check is already under way");
        var rec = Record(id);
        var dir = Path.Combine(Server.DataDir, "bitperfect", string.Concat(id.Select(c => char.IsLetterOrDigit(c) ? c : '_')));
        var (recorder, cant) = await RecorderFor(id, dir);
        if (recorder == null) return (false, cant);
        UpnpItem item;
        int index;
        lock (gate)
        {
            if (p.Index < 0 || p.Index >= p.Queue.Count) return (false, "Nothing is playing");
            index = p.Index;
            item = p.Queue[index];
        }
        if (item.Sent == null || item.Duration <= 0) return (false, "What was sent of this track isn't known yet: let it play a moment");
        var track = new Check.Track(item.Uri, item.Title, item.Duration, item.Sent.Rate, item.Sent.Bits, item.Sent.Dsd, item.Sent.DsdBase);
        var room = new Check.Room(() => Jump(p, index), () => { lock (gate) return p.Index == index && p.Queue.Count > index && p.Queue[index] == item; }, rec?.Name ?? rec?.NetworkName ?? id);
        var run = new Check.Run();
        run.Changed = zm.Bump;
        checks[id] = (run, item.Title, item.Uri);
        _ = Task.Run(async () =>
        {
            await Check.Go(run, track, room, recorder, dir);
            zm.Bump();
            if (run.Report != null) Kept.Save(Server.DataDir, id, item.Title, item.Uri, run.Report);
            if (run.Report != null) Log($"[bitperfect] {room.Name}, {item.Title}: {run.Report["says"]}");
            else Log($"[bitperfect] {room.Name}, {item.Title}: {run.Said}");
        });
        return (true, run.Said);
    }

    /*
     * What records what room [id]'s DAC is fed, into [dir]: a DAC on this server off its USB bus, a Mandarin Bridge
     * renderer at its /capture; else null, and why not. Asks nothing of the device but its /dac.json.
     */
    public async Task<(IRecorder? Recorder, string Why)> RecorderFor(string id, string dir)
    {
        var rec = Record(id);
        if (rec?.Location is { } loc && loc.StartsWith("alsa:", StringComparison.Ordinal))
        {
            // A DAC on this server: what goes down its USB cable, off the bus.
            if (Usbmon.Of(loc) is not { } usb) return (null, "This sound device isn't a USB DAC: what goes down a USB cable is what is recorded");
            if (UsbRecorder.Why(usb) is { } why) return (null, "The USB bus can't be read: " + why);
            return (new UsbRecorder(usb, dir, () => HwParams(loc)), "");
        }
        if (rec?.Caps["mandarin"] is not JsObj mu || !Jv.T(mu["base"])) return (null, "Only a Mandarin Bridge renderer or a USB DAC on this server can record what its DAC is fed");
        var device = Jv.Str(mu["base"]);
        var dac = await MandarinBridge.Probe(device);
        if (dac == null) return (null, "The device isn't answering");
        if (dac["capture"] is not string capture || capture.Length == 0) return (null, "This device's app can't record what it feeds the DAC yet: update Mandarin Bridge");
        return (new DeviceRecorder(CaptureBase(device, capture), Jv.T(dac["capture_parts"])), "");
    }

    /* Room [id]'s name, as its device or the user named it. */
    public string NameOf(string id) => Record(id) is { } rec ? rec.Name ?? rec.NetworkName ?? id : id;

    // Where the device's /capture is: [said] ("/capture", or a whole address) under the device's [device] address, less "/capture".
    private static string CaptureBase(string device, string said)
    {
        var at = said.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? said : device.TrimEnd('/') + "/" + said.TrimStart('/');
        return at.EndsWith("/capture", StringComparison.Ordinal) ? at[..^"/capture".Length] : at.TrimEnd('/');
    }

    /* Room [id]'s check: where it is, and its report once done; null where none was asked for. */
    public JsonObject? BitPerfectOf(string id)
    {
        if (checks.TryGetValue(id, out var c)) return new JsonObject { ["state"] = c.Run.State, ["says"] = c.Run.Said, ["track"] = c.Title, ["report"] = c.Run.Report?.DeepClone() };
        // None since the server started: the last one kept.
        if (Kept.Of(Server.DataDir, id) is not { } k) return null;
        return new JsonObject { ["state"] = "done", ["says"] = (string?)k.Report["says"], ["track"] = k.Title, ["report"] = k.Report.DeepClone() };
    }

    /* Room [id]'s check stopped. */
    public void StopBitPerfect(string id)
    {
        if (checks.TryGetValue(id, out var c)) c.Run.Stop.Cancel();
    }
}
