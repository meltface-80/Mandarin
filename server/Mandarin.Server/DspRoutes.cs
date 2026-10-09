// DspRoutes.cs — headphone profiles for a device's DSP (v0.8.26):
// lib/server/api-dsp.js in the same shapes, from AutoEq (Extras/AutoEq.cs).
//
//   GET  /api/dsp/headphones?q=hd+650   AutoEq's index searched
//   GET  /api/dsp/headphones/profile?id= one profile, fetched and kept
//   POST /api/dsp/headphones/parse      { text, name } → a pasted or uploaded profile
//
// The chosen profile is saved with the device (PATCH /api/audio-devices/:id,
// still the Node server's). Answered here once the Node server has said where
// AutoEq is (Jobs.cs); until then, by it.
using Mandarin.Server.Extras;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private static AutoEq? HeldAutoEq => Jobs.Held ? Jobs.AutoEq : null;

    /* A refusal as the Node server's wrap gives it: its status (502 when it has none) and { error }. */
    private static Task<bool> DspError(HttpContext ctx, Exception e) =>
        JsError(ctx, e is AutoEqError a ? a.Status : 502, e.Message);

    /* GET /api/dsp/headphones?q= */
    private static async Task<bool> Headphones(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldAutoEq is not { } eq) return false;
        var q = Names.JsTrim(Q(ctx, "q") ?? "");
        try
        {
            var o = new JsObj();
            o["results"] = q.Length > 0 ? await eq.Search(q) : new List<object?>();
            o["indexed_at"] = AutoEq.IndexedAt();
            return await SendJs(ctx, o);
        }
        catch (Exception e) when (e is AutoEqError or Identify.LookupError) { return await DspError(ctx, e); }
    }

    /* GET /api/dsp/headphones/profile?id= */
    private static async Task<bool> HeadphoneProfile(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldAutoEq is not { } eq) return false;
        try
        {
            var o = new JsObj();
            o["profile"] = await eq.Profile(Q(ctx, "id") ?? "");
            return await SendJs(ctx, o);
        }
        catch (Exception e) when (e is AutoEqError or Identify.LookupError) { return await DspError(ctx, e); }
    }

    /* POST /api/dsp/headphones/parse { text, name } */
    private static async Task<bool> ParseHeadphoneProfile(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldAutoEq is null) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var body = FromNode(b) as JsObj ?? new JsObj();
        var text = TJs.Truthy(body["text"]) ? TJs.Str(body["text"]) : "";
        if (text.Length > 20000) return await JsError(ctx, 400, "That's too long for a profile");
        try
        {
            var (preamp, bands) = AutoEq.ParseProfile(text);
            var name = Names.JsTrim(TJs.Truthy(body["name"]) ? TJs.Str(body["name"]) : "");
            if (name.Length > 120) name = name[..120];
            var p = new JsObj();
            p["source"] = "custom";
            p["id"] = "";
            p["name"] = name.Length > 0 ? name : "Pasted profile";
            p["preamp"] = preamp;
            p["bands"] = bands;
            var o = new JsObj();
            o["profile"] = p;
            return await SendJs(ctx, o);
        }
        catch (AutoEqError e) { return await DspError(ctx, e); }
    }
}
