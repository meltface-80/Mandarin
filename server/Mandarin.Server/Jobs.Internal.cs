// Jobs.Internal.cs — the routes the tests call of the background work
// (Jobs.cs): from this machine, with the front key. Which, and what each
// answers, is said above UseInternal.
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Jobs
{
    /*
     * From this machine, with the front key (the tests'): POST
     * /internal/jobs/after-scan (what follows a library scan, made now), POST
     * /internal/jobs/taste (the taste graph built again now, from the plays as
     * they are: it is otherwise built once a day), POST /internal/jobs/prune
     * (the services' month's prune made now, as the daily timer makes it),
     * POST /internal/jobs/watch (the services' favourites looked at now, as
     * the watch's timer looks) and POST /internal/playback/revision (the hub's
     * change counter set, then bumped).
     */
    public static void UseInternal(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            var p = ctx.Request.Path.Value;
            if (p is not ("/internal/jobs/after-scan" or "/internal/jobs/taste" or "/internal/jobs/prune" or "/internal/jobs/watch" or "/internal/playback/revision")) { await next(); return; }
            var from = ctx.Connection.RemoteIpAddress;
            var given = ctx.Request.Headers["X-Mandarin-Front-Key"].ToString();
            if (from == null || !System.Net.IPAddress.IsLoopback(from) || !HttpMethods.IsPost(ctx.Request.Method)
                || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(given), Encoding.UTF8.GetBytes(Library.FrontKey)))
            {
                ctx.Response.StatusCode = 404;
                return;
            }
            ctx.Response.ContentType = "application/json";
            if (p == "/internal/playback/revision")
            {
                // The hub's change counter set (the tests: a server up a while, or started again), then bumped as a change would.
                if (Playback.Hub.Current is not { } hub) { ctx.Response.StatusCode = 409; await ctx.Response.WriteAsync("{\"ok\":false}"); return; }
                JsonObject? rb = null;
                try { rb = await System.Net.Http.Json.HttpContentJsonExtensions.ReadFromJsonAsync<JsonObject>(new StreamContent(ctx.Request.Body)); }
                catch (System.Text.Json.JsonException) { /* no body: a bump alone */ }
                if (rb?["revision"] is JsonValue rv && rv.TryGetValue<double>(out var rev)) lock (hub.Gate) hub.Revision = (long)rev;
                hub.Bump();
                await ctx.Response.WriteAsync(new JsonObject { ["ok"] = true, ["revision"] = hub.Revision }.ToJsonString());
                return;
            }
            if (p == "/internal/jobs/after-scan")
            {
                await AfterScan();
                await ctx.Response.WriteAsync("{\"ok\":true}");
                return;
            }
            if (p == "/internal/jobs/watch")
            {
                if (await Services.Import.WatchNow() is not { } seen) { ctx.Response.StatusCode = 409; await ctx.Response.WriteAsync("{\"ok\":false}"); return; }
                var looked = new Tags.JsObj();
                looked["ok"] = true;
                looked["services"] = seen;
                await ctx.Response.WriteAsync(Tags.Js.Json(looked) ?? "{}");
                return;
            }
            if (p == "/internal/jobs/prune")
            {
                if (await Services.Prune.Run() is not { } pruned) { ctx.Response.StatusCode = 409; await ctx.Response.WriteAsync("{\"ok\":false}"); return; }
                var done = new Tags.JsObj();
                done["ok"] = true;
                done["removed"] = pruned;
                await ctx.Response.WriteAsync(Tags.Js.Json(done) ?? "{}");
                return;
            }
            if (!Holds("taste") || Taste is not { } t) { ctx.Response.StatusCode = 409; await ctx.Response.WriteAsync("{\"ok\":false}"); return; }
            var b = await t.Rebuild();
            var near = new JsonObject();
            foreach (var (k, v) in b.Graph) near[k] = v.Score;
            await ctx.Response.WriteAsync(new JsonObject
            {
                ["ok"] = true, ["day"] = b.Day, ["near"] = near,
                ["heavy"] = new JsonArray(b.Heavy.Select(h => (JsonNode)h).ToArray()),
                ["played"] = new JsonArray(b.Played.Select(h => (JsonNode)h).ToArray())
            }.ToJsonString());
        });
    }
}
