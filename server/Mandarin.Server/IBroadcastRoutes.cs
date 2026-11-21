// IBroadcastRoutes.cs — Settings → Services → iBroadcast (item 443, Services/IBroadcast/):
//
//   GET  /api/settings/ibroadcast                 { connected, user: { name }, premium, formats, since }, or signed out
//                                                 { connected: false, pending?: { url, code, expires_at, error } }
//   POST /api/settings/ibroadcast/signin          a code to approve on iBroadcast: the state, its pending among it
//   POST /api/settings/ibroadcast/signin/cancel   the sign-in under way let go
//   POST /api/settings/ibroadcast/signout         signed out, here and at iBroadcast
//   POST /api/settings/ibroadcast                 { import }: iBroadcast's albums in the library or not (item 444)
//   POST /api/settings/ibroadcast/library         Update library now: the library read again from iBroadcast
//   POST /api/settings/ibroadcast/upload          Upload now (item 446): the library here uploaded, begun
//   POST /api/settings/ibroadcast/upload/stop     the upload under way stopped
//   POST /api/settings/ibroadcast/upload/settings { from, at_once, home, home_at_once, away, away_at_once } (item 451):
//                                                 what is uploaded from (all, or a drive offered), and how many at once
//   POST /api/settings/ibroadcast/upload/speed    { speed_mbps, percent } (item 479): the home's upload speed and the
//                                                 share of it the upload may use (Upload bandwidth); 400 refused
//   POST /api/settings/ibroadcast/schedule        { on, start, end } (item 447): the upload's window; 409 where it
//                                                 would overlap the Library Scanner's hours, saying them
// Signed in, the state carries the library's: { import, reading, albums, also_here, tracks, at }, and the upload's
// (IBroadcastUpload.Status: the one under way, or the last one's summary; null before the first), its schedule
// ({ on, start, end }) and the Library Scanner's hours ({ on, start, end }) beside it; the upload's choices
// (upload_settings) and the drives it may be from (upload_sources: [{ path, name, files }]); and its bandwidth
// (upload_speed: { speed_mbps, percent, limit_mbps, fastest_mbps }).
//
// Signed in, the account is read again from iBroadcast when the page asks and six hours have gone by since it was.
// A failure is answered in iBroadcast's words, with its status (401: signed out, or to sign in again).
using System.Text.Json.Nodes;
using Mandarin.Server.Services;
using IB = Mandarin.Server.Services.IBroadcast;

namespace Mandarin.Server;

internal static partial class Library
{
    private const double IBroadcastRecheckMs = 6 * 3600 * 1000;

    /* The iBroadcast page's routes: true when answered here. */
    private static async Task<bool> IBroadcastRoute(HttpContext ctx)
    {
        var p = ctx.Request.Path.Value ?? "";
        if (!p.StartsWith("/api/settings/ibroadcast", StringComparison.Ordinal) || Jobs.IBroadcast is not { } ib) return false;
        var m = ctx.Request.Method;
        var get = HttpMethods.IsGet(m) || HttpMethods.IsHead(m);
        try
        {
            switch (p)
            {
                case "/api/settings/ibroadcast" when get:
                    if (IB.IBroadcast.Connected() && IB.IBroadcast.Account()?["checked"] is var at
                        && (at is not JsonValue v || !v.TryGetValue<double>(out var ms) || IB.IBroadcastApi.Now() - ms > IBroadcastRecheckMs))
                        _ = Task.Run(async () => { try { await ib.DescribeOnce(); } catch (ServiceError e) { Server.Log("[ibroadcast] the account couldn't be read: " + e.Message); } });
                    return await Http.Json(ctx, WithLibrary(ib.Status()));
                case "/api/settings/ibroadcast" when HttpMethods.IsPost(m):
                    if (!IB.IBroadcast.Connected()) return await Http.Json(ctx, new JsonObject { ["error"] = "Not signed in to iBroadcast", ["connected"] = false }, 401);
                    var (body, _) = await Http.ReadJs(ctx);
                    if (body is Tags.JsObj o && o["import"] is bool on) await IB.IBroadcastLibrary.SetShown(on);
                    return await Http.Json(ctx, WithLibrary(ib.Status()));
                case "/api/settings/ibroadcast/library" when HttpMethods.IsPost(m):
                    if (Jobs.IBroadcastLibrary is not { } lib || !IB.IBroadcast.Connected()) return await Http.Json(ctx, new JsonObject { ["error"] = "Not signed in to iBroadcast", ["connected"] = false }, 401);
                    await lib.Read(true);
                    return await Http.Json(ctx, WithLibrary(ib.Status()));
                case "/api/settings/ibroadcast/upload" when HttpMethods.IsPost(m):
                    Jobs.IBroadcastUpload?.Start();
                    return await Http.Json(ctx, WithLibrary(ib.Status()));
                case "/api/settings/ibroadcast/upload/stop" when HttpMethods.IsPost(m):
                    Jobs.IBroadcastUpload?.Stop();
                    return await Http.Json(ctx, WithLibrary(ib.Status()));
                case "/api/settings/ibroadcast/upload/settings" when HttpMethods.IsPost(m):
                {
                    var (cb, _) = await Http.ReadJs(ctx);
                    var patch = cb is Tags.JsObj co ? JsonNode.Parse(Tags.Js.Json(co) ?? "{}") as JsonObject ?? [] : [];
                    var (_, refused) = IB.IBroadcastUploadChoices.Save(patch);
                    if (refused != null) return await Http.Json(ctx, new JsonObject { ["error"] = refused }, 400);
                    return await Http.Json(ctx, WithLibrary(ib.Status()));
                }
                case "/api/settings/ibroadcast/upload/speed" when HttpMethods.IsPost(m):
                {
                    var (vb, _) = await Http.ReadJs(ctx);
                    var patch = vb is Tags.JsObj vo ? JsonNode.Parse(Tags.Js.Json(vo) ?? "{}") as JsonObject ?? [] : [];
                    var (_, refused) = IB.IBroadcastUploadSpeed.Save(patch);
                    if (refused != null) return await Http.Json(ctx, new JsonObject { ["error"] = refused }, 400);
                    return await Http.Json(ctx, WithLibrary(ib.Status()));
                }
                case "/api/settings/ibroadcast/schedule" when HttpMethods.IsPost(m):
                {
                    var (sb, _) = await Http.ReadJs(ctx);
                    var patch = sb is Tags.JsObj so ? JsonNode.Parse(Tags.Js.Json(so) ?? "{}") as JsonObject ?? [] : [];
                    var (_, refused) = IB.IBroadcastSchedule.Save(patch);
                    if (refused != null) return await Http.Json(ctx, new JsonObject { ["error"] = refused }, 409);
                    return await Http.Json(ctx, WithLibrary(ib.Status()));
                }
                case "/api/settings/ibroadcast/signin" when HttpMethods.IsPost(m):
                    return await Http.Json(ctx, await ib.BeginSignIn());
                case "/api/settings/ibroadcast/signin/cancel" when HttpMethods.IsPost(m):
                    ib.CancelSignIn();
                    return await Http.Json(ctx, ib.Status());
                case "/api/settings/ibroadcast/signout" when HttpMethods.IsPost(m):
                    Jobs.IBroadcastUpload?.Stop();
                    return await Http.Json(ctx, await ib.SignOut());
                default:
                    return false;
            }
        }
        catch (ServiceError e) when (!ctx.Response.HasStarted)
        {
            var o = new JsonObject { ["error"] = e.Message };
            if (e.Status == 401) o["connected"] = false;
            return await Http.Json(ctx, o, e.Status);
        }
    }

    /* The state with the library's, signed in: whether it is in the library, being read, and what the last reading found. */
    private static JsonObject WithLibrary(JsonObject o)
    {
        if (o["connected"] is not JsonValue v || !v.GetValue<bool>()) return o;
        var st = IB.IBroadcastLibrary.State();
        o["library"] = new JsonObject
        {
            ["import"] = IB.IBroadcastLibrary.Shown(), ["reading"] = Jobs.IBroadcastLibrary?.Reading ?? false,
            ["albums"] = st?["albums"]?.DeepClone(), ["also_here"] = st?["also_here"]?.DeepClone(), ["tracks"] = st?["tracks"]?.DeepClone(), ["at"] = st?["at"]?.DeepClone(),
        };
        o["upload"] = Jobs.IBroadcastUpload?.Status();
        o["schedule"] = IB.IBroadcastSchedule.Stored();
        o["scanner_hours"] = IB.IBroadcastSchedule.ScannerHours();
        o["upload_settings"] = IB.IBroadcastUploadChoices.Json(IB.IBroadcastUploadChoices.Stored());
        o["upload_sources"] = IB.IBroadcastUploadChoices.SourcesJson();
        o["upload_speed"] = IB.IBroadcastUploadSpeed.Json(IB.IBroadcastUploadSpeed.Stored());
        return o;
    }
}
