// UpdateRoutes.cs — Settings → Updates (v0.8.48, stage 5 part 4 of
// old/csharp-migration.md), from lib/server/api-playlists.js, in the
// same shapes:
//
//   GET  /api/update/status   what the updater knows (Admin/Updater.cs getStatus);
//                             viaLauncher, isDowngrade, csharp and
//                             mac_node_only went with the Node server, is_docker
//                             with the image (item 394)
//   POST /api/update/check    GitHub asked now, then the same
//   POST /api/update/apply    the update made: { ok, status }, or 409 { error, status }
//   GET  /api/update/bridges, POST /api/update/bridges/apply: the Mandarin Bridges' (Admin/BridgeUpdates.cs, item 291)
//
// The job "update" (Jobs.cs).
using Mandarin.Server.Tags;

namespace Mandarin.Server;

internal static partial class Library
{
    /* The update routes: true when answered here. */
    private static async Task<bool> UpdateRoute(HttpContext ctx)
    {
        var p = ctx.Request.Path.Value ?? "";
        if (!p.StartsWith("/api/update/", StringComparison.Ordinal)) return false;
        var m = ctx.Request.Method;
        // The Mandarin Bridges' own updates (item 291, Admin/BridgeUpdates.cs): which can be updated, and one asked to.
        if (HttpMethods.IsGet(m) && p == "/api/update/bridges") { await Http.Json(ctx, await Admin.BridgeUpdates.List(ctx.Request.Query["fresh"] == "1")); return true; }
        if (HttpMethods.IsPost(m) && p == "/api/update/bridges/apply")
        {
            var body = await System.Text.Json.Nodes.JsonNode.ParseAsync(ctx.Request.Body) as System.Text.Json.Nodes.JsonObject;
            var (status, said) = await Admin.BridgeUpdates.Apply((string?)body?["id"] ?? "");
            await Http.Json(ctx, said, status);
            return true;
        }
        if (Jobs.Updater is not { } u || !Jobs.Holds("update")) return false;
        try
        {
            if ((HttpMethods.IsGet(m) || HttpMethods.IsHead(m)) && p == "/api/update/status") return await SendJs(ctx, u.Status());
            if (HttpMethods.IsPost(m) && p == "/api/update/check")
            {
                await u.CheckNow();
                return await SendJs(ctx, u.Status());
            }
            if (HttpMethods.IsPost(m) && p == "/api/update/apply")
            {
                await u.Apply();
                var st = u.Status();
                var o = new JsObj();
                if (st["apply"] is JsObj apply && apply["phase"] is "error")
                {
                    o["error"] = apply["error"];
                    o["status"] = st;
                    return await SendJs(ctx, o, 409);
                }
                o["ok"] = true;
                o["status"] = st;
                return await SendJs(ctx, o);
            }
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            Server.Log($"[update] {p}: {e.GetType().Name}: {e.Message}; not answered");
            return false;
        }
        return false;
    }
}
