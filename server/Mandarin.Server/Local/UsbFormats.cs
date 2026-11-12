// UsbFormats.cs — DSD for a sound device on the computer Mandarin runs on (bug list item 256), now Linux's sound cards
// are a Mandarin Bridge's to play (item 324). A device whose advertised capabilities name its native DSD (dsd_format,
// dsd) has it sent so by the engine, as 32-bit words.
using System.Globalization;
using Mandarin.Server.Playback;

namespace Mandarin.Server.Local;

internal static class UsbFormats
{
    /* The engine's word for a device's native DSD ("DSD_U32_BE:64,128"), from its advertised capabilities; "" for none. */
    public static string EngineArg(object? caps)
    {
        var adv = Jv.Get(caps, "advertised");
        if (Jv.Get(adv, "dsd_format") is not string f || Jv.Get(adv, "dsd") is not List<object?> l || l.Count == 0) return "";
        return f + ":" + string.Join(",", l.Select(x => Jv.Num(x).ToString(CultureInfo.InvariantCulture)));
    }
}
