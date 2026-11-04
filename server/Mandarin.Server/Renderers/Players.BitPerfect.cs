// Players.BitPerfect.cs — the bit-perfect check of a renderer's room (bug list item 275, BitPerfect/Check.cs): asked
// for the track playing, of a Mandarin USB renderer whose app records what it feeds its DAC (/dac.json says
// "capture"). One at a time for each room; its progress and its report are the room's until the next.
using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Mandarin.Server.BitPerfect;
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

internal sealed partial class Players
{
    private readonly ConcurrentDictionary<string, (Check.Run Run, string Title)> checks = new();

    /* Room [id]'s check begun for the track playing; null and why not, where it can't be. */
    public async Task<(bool Ok, string Said)> CheckBitPerfect(string id)
    {
        var p = Get(id);
        if (checks.TryGetValue(id, out var was) && was.Run.State is "starting" or "recording" or "comparing") return (false, "A check is already under way");
        var rec = Record(id);
        if (rec?.Caps["mandarin"] is not JsObj mu || !Jv.T(mu["base"])) return (false, "Only a Mandarin USB renderer can record what its DAC is fed (or a DAC on this server, soon)");
        var device = Jv.Str(mu["base"]);
        var dac = await MandarinUsb.Probe(device);
        if (dac == null) return (false, "The device isn't answering");
        if (dac["capture"] is not string capture || capture.Length == 0) return (false, "This device's app can't record what it feeds the DAC yet: update Mandarin USB");
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
        var room = new Check.Room(() => Jump(p, index), () => { lock (gate) return p.Index == index && p.Queue.Count > index && p.Queue[index] == item; }, rec.Name ?? rec.NetworkName ?? id);
        var run = new Check.Run();
        checks[id] = (run, item.Title);
        var dir = Path.Combine(Server.DataDir, "bitperfect", string.Concat(id.Select(c => char.IsLetterOrDigit(c) ? c : '_')));
        _ = Task.Run(async () =>
        {
            await Check.Go(run, track, room, CaptureBase(device, capture), dir);
            zm.Bump();
            if (run.Report != null) Log($"[bitperfect] {room.Name}, {item.Title}: {run.Report["says"]}");
            else Log($"[bitperfect] {room.Name}, {item.Title}: {run.Said}");
        });
        return (true, run.Said);
    }

    // Where the device's /capture is: [said] ("/capture", or a whole address) under the device's [device] address, less "/capture".
    private static string CaptureBase(string device, string said)
    {
        var at = said.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? said : device.TrimEnd('/') + "/" + said.TrimStart('/');
        return at.EndsWith("/capture", StringComparison.Ordinal) ? at[..^"/capture".Length] : at.TrimEnd('/');
    }

    /* Room [id]'s check: where it is, and its report once done; null where none was asked for. */
    public JsonObject? BitPerfectOf(string id)
    {
        if (!checks.TryGetValue(id, out var c)) return null;
        return new JsonObject { ["state"] = c.Run.State, ["says"] = c.Run.Said, ["track"] = c.Title, ["report"] = c.Run.Report?.DeepClone() };
    }

    /* Room [id]'s check stopped. */
    public void StopBitPerfect(string id)
    {
        if (checks.TryGetValue(id, out var c)) c.Run.Stop.Cancel();
    }
}
