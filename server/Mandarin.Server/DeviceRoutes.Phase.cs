// DeviceRoutes.Phase.cs — a device's Phase written (bug list item 318): linear, kept as its absence, or minimum, for
// both its filters (Upsample/Shape.cs). "minphase", the standard filter in minimum phase from before Phase was its own
// choice, is written as what it is now: the standard filter, and Phase minimum; and a Phase set clears a "minphase"
// kept from before, so that the device's filters are what its page says.
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

internal static partial class Library
{
    /* The Phase a PATCH's [output] holds, checked and put in [patch], with [settings] the device's as they are; a refusal for any other. */
    private static void PhaseInto(object? output, JsObj patch, JsObj settings)
    {
        foreach (var row in new[] { "filter", "filter_hires" })
            if (patch.Has(row) && Jv.Same(patch[row], "minphase")) { patch[row] = row == "filter" ? "standard" : null; patch["phase"] = "minimum"; }
        var phase = Prop(output, "phase");
        if (phase is Undef) return;
        if (phase is not string p || Array.IndexOf(Upsample.Shape.Phases, p) < 0) throw new DeviceRefusal(400, "phase must be linear or minimum");
        patch["phase"] = p == "minimum" ? "minimum" : null;
        foreach (var row in new[] { "filter", "filter_hires" })
            if (!patch.Has(row) && Jv.Same(settings[row], "minphase")) patch[row] = row == "filter" ? "standard" : null;
    }
}
