using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Mandarin.StandIns;

/// <summary>
/// The Tailscale engine (musicdnet) as far as the server uses it: its control API on a port of its own,
/// said on its first line ("CONTROL port"), every call checked against MUSICDNET_SECRET and written down
/// in calls.log beside the script, the arguments it was started with in args.txt (and whether an auth
/// key leaked into its environment). Signed in by an auth key, or waiting for a sign-in link; with
/// TS_STUB_STALE, Running but never online. It leaves when its input closes, as the real one does; with
/// TS_STUB_LINGER, not until it is killed (an engine slow to leave, item 181).
/// </summary>
public static class Musicdnet
{
    /// <summary>Served until stdin closes.</summary>
    public static async Task<int> Run(string script, string[] args)
    {
        var dir = Path.GetDirectoryName(Path.GetFullPath(script))!;
        var log = Path.Combine(dir, "calls.log");
        var secret = Environment.GetEnvironmentVariable("MUSICDNET_SECRET");
        var stale = Environment.GetEnvironmentVariable("TS_STUB_STALE") is { Length: > 0 };
        var gate = new object();
        JsonObject st = new() { ["state"] = "Stopped", ["ips"] = new JsonArray(), ["serving"] = "" };

        var b = WebApplication.CreateSlimBuilder();
        b.Logging.ClearProviders();
        b.WebHost.ConfigureKestrel(k => k.Listen(IPAddress.Loopback, 0));
        var app = b.Build();
        app.Run(async ctx =>
        {
            if ((string?)ctx.Request.Headers["x-secret"] != secret) { ctx.Response.StatusCode = 403; return; }
            var body = await new StreamReader(ctx.Request.Body, Encoding.UTF8).ReadToEndAsync();
            var path = ctx.Request.Path.Value ?? "";
            JsonNode reply;
            int code = 200;
            lock (gate)
            {
                File.AppendAllText(log, ctx.Request.Method + " " + path + ctx.Request.QueryString + " " + body + "\n");
                switch (path)
                {
                    case "/start":
                        var asked = string.IsNullOrEmpty(body) ? new JsonObject() : JsonNode.Parse(body)!.AsObject();
                        st = asked["AuthKey"] is JsonValue key && key.ToString().Length > 0
                            ? new JsonObject { ["state"] = "Running", ["ips"] = new JsonArray("100.90.1.2", "fd7a:115c:a1e0::1"), ["dns_name"] = "musicd.tail1.ts.net.", ["serving"] = "" }
                            : new JsonObject { ["state"] = "NeedsLogin", ["auth_url"] = "https://login.tailscale.com/a/abc123", ["ips"] = new JsonArray(), ["serving"] = "" };
                        reply = st.DeepClone();
                        break;
                    case "/status": reply = st.DeepClone(); break;
                    case "/login": st["auth_url"] = "https://login.tailscale.com/a/new456"; reply = st.DeepClone(); break;
                    case "/logout": st = new JsonObject { ["state"] = "NeedsLogin", ["ips"] = new JsonArray(), ["serving"] = "" }; reply = st.DeepClone(); break;
                    case "/serve":
                        st["serving"] = "100.90.1.2:" + ctx.Request.Query["port"];
                        if (stale) st["online"] = false;
                        reply = new JsonObject { ["addr"] = st["serving"]!.DeepClone() };
                        break;
                    case "/rebind": reply = new JsonObject { ["ok"] = true }; break;
                    default: reply = new JsonObject { ["error"] = "no" }; code = 404; break;
                }
            }
            ctx.Response.StatusCode = code;
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsync(reply.ToJsonString());
        });
        await app.StartAsync();
        var port = new Uri(app.Urls.First()).Port;
        File.WriteAllText(Path.Combine(dir, "args.txt"), string.Join(" ", args) + "\n" + (Environment.GetEnvironmentVariable("TS_AUTHKEY") != null ? "leaked" : "ok"));
        Console.Out.Write("CONTROL " + port + "\n");
        Console.Out.Flush();
        // Until the server lets go of it.
        await Console.OpenStandardInput().CopyToAsync(Stream.Null);
        if (Environment.GetEnvironmentVariable("TS_STUB_LINGER") is { Length: > 0 }) await Task.Delay(Timeout.Infinite);
        await app.StopAsync();
        return 0;
    }
}
