// Dac.cs — the USB DACs on this computer, as the kernel lists them (/proc/asound): each USB sound card with a playback
// device, what it takes read from its stream0 (each altset's format and rates, as the server's Local/UsbFormats.cs
// reads them), and where the audio engine opens it (alsa:plughw:CARD=<id>,DEV=<n>). Native DSD is DSD_U32 words
// (the engine's), DoP the PCM rates DoP needs, in a slot of 24 bits or more. A Format line can name more than one
// format: Linux 6.x lists a DAC's raw-DSD altset as "Format: SPECIAL DSD_U32_BE" (item 325), and its DSD_U32 is read.
//
// Native DSD is the kernel's to offer (item 323): a DAC whose USB descriptor says it takes DSD as raw data (a UAC2
// streaming format with its RAW_DATA bit, as Mandarin's Android driver reads it, and plays natively) is listed with
// DSD_U32_BE only where the kernel's USB audio driver knows that DAC (its quirk table, QUIRK_FLAG_DSD_RAW, by maker);
// any other is given PCM formats alone, and its DSD goes as DoP. The descriptor is read here too (sysfs, which any
// user may read), and where it says raw DSD and the kernel lists none, the line that has the kernel offer it is said.
using System.Globalization;
using System.Text.RegularExpressions;

namespace Mandarin.Bridge;

/* One USB DAC: its card, its names, and what it takes. */
internal sealed record Dac(string Card, int Device, string Name, string Maker, string UsbId, List<int> Rates, List<int> Bits,
    string? NativeFormat, List<int> Native, List<int> Dop, bool RawDsd = false)
{
    /* Where its descriptor says it takes DSD as raw data and the kernel offers it none natively: the modprobe line
       (/etc/modprobe.d/) that has the kernel offer it, for this DAC alone (QUIRK_FLAG_DSD_RAW, bit 15); else null. */
    public string? KernelFix => RawDsd && Native.Count == 0 && UsbId.Split(':') is [{ Length: 4 } v, { Length: 4 } p]
        ? $"options snd-usb-audio vid=0x{v} pid=0x{p} quirk_flags=0x8000" : null;

    public string Location => $"alsa:plughw:CARD={Card},DEV={Device}";
    public string Key => UsbId.Length > 0 ? UsbId + "/" + Card : Card;

    /* The engine's word for its native DSD ("DSD_U32_BE:64,128"), "" for none. */
    public string EngineDsd => NativeFormat != null && Native.Count > 0 ? NativeFormat + ":" + string.Join(",", Native) : "";
}

internal static partial class Dacs
{
    public static readonly int[] PcmRates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];
    public static readonly int[] Multiples = [64, 128, 256, 512];

    [GeneratedRegex(@"^\s*([0-9]+)\s+\[(\S+)\s*\]:\s*(\S+)\s+-\s+(.*)$")]
    private static partial Regex CardLine();

    [GeneratedRegex(@"^\s*Format:\s*([^\n]+)", RegexOptions.Multiline)]
    private static partial Regex FormatLine();

    /* An altset's format, from its Format line's list: its native DSD where it names one (Linux 6.x lists a raw-DSD
       altset as "SPECIAL DSD_U32_BE", SPECIAL the kernel's word for it, item 325), else its first PCM format. */
    public static string FormatOf(string list)
    {
        var names = list.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return names.FirstOrDefault(n => n.StartsWith("DSD_U32", StringComparison.Ordinal))
            ?? names.FirstOrDefault(n => n.StartsWith("DSD_", StringComparison.Ordinal))
            ?? names.FirstOrDefault(n => n != "SPECIAL") ?? "";
    }

    [GeneratedRegex(@"Rates:\s*([^\n]+)")]
    private static partial Regex RatesLine();

    [GeneratedRegex(@"Bits:\s*([0-9]+)")]
    private static partial Regex BitsLine();

    [GeneratedRegex(@"^pcm([0-9]+)p$")]
    private static partial Regex Playback();

    private static string Read(string path)
    {
        try { return File.ReadAllText(path); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return ""; }
    }

    /* Every USB DAC the kernel lists under [root], its descriptor read under [sys]. */
    public static List<Dac> Find(string root = "/proc/asound", string sys = "/sys")
    {
        var found = new List<Dac>();
        var lines = Read(Path.Combine(root, "cards")).Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var m = CardLine().Match(lines[i]);
            if (!m.Success) continue;
            var dir = Path.Combine(root, "card" + m.Groups[1].Value);
            var usbid = Read(Path.Combine(dir, "usbid")).Trim();
            if (m.Groups[3].Value != "USB-Audio" && usbid.Length == 0) continue;
            int[] pcms;
            try { pcms = [.. Directory.EnumerateFileSystemEntries(dir).Select(e => Playback().Match(Path.GetFileName(e))).Where(x => x.Success).Select(x => int.Parse(x.Groups[1].Value, CultureInfo.InvariantCulture)).Order()]; }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { continue; }
            if (pcms.Length == 0) continue;
            var shortName = m.Groups[4].Value.Trim();
            var longName = i + 1 < lines.Length ? lines[i + 1].Trim() : "";
            var maker = Regex.Replace(Regex.Replace(longName, @"\s+at usb-.*$", ""), @"\s*" + Regex.Escape(shortName) + "$", "").Trim();
            found.Add(Of(m.Groups[2].Value, pcms[0], shortName, maker, usbid, Read(Path.Combine(dir, "stream0"))) with { RawDsd = RawDsd(Descriptors(sys, m.Groups[1].Value)) });
        }
        return found;
    }

    /* A DAC from its stream0 [stream]: the playback section's altsets. */
    public static Dac Of(string card, int device, string name, string maker, string usbid, string stream)
    {
        var playback = stream.Contains("Capture:", StringComparison.Ordinal) ? stream[..stream.IndexOf("Capture:", StringComparison.Ordinal)] : stream;
        var formats = FormatLine().Matches(playback);
        var pcmRates = new SortedSet<int>();
        var bits = new SortedSet<int>();
        var native = new Dictionary<string, SortedSet<int>>();
        for (var k = 0; k < formats.Count; k++)
        {
            var block = playback[formats[k].Index..(k + 1 < formats.Count ? formats[k + 1].Index : playback.Length)];
            var format = FormatOf(formats[k].Groups[1].Value);
            var rates = RatesLine().Match(block) is { Success: true } r
                ? r.Groups[1].Value.Split(',').Select(x => int.TryParse(x.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0).Where(n => n > 0).ToList() : [];
            if (format.StartsWith("DSD_U32", StringComparison.Ordinal))
            {
                var set = native.TryGetValue(format, out var s) ? s : native[format] = [];
                foreach (var mult in Multiples) if (rates.Contains(mult * 44100 / 32)) set.Add(mult);
                continue;
            }
            if (format.StartsWith("DSD_", StringComparison.Ordinal)) continue;
            foreach (var rate in rates) if (PcmRates.Contains(rate)) pcmRates.Add(rate);
            var b = BitsLine().Match(block) is { Success: true } bm ? int.Parse(bm.Groups[1].Value, CultureInfo.InvariantCulture) : SlotBits(format);
            if (b > 0) bits.Add(b);
        }
        var (fmt, nat) = native.Where(n => n.Value.Count > 0).Select(n => ((string?)n.Key, n.Value.ToList())).FirstOrDefault();
        var dop = bits.Count > 0 && bits.Max >= 24 ? Multiples.Where(m => pcmRates.Contains(m * 44100 / 16)).ToList() : [];
        return new Dac(card, device, name.Length > 0 ? name : card, maker, usbid, [.. pcmRates], [.. bits], fmt, nat ?? [], dop);
    }

    /* Card [n]'s USB device's descriptors (sysfs: the card's device is its USB interface, the device the folder above), or none. */
    private static byte[] Descriptors(string sys, string n)
    {
        try
        {
            var link = new DirectoryInfo(Path.Combine(sys, "class", "sound", "card" + n, "device"));
            var iface = link.ResolveLinkTarget(true)?.FullName ?? link.FullName;
            return File.ReadAllBytes(Path.Combine(Path.GetDirectoryName(iface) ?? iface, "descriptors"));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return []; }
    }

    /* Whether USB descriptors [d] have an audio streaming format (UAC2's AS_GENERAL, Type I) with its RAW_DATA bit: DSD as raw data. */
    public static bool RawDsd(byte[] d)
    {
        var uac2 = false;
        for (var i = 0; i + 1 < d.Length;)
        {
            int len = d[i], type = d[i + 1];
            if (len < 2 || i + len > d.Length) break;
            if (type == 4 && len >= 9) uac2 = d[i + 5] == 1 && d[i + 6] == 2 && d[i + 7] == 0x20;   // an audio streaming interface, UAC2's
            else if (type == 0x24 && uac2 && len >= 16 && d[i + 2] == 1 && d[i + 5] == 1 && (d[i + 9] & 0x80) != 0) return true;   // AS_GENERAL, Type I, bmFormats bit 31
            i += len;
        }
        return false;
    }

    private static int SlotBits(string format) => format switch { "S16_LE" => 16, "S24_3LE" or "S24_LE" => 24, "S32_LE" => 32, _ => 0 };
}
