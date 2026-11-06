// ImpulseRoutes.cs — a device's room or headphone correction loaded and taken off (bug list item 252):
//
//   POST   /api/audio-devices/:id/impulse?name=   a WAV, or a zip of them, in the body: checked, measured, kept,
//                                                 added to the device's DSP, one a rate (item 258)
//   DELETE /api/audio-devices/:id/impulse?rate=   the one at that rate taken off; with no rate, all of them
//
// Both answer as the device PATCH does (DeviceRoutes.cs): the device as its page shows it. The response itself is
// Playback/Convolution.cs's; the DSP must be on for it to be run, as the bands' must.
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

internal static partial class Library
{
    private const string ImpulseSuffix = "/impulse";

    /* The impulse routes: true when answered here. */
    private static async Task<bool> ImpulseRoute(HttpContext ctx)
    {
        var post = HttpMethods.IsPost(ctx.Request.Method);
        if (!post && !HttpMethods.IsDelete(ctx.Request.Method)) return false;
        var p = ctx.Request.Path.Value ?? "";
        if (!p.StartsWith(DevicePrefix, StringComparison.Ordinal) || !p.EndsWith(ImpulseSuffix, StringComparison.Ordinal)) return false;
        var id = p[DevicePrefix.Length..^ImpulseSuffix.Length];
        if (id.Length == 0 || id.Contains('/') || id.Contains('%')) return false;
        var hub = Hub.Current;
        if (hub == null) return false;
        if (Auth.IsAway(ctx)) return await JsError(ctx, 403, "Away from home, a device's DSP isn't changed");
        try
        {
            var added = new List<JsObj>();
            if (post)
            {
                // A WAV, or a zip of them (item 258: one response a rate, as REW or Dirac exports a set).
                if (ctx.Request.ContentLength > Convolution.MaxSetBytes) return await JsError(ctx, 413, "a set of responses is at most 128 MB");
                using var ms = new MemoryStream();
                var buf = new byte[1 << 16];
                int n;
                while ((n = await ctx.Request.Body.ReadAsync(buf)) > 0)
                {
                    if (ms.Length + n > Convolution.MaxSetBytes) return await JsError(ctx, 413, "a set of responses is at most 128 MB");
                    ms.Write(buf, 0, n);
                }
                var name = ctx.Request.Query["name"].ToString();
                foreach (var (bytes, its) in Convolution.Unpack(ms.ToArray(), name.Length > 0 ? name : "Impulse response")) added.Add(Convolution.Store(bytes, its));
            }
            double? gone = double.TryParse(ctx.Request.Query["rate"].ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var r) ? r : null;
            using (var c = Db.Open())
            {
                var d = DeviceRead(c, id);
                if (d == null) return await JsError(ctx, 404, "No such device");
                if (!Renderers.Players.StreamerKind(d.Kind)) return await JsError(ctx, 400, "Only a renderer or a sound device on this computer takes a convolution");
                var merged = DeviceCopy(DeviceDsp(d) ?? Biquad.Normalise(null));
                // Added to those there (one at a rate already there takes its place), or one rate or all taken off.
                var had = Convolution.Normalise(merged["convolution"]) ?? [];
                merged["convolution"] = post ? [.. had, .. added] : gone is { } g ? had.Where(x => Jv.Num(Jv.Get(x, "rate")) != g).ToList() : null;
                DeviceSettings(c, d, Jv.Obj(("dsp", Biquad.Normalise(merged))));
            }
            foreach (var conv in added)
                Server.Log($"[dsp] {id}: convolution “{Jv.Str(conv["name"])}”, {Jv.Str(conv["rate"])} Hz, {Jv.Str(conv["channels"])} channel(s), {Jv.Str(conv["seconds"])} s, peak {Jv.Str(conv["peak_db"])} dB");
            await hub.DeviceChanged(id, ["dsp"]);
            using var c2 = Db.Open();
            var dev = hub.Devices.Get(c2, id);
            return dev == null ? await JsError(ctx, 404, "No such device") : await SendJs(ctx, hub.Devices.WithRadio(c2, dev, id));
        }
        catch (ConvolutionError e) { return await JsError(ctx, 400, e.Message); }
    }
}
