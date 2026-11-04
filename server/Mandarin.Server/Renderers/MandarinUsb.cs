// MandarinUsb.cs — a Mandarin USB renderer (github.com/meltface-80/Android-USB-Driver):
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

internal static class MandarinUsb
{
    public const string Model = "Mandarin USB";

    /* Is this description a Mandarin USB renderer's? Its model name says so. */
    public static bool Is(string manufacturer, string modelName) =>
        modelName.Trim().Equals(Model, StringComparison.OrdinalIgnoreCase) || manufacturer.Trim().Equals("Mandarin", StringComparison.OrdinalIgnoreCase) && modelName.Contains("USB", StringComparison.OrdinalIgnoreCase);

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

    public sealed record Now(double Rate, double Bits, double Dsd);

    /* What the device is feeding the DAC, from /dac.json's "now"; null while nothing plays. */
    public static Now? Playing(JsObj dac)
    {
        if (dac["now"] is not JsObj n) return null;
        var rate = Jv.Num(n["rate"]); var bits = Jv.Num(n["bits"]); var dsd = Jv.Num(n["dsd"]);
        if (!(rate > 0)) return null;
        return new Now(rate, double.IsNaN(bits) ? 0 : bits, double.IsNaN(dsd) ? 0 : dsd);
    }
}
