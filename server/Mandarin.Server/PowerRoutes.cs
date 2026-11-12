// PowerRoutes.cs — Restart and Shut down, from the power button in the side
// menu, and how the processor is shared out (v0.8.31; stage 1d of
// old/csharp-migration.md), from lib/server/api-power.js and
// lib/server/api-cpu.js, in the same shapes:
//
//   GET  /api/system/power     what this install can do: { restart, shutdown, start_again }
//   POST /api/system/restart   the server started again
//   POST /api/system/shutdown  stopped, to stay stopped
//   GET  /api/cpu              the cores playback keeps and the rest (lib/cpu.js plan())
//   POST /api/cpu             { making_cores: "auto" | 1 | 2 | 3 }: the cores a track made as it plays has (item 260)
//
// Restart: this program starts again in this same process, on every core it
// started with (Server.StartAgain, as after an update).
//
// Shut down: it stops and stays stopped until started again.
//   - On Mandarin OS (MANDARIN_OS, item 389) the computer is Mandarin's alone and has no shell to start it again
//     from, so the computer shuts down: asked of Mandarin OS by a file (/run/mandarin-os/power/request, which a
//     systemd path unit of its own acts on), and the computer's power button starts it all again.
//   - Anywhere else it leaves with 0.
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
    /* What this install can do, and how it's started again after Shut down ([env]: this machine's, or a case's). */
    internal static JsonObject PowerInfo(Func<string, string?>? env = null)
    {
        env ??= Environment.GetEnvironmentVariable;
        // Installed on Linux as a systemd service (tools/linux/install.sh): started again with systemctl, or the computer.
        var service = env("MANDARIN_SYSTEMD") is { Length: > 0 };
        var os = env("MANDARIN_OS") is { Length: > 0 };
        return new JsonObject
        {
            ["restart"] = true,
            ["shutdown"] = true,
            // "service": the Linux installer's systemd service (systemctl start, or the computer started again);
            // "power-button": Mandarin OS, the computer shut down with it; "manual": however it was started.
            ["start_again"] = os ? "power-button" : service ? "service" : "manual"
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
                : HttpMethods.IsPost(m) && p == "/api/cpu" ? await CpuSet(ctx)
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
        var first = Server.LeaveBy(Server.Leave.ShutDown);
        await Send(ctx, new JsonObject { ["ok"] = true, ["start_again"] = info["start_again"]?.GetValue<string>() });
        if (first)
        {
            _ = Task.Delay(300).ContinueWith(_ =>
            {
                if (info["start_again"]?.GetValue<string>() == "power-button") AskComputerOff();
                Server.StopApp?.Invoke();
            }, TaskScheduler.Default);
        }
        return true;
    }

    /*
     * Mandarin OS asked to shut the computer down: "poweroff" in its request file, which its path unit
     * (mandarin-os-power.path) acts on as root. Mandarin stops as well, so its library is saved before the
     * computer goes; if the file can't be written, Mandarin is shut down alone, and the log says why.
     */
    private static void AskComputerOff()
    {
        var file = Environment.GetEnvironmentVariable("MANDARIN_OS_POWER") is { Length: > 0 } f ? f : "/run/mandarin-os/power/request";
        try
        {
            File.WriteAllText(file, "poweroff\n");
            Server.Log("[power] Mandarin OS asked to shut the computer down");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Server.Log($"[power] couldn't ask Mandarin OS to shut the computer down ({e.Message}); Mandarin alone is shut down");
        }
    }

    /* GET /api/cpu: the split as decided here (v0.8.48, Cpu.cs). */
    private static Task<bool> CpuPlan(HttpContext ctx) => Send(ctx, Cpu.Plan());

    /* POST /api/cpu: the cores a making has (item 260), "auto" or 1 to all but one of them; the split as it then is. */
    private static async Task<bool> CpuSet(HttpContext ctx)
    {
        var b = await Auth.Body(ctx);
        var v = b?["making_cores"];
        var most = Math.Max(1, Cpu.Expand(Cpu.Startup).Length - 1);
        int? n = v is JsonValue jv && jv.TryGetValue<string>(out var word) && word == "auto" ? 0
            : v is JsonValue nv && nv.TryGetValue<double>(out var d) && d == Math.Floor(d) && d >= 1 && d <= Math.Min(3, most) ? (int)d : null;
        if (n is not { } cores) return await Send(ctx, new JsonObject { ["error"] = $"making_cores must be \"auto\" or 1 to {Math.Min(3, most)}" }, 400);
        Cpu.SetMakingCores(cores);
        return await Send(ctx, Cpu.Plan());
    }
}
