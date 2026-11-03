// WholePlan.cs — which plans are upsampled whole (bug list item 237): a device's Output set to Whole track, and a
// plan that upsamples by a power of two (×2, ×4, ×8, ×16: the transform's sizes), from a file of the library (a
// stream of Qobuz's or Tidal's comes as it comes, and plays with the standard filter).
using Mandarin.Server.Tags;
using Jv = Mandarin.Server.Playback.Jv;

namespace Mandarin.Server.Upsample;

internal static class WholePlan
{
    /* [plan], made for [target] for the track at [path], marked to be upsampled whole where it can be. */
    public static JsObj Mark(JsObj plan, object? target, string path)
    {
        if (target == null || Jv.Get(target, "filter") is not "whole" || !Jv.T(plan["upsampled"])) return plan;
        if (Playback.StreamPlans.ServiceOf(path) != null) return plan;
        var factor = (long)Jv.Num(plan["upsampled"]);
        if (factor < 2 || (factor & (factor - 1)) != 0) return plan;
        plan["whole"] = true;
        // The track's own rate, which the job divides by: a plan made for a queue (Playback/Items.cs) carries none of its
        // own, and without it every track planned so failed ("the factor must be a power of two", item 244).
        plan["inRate"] = Jv.Num(plan["rate"]) / factor;
        plan["reason"] = Jv.Str(plan["reason"]) + " (whole track)";
        return plan;
    }

    /* Whether [factor] is one the transform takes: a power of two, two or more. */
    public static bool Takes(long factor) => factor >= 2 && (factor & (factor - 1)) == 0;
}
