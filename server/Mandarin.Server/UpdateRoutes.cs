// UpdateRoutes.cs — Settings → Updates (v0.8.48, stage 5 part 4 of
// docs/specs/csharp-migration.md), from lib/server/api-playlists.js, in the
// same shapes:
//
//   GET  /api/update/status   what the updater knows (Admin/Updater.cs getStatus),
//                             with is_docker and csharp (how bringing this program
//                             to the Node server's version went, as it says with
//                             its state); mac_node_only went with stage 7 (v0.8.50)
//   POST /api/update/check    GitHub asked now, then the same
//   POST /api/update/apply    the update made: { ok, status }, or 409 { error, status }
//
// Answered here once the Node server has handed the update over (Jobs.cs,
// "update"); until then by it.
using Mandarin.Server.Tags;

namespace Mandarin.Server;

internal static partial class Library
{
    /* The update routes: true when answered here. */
    private static async Task<bool> UpdateRoute(HttpContext ctx)
    {
        var p = ctx.Request.Path.Value ?? "";
        if (!p.StartsWith("/api/update/", StringComparison.Ordinal)) return false;
        if (Jobs.Updater is not { } u || !Jobs.Holds("update")) return false;
        var m = ctx.Request.Method;
        try
        {
            if ((HttpMethods.IsGet(m) || HttpMethods.IsHead(m)) && p == "/api/update/status") return await SendJs(ctx, await UpdateStatus(u));
            if (HttpMethods.IsPost(m) && p == "/api/update/check")
            {
                await u.CheckNow();
                return await SendJs(ctx, await UpdateStatus(u));
            }
            if (HttpMethods.IsPost(m) && p == "/api/update/apply")
            {
                await u.Apply();
                var st = await UpdateStatus(u);
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
            Front.Log($"[update] {p}: {e.GetType().Name}: {e.Message}; passed to the Node server");
            return false;
        }
        return false;
    }

    /* updStatus(): the updater's, with the Node server's word on this program's own update. */
    private static async Task<JsObj> UpdateStatus(Admin.Updater u)
    {
        var st = await State();
        return u.Status(st != null ? FromNode(st.Said["csharp_update"]) : null);
    }
}
