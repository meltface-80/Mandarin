// MqaCommand.cs — MQA's rules asked directly, through `mandarin-server score` (RulesCommand.cs), for the tests (item 418).
//
//   { fn: "mqa", files: [[path, rate]] }                 each file looked at as the background pass looks (MqaPass.cs)
//      → { files: [{ mqa, studio, original_rate } | { error }] }
//   { fn: "mqa", rates: [code] }                          the original rate a 4-bit code says (MqaDetect.Rate)
//   { fn: "mqa", items: [[row, target, gain, mqa]] }      a play's plan for a library row (Playback/Items.cs PlanOf), its
//      → { items: [plan] }                                 headroom left out (it reads the database)
//   { fn: "mqa", untouched: [uri], headers: [uri] }       what a stream address says (MqaPlan.Untouched, HeaderFor)
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Mqa;

using Js = Mandarin.Server.Tags.Js;

internal static class MqaCommand
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static object? At(object? list, int i) { var l = L(list); return i < l.Count ? l[i] : null; }

    public static JsObj Run(JsObj job)
    {
        var o = new JsObj();
        if (job.Has("files"))
            o["files"] = L(job["files"]).Select(a =>
            {
                var (found, error) = MqaPass.Look(Js.Str(At(a, 0)), Js.ToNumber(At(a, 1)), () => false).GetAwaiter().GetResult();
                return (object?)(error != null || found == null ? Jv.Obj(("error", error ?? "stopped"))
                    : Jv.Obj(("mqa", found.Mqa), ("studio", found.Studio), ("original_rate", (double)found.OriginalRate)));
            }).ToList();
        if (job.Has("rates")) o["rates"] = L(job["rates"]).Select(c => (object?)(double)MqaDetect.Rate((int)Js.ToNumber(c))).ToList();
        if (job.Has("items"))
            o["items"] = L(job["items"]).Select(a => (object?)Items.PlanOf((JsObj)At(a, 0)!, At(a, 1) as JsObj, At(a, 2) is double g ? g : null, Js.Truthy(At(a, 3)), p => p)).ToList();
        if (job.Has("untouched")) o["untouched"] = L(job["untouched"]).Select(u => (object?)MqaPlan.Untouched(u as string)).ToList();
        if (job.Has("headers")) o["headers"] = L(job["headers"]).Select(u => (object?)MqaPlan.HeaderFor(u as string)).ToList();
        return o;
    }
}
