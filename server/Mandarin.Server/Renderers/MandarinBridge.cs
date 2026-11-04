// MandarinBridge.cs — a Mandarin Bridge renderer (bridge/, once Mandarin USB, item 281):
// an Android device with a USB DAC on its port, driven by Mandarin's own USB
// Audio driver, playing as a UPnP renderer. UPnP says what it accepts only as
// containers and the odd raw-PCM rate; the device itself says everything at
// /dac.json — every sample rate and depth the DAC takes, the DSD multiples
// it can be given natively or as DoP — and what it is feeding the DAC right
// now, rate, depth and DSD, which is how a track is confirmed to have reached
// the DAC as sent (the ✓ on Now playing, as a WiiM's own API gives it).
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

internal static class MandarinBridge
{
    public const string Model = "Mandarin Bridge";

    /* What the app was called before (item 281): an app not yet updated says it, and is the same renderer. */
    public const string WasModel = "Mandarin USB";

    /* Is this description a Mandarin Bridge renderer's (or a Mandarin USB one's)? Its model name says so. */
    public static bool Is(string manufacturer, string modelName)
    {
        var m = modelName.Trim();
        if (m.Equals(Model, StringComparison.OrdinalIgnoreCase) || m.Equals(WasModel, StringComparison.OrdinalIgnoreCase)) return true;
        return manufacturer.Trim().Equals("Mandarin", StringComparison.OrdinalIgnoreCase)
            && (m.Contains("Bridge", StringComparison.OrdinalIgnoreCase) || m.Contains("USB", StringComparison.OrdinalIgnoreCase));
    }

    /* GET <base>/dac.json → what it says, or null when it isn't there or isn't JSON. */
    public static async Task<JsObj?> Probe(string baseUrl, int timeoutMs = 3000)
    {
        string text;
        try { text = await SoapHttp.HttpGet(baseUrl + "/dac.json", timeoutMs); }
        catch (UPnPError) { return null; }
        try { return Scan.JsJson.Parse(text) as JsObj; }
        catch (JsError) { return null; }
    }

    private static List<object?> Numbers(object? list, double[] allowed) =>
        (list as List<object?> ?? []).Select(Jv.Num).Where(n => allowed.Contains(n)).Distinct().OrderBy(n => n).Select(n => (object?)n).ToList();

    /*
     * The advertised layer, filled from what the device said: the rates, depths and DSD multiples the DAC takes
     * (those Mandarin knows), and "dsd" among the containers where it takes any DSD. Rates read from the Sink's
     * raw-PCM entries are kept where the device says none.
     */
    public static void Advertise(JsObj advertised, JsObj dac)
    {
        var d = dac["dac"] as JsObj ?? dac;
        var rates = Numbers(d["rates"], Profiles.Rates);
        var bits = Numbers(d["bits"], Profiles.Bits);
        var dsd = Numbers(d["dsd"], Profiles.Dsd);
        if (rates.Count > 0) advertised["rates"] = rates;
        if (bits.Count > 0) advertised["bits"] = bits;
        advertised["dsd"] = dsd;
        var containers = advertised["containers"] as List<object?> ?? [];
        if (dsd.Count > 0 && !containers.Exists(c => Jv.Same(c, "dsd"))) containers.Add("dsd");
        advertised["containers"] = containers;
    }

    /*
     * What the device said of its DAC, kept with the device (caps.mandarin): where to ask, and — while a DAC is on its
     * port — the rates, depths and DSD multiples it takes (those Mandarin knows) and how its volume goes: "fixed" for a
     * DAC with no USB volume control or one set to fixed on the device, else "upnp" (Mandarin's slider drives it).
     */
    public static JsObj Said(string baseUrl, JsObj dac)
    {
        var d = dac["dac"] as JsObj ?? dac;
        var o = Jv.Obj(("base", baseUrl));
        // Where its app records what it feeds the DAC (/capture, item 275): the bit-perfect check is offered where it can.
        if (dac["capture"] is string capture && capture.Length > 0) o["capture"] = capture;
        var rates = Numbers(d["rates"], Profiles.Rates);
        if (rates.Count == 0) return o;   // no DAC on the port (or not yet allowed): nothing said of one
        o["rates"] = rates;
        o["bits"] = Numbers(d["bits"], Profiles.Bits);
        o["dsd"] = Numbers(d["dsd"], Profiles.Dsd);
        o["volume"] = Jv.T(d["volume_control"]) && !Jv.T(d["fixed"]) ? "upnp" : "fixed";
        return o;
    }

    /* The device's word on its DAC (Said), from a register row's caps: null where it has said none. */
    public static JsObj? Reported(object? caps) =>
        Prop.Get(caps, "mandarin") is JsObj mu && mu["rates"] is List<object?> { Count: > 0 } ? mu : null;

    /*
     * What the device is feeding the DAC: the rate, the bits of the words the DAC is opened at, the DSD multiple, the
     * kind (pcm, dop, dsd); and since item 287 how its level is set ("fixed", "dac", "software"), the level, and whether
     * the samples go to the DAC untouched (null from an app that doesn't say).
     */
    public sealed record Now(double Rate, double Bits, double Dsd, string Kind = "pcm", string? Volume = null, double Level = 0, bool? Untouched = null);

    /* What the device is feeding the DAC, from /dac.json's "now"; null while nothing plays. */
    public static Now? Playing(JsObj dac)
    {
        if (dac["now"] is not JsObj n) return null;
        var rate = Jv.Num(n["rate"]); var bits = Jv.Num(n["bits"]); var dsd = Jv.Num(n["dsd"]);
        if (!(rate > 0)) return null;
        var level = Jv.Num(n["level"]);
        return new Now(rate, double.IsNaN(bits) ? 0 : bits, double.IsNaN(dsd) ? 0 : dsd, n["kind"] is string k ? k : dsd > 0 ? "dsd" : "pcm",
            n["volume"] as string, double.IsNaN(level) ? 0 : level, n["untouched"] is bool u ? u : null);
    }
}
