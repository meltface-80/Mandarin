// DeviceRoutes.Dither.cs — a device's dither and its DAC's real bits written (bug list item 301, Upsample/Dither.cs),
// beside the rest of its Output (DeviceRoutes.cs): flat, ns3 or ns5, flat kept as its absence; 20 to 23 bits, or
// "sent", kept as its absence.
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

internal static partial class Library
{
    /* The dither and real bits a PATCH's [output] holds, checked and put in [patch]; a refusal for any other. */
    private static void DitherInto(object? output, JsObj patch)
    {
        var dither = Prop(output, "dither");
        if (dither is not Undef)
        {
            if (dither is not string dv || dv != "flat" && Upsample.Dither.Of(dv) == null) throw new DeviceRefusal(400, "dither must be flat, ns3 or ns5");
            patch["dither"] = dv == "flat" ? null : dv;
        }
        var realBits = Prop(output, "real_bits");
        if (realBits is not Undef)
        {
            if (!Jv.Same(realBits, "sent") && Upsample.Dither.BitsOf(realBits) == 0) throw new DeviceRefusal(400, "real_bits must be sent or 20 to 23");
            patch["real_bits"] = Jv.Same(realBits, "sent") ? null : (double)Upsample.Dither.BitsOf(realBits);
        }
    }
}
