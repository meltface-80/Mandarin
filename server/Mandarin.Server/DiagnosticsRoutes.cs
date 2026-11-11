// DiagnosticsRoutes.cs — the routes of the server's log (Diagnostics.cs): read and cleared by the app and the page.
// It can't be switched off (item 389): an app from before that asks is told it is on.
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Library
{
    /* The diagnostics routes: true when answered here. */
    private static async Task<bool> DiagnosticsRoute(HttpContext ctx)
    {
        var p = ctx.Request.Path.Value ?? "";
        if (!p.StartsWith("/api/diagnostics", StringComparison.Ordinal)) return false;
        var m = ctx.Request.Method;
        var get = HttpMethods.IsGet(m) || HttpMethods.IsHead(m);
        try
        {
            if (get && p == "/api/diagnostics") return await Send(ctx, new JsonObject { ["on"] = Diagnostics.On, ["bytes"] = Diagnostics.Bytes() });
            if (get && p == "/api/diagnostics/log") return await SendText(ctx, Diagnostics.Text());
            // Every Mandarin Bridge's own log, saved after the server's (item 291, Admin/BridgeLogs.cs).
            if (get && p == "/api/diagnostics/bridges") return await SendText(ctx, await Admin.BridgeLogs.Text());
            if (HttpMethods.IsPost(m) && p == "/api/diagnostics/clear")
            {
                Diagnostics.Clear();
                return await Send(ctx, new JsonObject { ["ok"] = true });
            }
            if (HttpMethods.IsPost(m) && p == "/api/diagnostics")
            {
                var (b, answered) = await JsBody(ctx);
                if (answered) return true;
                if (Prop(b, "on") is not true) Server.Log("[diagnostics] asked to switch the log off: it stays on");
                return await Send(ctx, new JsonObject { ["on"] = Diagnostics.On });
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException && !ctx.Response.HasStarted)
        {
            Server.Log($"[diagnostics] {p}: {e.GetType().Name}");
            return await JsError(ctx, 500, "Couldn't keep the server's log");
        }
        return false;
    }
}
