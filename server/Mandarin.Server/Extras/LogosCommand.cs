// LogosCommand.cs — the label-logo finder run step by step through `mandarin-server
// score` (RulesCommand.cs), on a database `mandarin-server db` made, for the tests
// that asked lib/labellogos.js directly (test/label-logos.test.js; v0.8.50, stage 7
// part 6):
//
//   { fn: "logos", data, discogs, fanart, mb, steps: [{ set: [key, value] } | { check: [kind, fresh] }
//     | { fetch: [[key, title], …] } | { idle: ms } | { get: key } | { forget: key } | { miss: key }] }
//      → { results }: each step's — a setting written (null); the key's state; whether a pass started
//        (or was queued behind one running); whether the passes ended within ms; the logo's file or null;
//        a logo forgotten (null); a miss remembered for the keys as they are now (null)
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal static class LogosCommand
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static string? S(object? v) => v as string;

    public static JsObj Run(JsObj job)
    {
        Db.File = Path.Combine(Js.Str(job["data"]), "musicd.db");
        var mb = S(job["mb"]) is { } m ? new Identify.MusicBrainz(m, "0") : null;
        var logos = new LabelLogos(Js.Str(job["data"]), mb, S(job["discogs"]), S(job["fanart"]), 0, "0", _ => { });
        var results = new List<object?>();
        foreach (var st0 in L(job["steps"]))
        {
            var st = st0 as JsObj ?? new JsObj();
            if (st["set"] is List<object?> kv)
            {
                using var c = Db.Open();
                using var cmd = c.CreateCommand();
                cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
                cmd.Parameters.AddWithValue("$k", Js.Str(kv[0]));
                cmd.Parameters.AddWithValue("$v", Js.Json(kv.Count > 1 ? kv[1] : null));
                cmd.ExecuteNonQuery();
                results.Add(null);
            }
            else if (st["check"] is List<object?> ck) results.Add(logos.CheckKey(Js.Str(ck[0]), ck.Count > 1 && Js.Truthy(ck[1])).GetAwaiter().GetResult());
            else if (st["fetch"] is List<object?> labels)
                results.Add(logos.FetchMissing(labels.Select(l => L(l)).Select(l => (Js.Str(l[0]), Js.Str(l[1]))).ToList(), false));
            else if (st.Has("idle"))
            {
                var until = DateTime.UtcNow.AddMilliseconds(Js.ToNumber(st["idle"]));
                while (logos.Running && DateTime.UtcNow < until) Thread.Sleep(20);
                results.Add(!logos.Running);
            }
            else if (st.Has("get")) results.Add(logos.Get(Js.Str(st["get"]))?.File);
            else if (st.Has("forget")) { logos.Remove(Js.Str(st["forget"])); results.Add(null); }
            else if (st.Has("miss")) { LabelLogos.Miss(Js.Str(st["miss"]), LabelLogos.KeysSig()); results.Add(null); }
            else throw new JsError("unknown step");
        }
        return new JsObj { ["results"] = results };
    }
}
