// LocalDevices.cs — the sound devices on the computer Mandarin runs on
// (lib/local/devices.js, v0.8.49, stage 6 part 4), for Settings → Audio
// Devices: what they are called, the rates they say they take, and how the
// engine opens each one.
//
//   Linux   none (item 324): a USB DAC on the computer Mandarin runs on is
//           played by Mandarin Bridge for Linux, installed beside it, as a
//           room of its own (over SlimProto, its DAC read as any Bridge's).
//           The server no longer opens the computer's sound cards itself.
//   macOS   Core Audio: the output devices system_profiler lists, with the
//           rates each takes as the engine lists them (item 155; the one rate
//           the Mac has it set to until the engine is here). Opened as
//           coreaudio:<name>.
//
// A device's id comes from its name, so it is the same player after a restart
// or a replug.
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Playback;
using Mandarin.Server.Renderers;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Local;

using TJs = Mandarin.Server.Tags.Js;

/* list(): every device this computer has, as the register takes them. */
internal sealed class LocalList
{
    public List<SeenInfo> Devices = [];
    public int Hidden;
    public string Platform = "";
    public bool Off;
}

internal static class LocalDevices
{
    public const string Prefix = "LOCAL_";

    public static string IdOf(string key) => Prefix + Convert.ToHexString(Fingerprint.Sha1(Encoding.UTF8.GetBytes(key))).ToLowerInvariant()[..12];

    /* What a device says it takes: DSD that only DoP can carry, at the rates it takes, offered off (UsbFormats.cs, item 256). */
    private static JsObj Advertised(List<double> rates, List<double> bits)
    {
        var adv = Jv.Obj(("containers", new List<object?> { "flac" }), ("rates", rates.Cast<object?>().ToList()), ("bits", bits.Cast<object?>().ToList()));
        if (UsbFormats.DopMultiples(rates).Count > 0) ((List<object?>)adv["containers"]!).Add("dsd");
        return Jv.Obj(("advertised", adv));
    }

    /*
     * system_profiler's audio list (JSON) → the Mac's output devices; the rates each takes from the engine's
     * own list ([engine]: `mandarin-audio --devices`, a line of {name, rates: "44100,48000,…"} each; item 155)
     * where it is here, else the one rate the Mac has the device set to.
     */
    public static List<SeenInfo> ParseMac(string json, string? engine = null)
    {
        var takes = new Dictionary<string, List<double>>(StringComparer.Ordinal);
        foreach (var line in (engine ?? "").Split('\n'))
        {
            object? o = null;
            try { o = line.Trim().Length > 0 ? Scan.JsJson.Parse(line) : null; } catch (JsError) { /* not one */ }
            if (o is JsObj && Jv.T(Jv.Get(o, "name")) && Jv.Get(o, "rates") is string r)
                takes[Jv.Str(Jv.Get(o, "name"))] = r.Split(',').Select(x => double.TryParse(x, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : 0).Where(Profiles.Rates.Contains).ToList();
        }
        // ((JSON.parse(json).SPAudioDataType || [])[0] || {})._items || []
        object? parsed = null;
        try { parsed = Scan.JsJson.Parse(json); } catch (JsError) { /* not JSON: nothing listed */ }
        var first = Jv.Get(parsed, "SPAudioDataType") is List<object?> l && l.Count > 0 ? l[0] : null;
        var items = Jv.Get(first, "_items") as List<object?> ?? [];
        var out_ = new List<SeenInfo>();
        foreach (var it in items)
        {
            var name = Jv.Get(it, "_name");
            if (it is not JsObj || !Jv.T(name) || !(TJs.ToNumber(Jv.Get(it, "coreaudio_device_output")) > 0)) continue;
            var srate = TJs.ToNumber(Jv.Get(it, "coreaudio_device_srate")) is var sr && double.IsFinite(sr) ? sr : 0;
            var t = Jv.T(Jv.Get(it, "coreaudio_device_transport")) ? Jv.Str(Jv.Get(it, "coreaudio_device_transport")) : "";
            var transport = Regex.IsMatch(t, "usb") ? "USB audio" : Regex.IsMatch(t, "builtin|built-in") ? "Built-in" : Regex.IsMatch(t, "hdmi|displayport") ? "HDMI / DisplayPort"
                : Regex.IsMatch(t, "bluetooth") ? "Bluetooth" : Regex.IsMatch(t, "airplay") ? "AirPlay" : Regex.IsMatch(t, "virtual|aggregate") ? "Virtual" : "Core Audio";
            var nm = Jv.Str(name);
            out_.Add(new SeenInfo
            {
                Id = IdOf("coreaudio:" + nm), Kind = "local", Family = "local",
                NetworkName = nm, Manufacturer = Jv.T(Jv.Get(it, "coreaudio_device_manufacturer")) ? Jv.Str(Jv.Get(it, "coreaudio_device_manufacturer")) : "",
                Model = transport, Location = "coreaudio:" + nm, Playable = true,
                Caps = Advertised(takes.TryGetValue(nm, out var all) && all.Count > 0 ? all : Profiles.Rates.Contains(srate) ? [srate] : [], [16, 24, 32])
            });
        }
        return out_;
    }

    private static async Task<LocalList> ListMac()
    {
        var list = new LocalList { Platform = "darwin" };
        try
        {
            using var p = Process.Start(new ProcessStartInfo("system_profiler") { ArgumentList = { "SPAudioDataType", "-json" }, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false })!;
            var text = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            using var cts = new CancellationTokenSource(20000);
            // Not done in 20 s: let go of, not left behind (a Mac with no sound devices can keep it waiting).
            try { await p.WaitForExitAsync(cts.Token); }
            catch (OperationCanceledException) { try { p.Kill(true); } catch (InvalidOperationException) { /* gone */ } throw; }
            if (p.ExitCode == 0) list.Devices = ParseMac(await text, AudioEngine.Find() is { } e ? EngineDevices(e.Bin) : null);
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException or OperationCanceledException or InvalidOperationException) { /* none listed */ }
        return list;
    }

    /* The engine's own list of a Mac's devices and their rates (`mandarin-audio --devices`), or null. */
    private static string? EngineDevices(string bin)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo(bin, "--devices") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false })!;
            var text = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            if (p.WaitForExit(10000)) return p.ExitCode == 0 ? text.Result : null;
            try { p.Kill(true); } catch (InvalidOperationException) { /* gone */ }
            return null;
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException or InvalidOperationException) { return null; }
    }

    /* Every device this computer has, as the register takes them; off (none) where local audio is turned off. */
    public static async Task<LocalList> List(bool localAudio)
    {
        var platform = OperatingSystem.IsLinux() ? "linux" : OperatingSystem.IsMacOS() ? "darwin" : Environment.OSVersion.Platform.ToString().ToLowerInvariant();
        if (!localAudio) return new LocalList { Platform = platform, Off = true };
        if (OperatingSystem.IsMacOS()) return await ListMac();   // Linux: none (item 324), its USB DAC a Mandarin Bridge's
        return new LocalList { Platform = platform };
    }
}
