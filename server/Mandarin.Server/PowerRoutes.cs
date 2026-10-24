// PowerRoutes.cs — Restart and Shut down, from the power button in the side
// menu, and how the processor is shared out (v0.8.31; stage 1d of
// old/csharp-migration.md), from lib/server/api-power.js and
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
//   - On a Mac, with the login item the installer makes (tools/mac/install.sh),
//     launchd would start again a job that merely exited, so the job is unloaded
//     instead (launchctl bootout) and the Mandarin icon on the desktop loads it
//     again. It also starts again at the next login.
//   - Anywhere else outside Docker it leaves with 0.
//   - In Docker the container's restart policy brings any exit straight back,
//     so Shut down isn't offered: `docker stop` is the way.
//
// Both only from home: away (over Tailscale) a phone could switch off the
// server it can't then reach to start again.
//
// The processor split: decided here (v0.8.48, Cpu.cs), /api/cpu answering
// with the decision.
using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class Library
{
    [GeneratedRegex(@"^app\.mandarin\.[a-z0-9.-]+$", RegexOptions.IgnoreCase)]
    private static partial Regex LaunchdLabelRule();

    /* The launchd job this server runs as, when it's the installer's login item ([env]: this process's, or a case's). */
    private static string? LaunchdLabel(Func<string, string?>? env = null)
    {
        env ??= Environment.GetEnvironmentVariable;
        var label = env("MANDARIN_LAUNCHD") is { Length: > 0 } l ? l : env("XPC_SERVICE_NAME") ?? "";
        return LaunchdLabelRule().IsMatch(label) ? label : null;
    }

    /* What this install can do, and how it's started again after Shut down ([env], [mac]: this machine's, or a case's). */
    internal static JsonObject PowerInfo(Func<string, string?>? env = null, bool? mac = null)
    {
        env ??= Environment.GetEnvironmentVariable;
        var docker = env("DOCKER") == "1";
        var label = mac ?? OperatingSystem.IsMacOS() ? LaunchdLabel(env) : null;
        return new JsonObject
        {
            ["restart"] = true,
            ["shutdown"] = !docker,
            ["docker"] = docker,
            // "icon": the Mandarin icon on the Mac's desktop; "docker": docker start;
            // "manual": however it was started (a service manager, by hand).
            ["start_again"] = docker ? "docker" : label != null ? "icon" : "manual"
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
        if (first)
        {
            _ = Task.Delay(300).ContinueWith(async _ =>
            {
                var label = OperatingSystem.IsMacOS() ? LaunchdLabel() : null;
                if (label == null || !await UnloadLoginItem(label)) Server.StopApp?.Invoke();
            }, TaskScheduler.Default);
        }
        return true;
    }

    /*
     * The login item, unloaded: launchd stops this server (SIGTERM, a clean
     * stop) and doesn't start it again until the icon
     * or the next login loads it. False if neither way would do it.
     */
    private static async Task<bool> UnloadLoginItem(string label)
    {
        if (await Launchctl("bootout", $"gui/{Server.Uid()}/{label}")) return true;
        // Older launchctl, or bootout refused: the legacy form does the same.
        var plist = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Library", "LaunchAgents", label + ".plist");
        if (await Launchctl("unload", plist)) return true;
        Server.Log($"[power] couldn't unload {label}; stopping anyway");
        return false;
    }

    private static async Task<bool> Launchctl(params string[] args)
    {
        try
        {
            var psi = new ProcessStartInfo("launchctl") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var a in args) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi);
            if (p == null) return false;
            _ = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            await p.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
            return p.ExitCode == 0;
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException or TimeoutException) { return false; }
    }

    /* GET /api/cpu: the split as decided here (v0.8.48, Cpu.cs). */
    private static Task<bool> CpuPlan(HttpContext ctx) => Send(ctx, Cpu.Plan());
}
