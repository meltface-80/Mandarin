// UsbFormats.cs — DSD for a sound device on the computer Mandarin runs on (bug list item 256): a Mac's, through Core
// Audio, now Linux's sound cards are a Mandarin Bridge's to play (item 324). DoP can't be read from what a device says
// (it sees PCM), so it is never assumed: a device that takes the rate DoP needs (176.4 kHz for DSD64) is offered DSD,
// off until its owner ticks it or a profile says the model plays DoP. A device whose advertised capabilities name its
// native DSD (dsd_format, dsd) has it sent so by the engine, as 32-bit words.
using System.Globalization;
using Mandarin.Server.Playback;
using Mandarin.Server.Renderers;

namespace Mandarin.Server.Local;

internal static class UsbFormats
{
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
