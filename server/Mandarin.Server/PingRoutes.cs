// PingRoutes.cs — GET /api/ping: is this server there, answered at once.
//
//   { ok: true, version, id }
//
// The Android app tells home from away by the server answering on the home
// network within a second and a half. /api/health did work for that answer
// (the conversions' cache counted, the library's copy waited for after a
// start, a busy database waited on), and one slow answer was taken for being
// away. This reads nothing: the version, and this server's id (the serverId
// setting, made at its first start and kept since, a database put back from a
// backup included: Admin/Backup.cs), both held here from the start. Open, as
// /api/health is, and answered ahead of everything else, the gate included.
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static class PingRoutes
{
    private static byte[] answer = [];

    /* This server's id, made the first time (Program.cs, once the database is up to date). */
    public static string Id { get; private set; } = "";

    /* The id read, or made and kept; the answer written once. */
    public static void Init(string version)
    {
        using (var c = Db.Open())
        {
            if (Db.Setting(c, "serverId") is JsonValue v && v.TryGetValue<string>(out var id) && id.Length > 0) Id = id;
            else
            {
                Id = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
                Playback.QueueStore.SetSetting(c, "serverId", JsonValue.Create(Id));
            }
        }
        answer = System.Text.Encoding.UTF8.GetBytes(new JsonObject { ["ok"] = true, ["version"] = version, ["id"] = Id }.ToJsonString());
    }

    public static void Use(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            var p = ctx.Request.Path.Value;
            var get = HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method);
            if (!(get && p == "/api/ping")) { await next(); return; }
            // Never kept on the way: an answer from a cache says nothing of the server.
            ctx.Response.Headers.CacheControl = "no-store";
            ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
            ctx.Response.ContentType = Http.JsonType;
            ctx.Response.ContentLength = answer.Length;
            if (!HttpMethods.IsHead(ctx.Request.Method)) await ctx.Response.Body.WriteAsync(answer);
        });
    }
}
