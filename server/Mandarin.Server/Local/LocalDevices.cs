// LocalDevices.cs — the sound devices on the computer Mandarin runs on
// (lib/local/devices.js, v0.8.49, stage 6 part 4), for Settings → Audio
// Devices: what they are called, the rates they say they take, and how the
// engine opens each one.
//
//   Linux   ALSA: the cards in /proc/asound with a playback device that
//           /dev/snd lets this program open (in Docker, only with
//           --device /dev/snd). A USB DAC lists its rates and depths in its
//           stream file; others take 44.1 and 48 kHz until you tick more.
//           Opened as plughw:CARD=<id>,DEV=<n> — by the card's name, so a
//           DAC plugged into another port is still the same device.
// Linux alone since v1.0.3, when Mac support was dropped (v0.8.49 to v1.0.2
// listed a Mac's Core Audio outputs, counted and not offered).
//
// A device's id comes from its name and its device number, so it
// is the same player after a restart or a replug.
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

    private static string Read(string f)
    {
        try { return File.ReadAllText(f); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return ""; }
    }

    /* "Rates: 44100, 48000, 96000" or "Rates: 8000 - 192000 (continuous)". */
    public static List<double> RatesIn(string text)
    {
        var out_ = new HashSet<double>();
        foreach (Match m in Regex.Matches(text, @"Rates:\s*([^\n]+)"))
        {
            var r = Regex.Match(m.Groups[1].Value, @"([0-9]+)\s*-\s*([0-9]+)\s*\(continuous\)");
            if (r.Success)
            {
                var lo = double.Parse(r.Groups[1].Value, CultureInfo.InvariantCulture); var hi = double.Parse(r.Groups[2].Value, CultureInfo.InvariantCulture);
                foreach (var hz in Profiles.Rates) if (hz >= lo && hz <= hi) out_.Add(hz);
                continue;
            }
            foreach (var n in m.Groups[1].Value.Split(',')) { var hz = TJs.StringToNumber(TJs.Trim(n)); if (Profiles.Rates.Contains(hz)) out_.Add(hz); }
        }
        return Profiles.Rates.Where(out_.Contains).ToList();
    }

    /* "Bits: 24" lines, or the formats where a card has none. */
    public static List<double> BitsIn(string text)
    {
        var out_ = new HashSet<double>();
        foreach (Match m in Regex.Matches(text, @"Bits:\s*([0-9]+)")) out_.Add(double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture));
        if (out_.Count == 0) foreach (Match m in Regex.Matches(text, @"Format:\s*S(16|24|32)")) out_.Add(double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture));
        return Profiles.Bits.Where(out_.Contains).ToList();
    }

    private static JsObj Advertised(List<double> rates, List<double> bits) =>
        Jv.Obj(("advertised", Jv.Obj(("containers", new List<object?> { "flac" }), ("rates", rates.Cast<object?>().ToList()), ("bits", bits.Cast<object?>().ToList()))));

    /* The ALSA playback devices this program can open. */
    public static LocalList ListLinux(string root = "/proc/asound", string dev = "/dev/snd")
    {
        var cards = Read(Path.Combine(root, "cards"));
        var list = new LocalList { Platform = "linux" };
        var lines = cards.Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var m = Regex.Match(lines[i], @"^\s*([0-9]+)\s+\[(\S+)\s*\]:\s*(\S+)\s+-\s+(.*)$");
            if (!m.Success) continue;
            string num = m.Groups[1].Value, cardId = m.Groups[2].Value, driver = m.Groups[3].Value, shortName = TJs.Trim(m.Groups[4].Value);
            var longName = TJs.Trim(i + 1 < lines.Length ? lines[i + 1] : "");
            var dir = Path.Combine(root, "card" + num);
            List<string> entries;
            try { entries = new DirectoryInfo(dir).EnumerateFileSystemInfos().Select(e => e.Name).ToList(); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { continue; }
            var pcms = entries.Select(e => Regex.Match(e, "^pcm([0-9]+)p$")).Where(x => x.Success).Select(x => int.Parse(x.Groups[1].Value, CultureInfo.InvariantCulture)).OrderBy(x => x).ToList();
            var usb = driver == "USB-Audio" || entries.Contains("usbid");
            foreach (var d in pcms)
            {
                if (!Path.Exists(Path.Combine(dev, $"pcmC{num}D{d}p"))) { list.Hidden++; continue; }
                var pcmName = Regex.Match(Read(Path.Combine(dir, $"pcm{d}p", "info")), @"^name:\s*(.*)$", RegexOptions.Multiline) is { Success: true } pm ? pm.Groups[1].Value : "";
                var stream = Read(Path.Combine(dir, "stream" + (usb ? 0 : d)));
                var name = pcms.Count > 1 && pcmName.Length > 0 ? $"{shortName} ({TJs.Trim(pcmName)})" : shortName;
                var maker = usb ? TJs.Trim(Regex.Replace(Regex.Replace(longName, @"\s+at usb-.*$", ""), @"\s*" + Regex.Escape(shortName) + "$", "")) : "";
                list.Devices.Add(new SeenInfo
                {
                    Id = IdOf($"alsa:{cardId}:{d}"), Kind = "local", Family = "local",
                    NetworkName = name, Manufacturer = maker, Model = usb ? "USB audio" : driver, Location = $"alsa:plughw:CARD={cardId},DEV={d}",
                    Playable = true, Caps = Advertised(RatesIn(stream), BitsIn(stream))
                });
            }
        }
        return list;
    }

    /* What ALSA has the device open at, while it plays: { rate, format }. Linux only; null elsewhere or when it isn't open. */
    public static (double Rate, string Format)? HwParams(string? location, string root = "/proc/asound")
    {
        var m = Regex.Match(location ?? "", @"^alsa:plughw:CARD=([^,]+),DEV=([0-9]+)$");
        if (!m.Success) return null;
        var card = Read(Path.Combine(root, "cards")).Split('\n').Select(l => Regex.Match(l, @"^\s*([0-9]+)\s+\[(\S+)\s*\]")).FirstOrDefault(x => x.Success && x.Groups[2].Value == m.Groups[1].Value);
        if (card == null) return null;
        var t = Read(Path.Combine(root, "card" + card.Groups[1].Value, $"pcm{m.Groups[2].Value}p", "sub0", "hw_params"));
        var rate = Regex.Match(t, @"^rate:\s*([0-9]+)", RegexOptions.Multiline) is { Success: true } rm ? double.Parse(rm.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
        return rate != 0 ? (rate, Regex.Match(t, @"^format:\s*(\S+)", RegexOptions.Multiline) is { Success: true } fm ? fm.Groups[1].Value : "") : null;
    }

    /* Every device this computer has, as the register takes them; off (none) where local audio is turned off. */
    public static Task<LocalList> List(bool localAudio)
    {
        var platform = OperatingSystem.IsLinux() ? "linux" : Environment.OSVersion.Platform.ToString().ToLowerInvariant();
        if (!localAudio) return Task.FromResult(new LocalList { Platform = platform, Off = true });
        return Task.FromResult(OperatingSystem.IsLinux() ? ListLinux() : new LocalList { Platform = platform });
    }
}
