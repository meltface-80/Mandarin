// SlimDevices.cs — a SlimProto player as a device of Mandarin's (bug list item 312): its record in the register
// (Playback/Register.cs), kind "slim", made from what it said in its hello — its name, its model, its address, and
// what it plays: the codecs it named (flc FLAC, dsf and dff DSD, pcm, …) and the highest rate it said (MaxSampleRate),
// every rate Mandarin plays up to that one. The owner turns rates, depths and DSD on and off on its page as for any
// streamer.
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers.Slim;

internal static class SlimDevices
{
    public const string Kind = "slim";

    /* What [p] says of itself, as the register keeps a device. */
    public static SeenInfo InfoOf(SlimPlayer p)
    {
        var (pairs, words) = p.Helo.Caps();
        var model = pairs.TryGetValue("ModelName", out var mn) && mn.Length > 0 ? mn : pairs.TryGetValue("Model", out var m) ? m : "Squeezelite";
        return new SeenInfo
        {
            Id = p.Id, Kind = Kind, Family = "slimproto",
            NetworkName = p.Name, Manufacturer = pairs.TryGetValue("Model", out var maker) ? maker : "SlimProto", Model = model,
            Firmware = pairs.TryGetValue("Firmware", out var fw) ? fw : "", Ip = p.Ip, Location = "slim:" + p.Id,
            Playable = true, Openhome = false, Services = new JsObj(), Events = new JsObj(),
            Caps = Jv.Obj(("advertised", Advertised(pairs, words))),
        };
    }

    /* The formats a player's capabilities name, in the shape a renderer's GetProtocolInfo is kept in. */
    public static JsObj Advertised(IReadOnlyDictionary<string, string> pairs, IReadOnlyList<string> words)
    {
        var max = pairs.TryGetValue("MaxSampleRate", out var ms) && double.TryParse(ms, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var mx) && mx > 0 ? mx : 48000;
        var rates = Profiles.Rates.Where(r => r <= max).Select(r => (object?)r).ToList();
        var mimes = new List<object?>();
        var containers = new List<object?>();
        if (words.Contains("flc")) { mimes.Add("audio/flac"); containers.Add("flac"); }
        var dsd = words.Contains("dsf") || words.Contains("dff");
        if (dsd) { mimes.Add("audio/x-dsf"); mimes.Add("audio/x-dff"); containers.Add("dsd"); }
        return Jv.Obj(("mimes", mimes), ("containers", containers), ("rates", rates),
            ("bits", Profiles.Bits.Select(b => (object?)b).ToList()),
            ("dsd", dsd ? Profiles.Dsd.Select(d => (object?)d).ToList() : new List<object?>()),
            ("raw", Raw(pairs, words)));
    }

    private static string Raw(IReadOnlyDictionary<string, string> pairs, IReadOnlyList<string> words) =>
        string.Join(',', pairs.Select(kv => kv.Key + "=" + kv.Value).Concat(words));
}
