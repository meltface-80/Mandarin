// DeviceRoutes.Read.cs — Settings → Audio Devices, the reads and the two
// actions (lib/server/api-devices.js, v0.8.49, stage 6 parts 3 and 5), once
// this server holds playback: the list, one device, Look again (a discovery
// round now) and Forget. Home only, like the rooms themselves — with one
// exception: away from home, the Mandarin app sees the phone it is on.
using Mandarin.Server.Playback;

namespace Mandarin.Server;

internal static partial class Library
{
    private const string DevicesPath = "/api/audio-devices";

    /* The device reads and actions: true when answered here. */
    private static async Task<bool> DeviceReadRoute(HttpContext ctx)
    {
        if (Hub.Current is not { } hub) return false;
        var p = ctx.Request.Path.Value ?? "";
        if (p != DevicesPath && !p.StartsWith(DevicePrefix, StringComparison.Ordinal)) return false;
        var rest = p == DevicesPath ? "" : p[DevicePrefix.Length..];
        if (rest.Contains('%')) return false;
        var away = Auth.IsAway(ctx);
        using var c = Db.Open();
        var devices = hub.Devices;
        string? mine = null;
        if (away) mine = devices.OwnPhone(c, Auth.DeviceOf(ctx, c));
        if (HttpMethods.IsGet(ctx.Request.Method) && rest.Length == 0)
        {
            if (away) return await SendJs(ctx, Jso(("away", true), ("devices", devices.List(c).Where(d => Jv.Same(d["id"], mine)).Cast<object?>().ToList())));
            return await SendJs(ctx, Jso(("away", false), ("devices", devices.List(c).Cast<object?>().ToList()), ("scanning", devices.Scanning),
                ("last_scan", devices.LastScan > 0 ? devices.LastScan : null), ("local", devices.Local)));
        }
        if (HttpMethods.IsGet(ctx.Request.Method) && !rest.Contains('/'))
        {
            if (away && mine != rest) return await SendJs(ctx, Jso(("error", "Away from home, only this phone is shown"), ("away", true)), 403);
            var d = devices.Get(c, rest);
            if (d == null) return await JsError(ctx, 404, "No such device");
            return await SendJs(ctx, devices.WithRadio(c, d, rest));
        }
        if (HttpMethods.IsPost(ctx.Request.Method) && rest == "rescan")
        {
            if (away) return await SendJs(ctx, Jso(("error", "Away from home, the network can't be searched"), ("away", true)), 403);
            await devices.Scan();
            return await SendJs(ctx, Jso(("ok", true), ("devices", devices.List(c).Cast<object?>().ToList()), ("last_scan", devices.LastScan > 0 ? devices.LastScan : null), ("local", devices.Local)));
        }
        if (HttpMethods.IsPost(ctx.Request.Method) && rest.EndsWith("/forget", StringComparison.Ordinal) && rest.IndexOf('/') == rest.Length - "/forget".Length)
        {
            if (away) return await SendJs(ctx, Jso(("error", "Away from home, devices can't be changed"), ("away", true)), 403);
            var id = rest[..^"/forget".Length];
            var r = Register.Get(c, id);
            if (r == null) return await JsError(ctx, 404, "No such device");
            if (devices.Online(r)) return await JsError(ctx, 409, "It is on the network — Forget is for a device that has gone");
            Register.Forget(c, id);
            devices.Discovery.Forget(id);
            hub.Upnp.Drop(id);
            hub.Bump();
            return await SendJs(ctx, Jso(("ok", true), ("devices", devices.List(c).Cast<object?>().ToList())));
        }
        return false;
    }
}
