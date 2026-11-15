// DiagnosticsRoutes.cs — the lines the page and the Android app send to the one log (DiagnosticsMore.cs, item 425). The
// log itself is read on the shared folder (Mandarin OS: smb://<box>/Data/Logs) or in <data>/Logs, never through the
// server: the routes that read it, cleared it and zipped it are gone with the screens that used them.
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Library
{
    /* The diagnostics routes: true when answered here. */
    private static async Task<bool> DiagnosticsRoute(HttpContext ctx)
    {
        var p = ctx.Request.Path.Value ?? "";
        var post = HttpMethods.IsPost(ctx.Request.Method);
        // What went wrong in a browser's page, under the browser's name.
        if (post && p == "/api/diagnostics/page")
        {
            var (body, bad) = await LinesBody(ctx);
            return bad || await Send(ctx, new JsonObject { ["kept"] = DiagnosticsMore.Page(body, Auth.DeviceNameFromUA(ctx.Request.Headers.UserAgent.ToString())) });
        }
        // The Android app's lines, as it sends them (item 389, then 425), under the phone's name.
        if (post && p == "/api/diagnostics/app")
        {
            var (body, bad) = await LinesBody(ctx);
            if (bad) return true;
            var text = (body?["text"] as JsonValue)?.TryGetValue<string>(out var t) == true ? t : "";
            if (text.Length > DiagnosticsMore.AppBytes) return await JsError(ctx, 413, "Too much at once");
            var who = ctx.Items["device"] is Device d && d.Name.Length > 0 ? d.Name : Auth.DeviceNameFromUA(ctx.Request.Headers.UserAgent.ToString());
            return await Send(ctx, new JsonObject { ["kept"] = DiagnosticsMore.App(text, who) });
        }
        return false;
    }

    /* The request's JSON, read as every route reads one (Http.ReadJson: only a body typed as JSON, item 173), null for
       none; one turned down answered (bad: true) as JsBody answers it. */
    private static async Task<(JsonNode? Body, bool Bad)> LinesBody(HttpContext ctx)
    {
        var read = await Http.ReadJson(ctx);
        if (read.Refused) { await JsError(ctx, read.Status, read.Words); return (null, true); }
        if (read.Text!.Length == 0) return (null, false);
        try { return (JsonNode.Parse(read.Text), false); }
        catch (System.Text.Json.JsonException) { await JsError(ctx, 400, "Bad JSON"); return (null, true); }
    }
}
