// Front.Failed.cs — a request that failed here (v0.9.0, stage 7 part 7). Until
// v0.9.0 a route that threw handed the request to the Node server behind this
// one; with nothing behind it, the request fell through to "No such endpoint".
// It is answered here instead, as the Node server's routes answered a thrown
// error (wrap: 500 and why).
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Front
{
    /* Logged ("[area] /path: Type: message") and answered: 500 and why, as JSON. True: answered. */
    public static async Task<bool> Failed(HttpContext ctx, string area, Exception e)
    {
        Log($"[{area}] {ctx.Request.Path}: {e.GetType().Name}: {e.Message}");
        if (ctx.Response.HasStarted) return true;
        ctx.Response.StatusCode = 500;
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        ctx.Response.ContentType = "application/json; charset=utf-8";
        await ctx.Response.WriteAsync(new JsonObject { ["error"] = e.Message }.ToJsonString());
        return true;
    }
}
