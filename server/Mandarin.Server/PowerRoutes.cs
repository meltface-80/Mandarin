// PowerRoutes.cs — Restart and Shut down, from the power button in the side
// menu, and how the processor is shared out (v0.8.31; stage 1d of
// docs/specs/csharp-migration.md), from lib/server/api-power.js and
// lib/server/api-cpu.js, in the same shapes:
//
//   GET  /api/system/power     what this install can do: { restart, shutdown, docker, start_again }
//   POST /api/system/restart   the server started again
//   POST /api/system/shutdown  stopped, to stay stopped (not in Docker)
//   GET  /api/cpu              the cores playback keeps and the rest (lib/cpu.js plan())
//
// Restart: this program starts again in this same process, on every core it
// started with (Server.StartAgain, as after an update).
//
// Shut down: it stops and stays stopped until started again.
//   - Outside Docker it leaves with 0. (v0.6.12 to v1.0.2, a Mac's login item
//     was unloaded instead; Mac support was dropped in v1.0.3.)
//   - In Docker the container's restart policy brings any exit straight back,
//     so Shut down isn't offered: `docker stop` is the way.
//
// Both only from home: away (over Tailscale) a phone could switch off the
// server it can't then reach to start again.
//
// The processor split: decided here (v0.8.48, Cpu.cs), /api/cpu answering
// with the decision.
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Library
{
    /* What this install can do, and how it's started again after Shut down ([env]: this process's, or a case's). */
    internal static JsonObject PowerInfo(Func<string, string?>? env = null)
    {
        env ??= Environment.GetEnvironmentVariable;
        var docker = env("DOCKER") == "1";
        return new JsonObject
        {
            ["restart"] = true,
            ["shutdown"] = !docker,
            ["docker"] = docker,
            // "docker": docker start; "manual": however it was started (a service manager, by hand).
            ["start_again"] = docker ? "docker" : "manual"
        };
    }

    /* The power and processor routes: true when answered here. */
    private static async Task<bool> PowerRoute(HttpContext ctx)
    {
        var m = ctx.Request.Method;
        var p = ctx.Request.Path.Value ?? "";
        try
        {
            return (HttpMethods.IsGet(m) || HttpMethods.IsHead(m)) && p == "/api/system/power" ? await SystemPower(ctx)
                : (HttpMethods.IsGet(m) || HttpMethods.IsHead(m)) && p == "/api/cpu" ? await CpuPlan(ctx)
                : HttpMethods.IsPost(m) && p == "/api/system/restart" ? await SystemRestart(ctx)
                : HttpMethods.IsPost(m) && p == "/api/system/shutdown" && await SystemShutdown(ctx);
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            Server.Log($"[power] {p}: {e.GetType().Name}: {e.Message}; not answered");
            return false;
        }
    }

    private static Task<bool> SystemPower(HttpContext ctx) => Send(ctx, PowerInfo());

    private static async Task<bool> SystemRestart(HttpContext ctx)
    {
        if (Auth.IsAway(ctx)) return await Send(ctx, new JsonObject { ["error"] = "Restart only from home", ["away"] = true }, 403);
        var first = Server.LeaveBy(Server.Leave.Restart);
        await Send(ctx, new JsonObject { ["ok"] = true, ["restarting"] = true });
        if (first) _ = Task.Delay(300).ContinueWith(_ => Server.StopApp?.Invoke(), TaskScheduler.Default);
        return true;
    }

    private static async Task<bool> SystemShutdown(HttpContext ctx)
    {
        if (Auth.IsAway(ctx)) return await Send(ctx, new JsonObject { ["error"] = "Shut down only from home", ["away"] = true }, 403);
        var info = PowerInfo();
        if (info["shutdown"]?.GetValue<bool>() != true)
            return await Send(ctx, new JsonObject { ["error"] = "In Docker, stop the container instead: docker stop musicd-server" }, 409);
        var first = Server.LeaveBy(Server.Leave.ShutDown);
        await Send(ctx, new JsonObject { ["ok"] = true, ["start_again"] = info["start_again"]?.GetValue<string>() });
        if (first) _ = Task.Delay(300).ContinueWith(_ => Server.StopApp?.Invoke(), TaskScheduler.Default);
        return true;
    }

    /* GET /api/cpu: the split as decided here (v0.8.48, Cpu.cs). */
    private static Task<bool> CpuPlan(HttpContext ctx) => Send(ctx, Cpu.Plan());
}
