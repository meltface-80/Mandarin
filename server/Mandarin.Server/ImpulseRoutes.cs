// ImpulseRoutes.cs — a device's room or headphone correction loaded and taken off (bug list item 252):
//
//   POST   /api/audio-devices/:id/impulse?name=   the WAV in the body: checked, measured, kept, set on the device's DSP
//   DELETE /api/audio-devices/:id/impulse         the device's DSP without one
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
            JsObj? conv = null;
            if (post)
            {
                if (ctx.Request.ContentLength > Convolution.MaxBytes) return await JsError(ctx, 413, "a response is at most 32 MB");
                using var ms = new MemoryStream();
                var buf = new byte[1 << 16];
                int n;
                while ((n = await ctx.Request.Body.ReadAsync(buf)) > 0)
                {
                    if (ms.Length + n > Convolution.MaxBytes) return await JsError(ctx, 413, "a response is at most 32 MB");
                    ms.Write(buf, 0, n);
                }
                var name = ctx.Request.Query["name"].ToString();
                conv = Convolution.Store(ms.ToArray(), name.Length > 0 ? name : "Impulse response");
            }
            using (var c = Db.Open())
            {
                var d = DeviceRead(c, id);
                if (d == null) return await JsError(ctx, 404, "No such device");
                if (d.Kind is not ("upnp" or "local")) return await JsError(ctx, 400, "Only a renderer or a sound device on this computer takes a convolution");
                var merged = DeviceCopy(DeviceDsp(d) ?? Biquad.Normalise(null));
                merged["convolution"] = conv;   // none: Normalise leaves it out
                DeviceSettings(c, d, Jv.Obj(("dsp", Biquad.Normalise(merged))));
            }
            if (conv != null) Server.Log($"[dsp] {id}: convolution “{Jv.Str(conv["name"])}”, {Jv.Str(conv["rate"])} Hz, {Jv.Str(conv["channels"])} channel(s), {Jv.Str(conv["seconds"])} s, peak {Jv.Str(conv["peak_db"])} dB");
            await hub.DeviceChanged(id, ["dsp"]);
            using var c2 = Db.Open();
            var dev = hub.Devices.Get(c2, id);
            return dev == null ? await JsError(ctx, 404, "No such device") : await SendJs(ctx, hub.Devices.WithRadio(c2, dev, id));
        }
        catch (ConvolutionError e) { return await JsError(ctx, 400, e.Message); }
    }
}
