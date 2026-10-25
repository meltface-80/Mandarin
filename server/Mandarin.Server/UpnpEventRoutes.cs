// UpnpEventRoutes.cs — a renderer's NOTIFY (UPnP eventing, Renderers/
// GenaClient.cs): the device saying its transport changed (v0.8.49, stage 6
// part 3). Before the gate — a device can't sign in — and unsigned: it is XML,
// and only ever wakes a read of the device. Answered here once this server
// holds playback; before that, the Node server's. No more than 1 MB of it is
// read (Read).
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
            ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
            try
            {
                if (await Read(ctx) is not { } text) { ctx.Response.StatusCode = 413; return; }
                hub.Upnp.OnNotify(id, Renderers.Gena.ParseNotify(text));
            }
            catch (Exception e) when (e is IOException or XmlRefused or Tags.JsError) { /* a malformed event is ignored */ }
            ctx.Response.StatusCode = 200;
        });
    }

    /* The most of an event read (a renderer's is a few kilobytes). */
    public const int Limit = 1024 * 1024;

    /*
     * The event's body as text, or null past Limit (item 173): it comes before
     * the gate and before the body limit, so read whole, a body of any size
     * from anyone who reached the port was held in memory. Past it, the rest
     * is left unread.
     */
    private static async Task<string?> Read(HttpContext ctx)
    {
        if (ctx.Request.ContentLength > Limit) return null;
        using var ms = new MemoryStream();
        var buf = new byte[16 * 1024];
        int n;
        while ((n = await ctx.Request.Body.ReadAsync(buf)) > 0)
        {
            if (ms.Length + n > Limit) return null;
            ms.Write(buf, 0, n);
        }
        return System.Text.Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
    }
}
