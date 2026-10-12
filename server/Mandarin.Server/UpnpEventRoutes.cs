// UpnpEventRoutes.cs — a renderer's NOTIFY (UPnP eventing, Renderers/
// GenaClient.cs): the device saying its transport changed (v0.8.49, stage 6
// part 3). Before the gate — a device can't sign in — and unsigned: it is XML,
// and only ever wakes a read of the device. Answered here once this server
// holds playback; before that, the Node server's.
using Mandarin.Server.Playback;

namespace Mandarin.Server;

internal static class UpnpEventRoutes
{
    public static void Use(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            var p = ctx.Request.Path.Value ?? "";
            if (ctx.Request.Method != "NOTIFY" || !p.StartsWith("/upnp/event/", StringComparison.Ordinal) || Hub.Current is not { } hub) { await next(); return; }
            var id = Uri.UnescapeDataString(p["/upnp/event/".Length..].Split('/')[0]);
            try
            {
                using var ms = new MemoryStream();
                await ctx.Request.Body.CopyToAsync(ms);
                var text = System.Text.Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)Math.Min(ms.Length, 1024 * 1024));
                hub.Upnp.OnNotify(id, Renderers.Gena.ParseNotify(text));
            }
            catch (Exception e) when (e is IOException or XmlRefused or Tags.JsError) { /* a malformed event is ignored */ }
            ctx.Response.StatusCode = 200;
        });
    }
}
