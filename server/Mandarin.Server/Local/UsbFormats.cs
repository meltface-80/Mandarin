// UsbFormats.cs — what a USB DAC says it takes (bug list item 256), from its descriptor as the kernel lists it in
// /proc/asound/cardN/stream0: an "Altset" a format, each with the rates it takes.
//
//   Interface 1
//     Altset 1
//     Format: S32_LE
//     Rates: 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000
//   Interface 1
//     Altset 3
//     Format: DSD_U32_BE
//     Rates: 88200, 176400, 352800
//
// A PCM format's rates are the PCM rates; a DSD format's are its words a second, 32 DSD bits a word for DSD_U32
// (88.2 kHz is DSD64), so they are the native DSD the DAC takes, not PCM rates. The engine sends native DSD as
// 32-bit words (DSD_U32_BE or DSD_U32_LE); a DAC that lists only DSD_U16 or DSD_U8 has its DSD sent as DoP instead.
// DoP can't be read from a descriptor (the DAC sees PCM), so it is never assumed: a DAC that takes the rate DoP needs
// (176.4 kHz for DSD64) is offered DSD, off until its owner ticks it or a profile says the model plays DoP.
using System.Globalization;
using System.Text.RegularExpressions;
using Mandarin.Server.Playback;
using Mandarin.Server.Renderers;

namespace Mandarin.Server.Local;

internal static partial class UsbFormats
{
    /* One altset: its format and its rates. */
    public sealed record Altset(string Format, List<double> Rates);

    [GeneratedRegex(@"^\s*Format:\s*(\S+)", RegexOptions.Multiline)]
    private static partial Regex FormatLine();

    [GeneratedRegex(@"Rates:\s*([^\n]+)")]
    private static partial Regex RatesLine();

    /* The altsets of a stream file, in order. */
    public static List<Altset> Altsets(string stream)
    {
        var out_ = new List<Altset>();
        var formats = FormatLine().Matches(stream);
        for (var i = 0; i < formats.Count; i++)
        {
            var from = formats[i].Index;
            var to = i + 1 < formats.Count ? formats[i + 1].Index : stream.Length;
            var block = stream[from..to];
            var rates = RatesLine().Match(block) is { Success: true } m ? LocalDevices.RatesIn(m.Value) : [];
            out_.Add(new Altset(formats[i].Groups[1].Value, rates));
        }
        return out_;
    }

    /* The PCM rates: those of its PCM altsets, or every rate it lists where it names no formats. */
    public static List<double> PcmRates(string stream)
    {
        var sets = Altsets(stream);
        if (sets.Count == 0) return LocalDevices.RatesIn(stream);
        var pcm = sets.Where(a => !a.Format.StartsWith("DSD_", StringComparison.Ordinal)).SelectMany(a => a.Rates).ToHashSet();
        return Profiles.Rates.Where(pcm.Contains).ToList();
    }

    /* The native DSD it takes as 32-bit words: the format the engine opens it in, and the multiples (64 for DSD64). */
    public static (string Format, List<double> Multiples)? Native(string stream)
    {
        foreach (var name in new[] { "DSD_U32_BE", "DSD_U32_LE" })
        {
            var rates = Altsets(stream).Where(a => a.Format == name).SelectMany(a => a.Rates).ToHashSet();
            var n = Profiles.Dsd.Where(m => rates.Contains(m * 44100 / 32)).ToList();
            if (n.Count > 0) return (name, n);
        }
        return null;
    }

    /* The multiples DoP can carry at the PCM rates it takes: DSD64 at 176.4 kHz, DSD128 at 352.8, DSD256 at 705.6. */
    public static List<double> DopMultiples(List<double> pcmRates) => Profiles.Dsd.Where(m => pcmRates.Contains(m * 44100 / 16)).ToList();

    /* The engine's word for a device's native DSD ("DSD_U32_BE:64,128"), from its advertised capabilities; "" for none. */
    public static string EngineArg(object? caps)
    {
        var adv = Jv.Get(caps, "advertised");
        if (Jv.Get(adv, "dsd_format") is not string f || Jv.Get(adv, "dsd") is not List<object?> l || l.Count == 0) return "";
        return f + ":" + string.Join(",", l.Select(x => Jv.Num(x).ToString(CultureInfo.InvariantCulture)));
    }
}
