// Jobs.Internal.cs — the routes the Node server and the tests call of the
// background work this server holds (Jobs.cs): from this machine, with the
// front key. Which, and what each answers, is said above UseInternal.
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Jobs
{
    /*
     * From this machine, with the front key: POST /internal/jobs/after-scan (the
     * Node server, a library scan ended), POST /internal/jobs/taste (the taste
     * graph built again now, from the plays as they are; the tests, after
     * writing plays: it is otherwise built once a day), POST /internal/jobs/prune
     * (the services' month's prune made now, as the daily timer makes it: the
     * tests), POST /internal/jobs/import (the Node server, an import it would
     * have started itself: ?service=<s> after a sign-in, ?after=rescan after a
     * Rescan), POST /internal/jobs/watch (the services' favourites looked at
     * now, as the watch's timer looks: the tests), POST /internal/services/played
     * (the Node server, a streamed track a speaker fetched from it by its own
     * address: the play reported here, v0.8.47), POST /internal/cpu/dsp (the
     * Node server, a DSP conversion of its own started or ended, { on }: the
     * split decided here answered, v0.8.48) and GET /internal/tailscale (how
     * the engine run here is: the Node server gives phones its address).
     */
    public static void UseInternal(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            var p = ctx.Request.Path.Value;
            if (p is not ("/internal/jobs/after-scan" or "/internal/jobs/taste" or "/internal/jobs/prune" or "/internal/jobs/import" or "/internal/jobs/watch"
                or "/internal/services/played" or "/internal/cpu/dsp" or "/internal/tailscale")) { await next(); return; }
            var from = ctx.Connection.RemoteIpAddress;
            var given = ctx.Request.Headers["X-Mandarin-Front-Key"].ToString();
            var method = p == "/internal/tailscale" ? HttpMethods.IsGet(ctx.Request.Method) : HttpMethods.IsPost(ctx.Request.Method);
            if (from == null || !System.Net.IPAddress.IsLoopback(from) || !method
                || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(given), Encoding.UTF8.GetBytes(key)))
            {
                ctx.Response.StatusCode = 404;
                return;
            }
            ctx.Response.ContentType = "application/json";
            if (p == "/internal/tailscale")
            {
                await ctx.Response.WriteAsync(Tailscale is { } t0 && Holds("tailscale") ? Tags.Js.Json(t0.Status()) ?? "{}" : "{\"handed\":false}");
                return;
            }
            if (p == "/internal/jobs/after-scan")
            {
                await AfterScan();
                await ctx.Response.WriteAsync("{\"ok\":true}");
                return;
            }
            if (p == "/internal/cpu/dsp")
            {
                if (!Cpu.Deciding || !Holds("cpu")) { ctx.Response.StatusCode = 409; await ctx.Response.WriteAsync("{\"ok\":false}"); return; }
                JsonObject? body = null;
                try { body = await System.Net.Http.Json.HttpContentJsonExtensions.ReadFromJsonAsync<JsonObject>(new StreamContent(ctx.Request.Body)); }
                catch (System.Text.Json.JsonException) { /* no body: off */ }
                Cpu.Dsp(body?["on"] is JsonValue ov && ov.TryGetValue<bool>(out var dspOn) && dspOn, node: true);
                await ctx.Response.WriteAsync(new JsonObject { ["ok"] = true, ["cpu"] = Cpu.Plan() }.ToJsonString());
                return;
            }
            if (p == "/internal/jobs/import")
            {
                var made = Services.Import.Now(ctx.Request.Query["service"].ToString(), ctx.Request.Query["after"].ToString() == "rescan");
                if (!made) ctx.Response.StatusCode = 409;
                await ctx.Response.WriteAsync(made ? "{\"ok\":true}" : "{\"ok\":false}");
                return;
            }
            if (p == "/internal/services/played")
            {
                // As the Node server's /stream would have: the play reported (Qobuz), as a device fetching it here is.
                var q = ctx.Request.Query;
                var row = long.TryParse(q["track"].ToString(), out var tid) ? Services.Catalogue.Row(tid) : null;
                var svc = row == null ? null : Services.Catalogue.Of(row.Path);
                if (svc == null || !Holds("services")) { ctx.Response.StatusCode = 409; await ctx.Response.WriteAsync("{\"ok\":false}"); return; }
                var plan = new Tags.JsObj();
                if (double.TryParse(q["rate"].ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var rate)) plan["rate"] = rate;
                svc.Played(row!, plan);
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
