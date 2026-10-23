using System.Globalization;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging;

namespace Mandarin.StandIns;

/// <summary>
/// Spotify Soloist (bug list item 142) as far as the server uses it. <c>--version</c> says a build made ten days
/// ago. Started, it writes down beside the script each start (starts.log), what the account's prefs held as it
/// started (prefs.log) and the key it was given (key.txt); says the key on a warning line (the server must take it
/// out); makes the account a phone has paired (settings/Users/tester-user); opens its WebSocket (ws.port, ws.addr
/// in --data-dir), says it is signed in, chosen and playing a track, and writes down each command (commands.log).
/// Its sound is the PulseAudio stand-in's. It runs until it is killed, as the real one does.
/// </summary>
public static class Soloist
{
    /// <summary>Served until killed.</summary>
    public static async Task<int> Run(string script, string[] args)
    {
        if (args.Contains("--version"))
        {
            Console.WriteLine("soloist 1.3.9 (" + DateTime.UtcNow.AddDays(-10).ToString("yyyyMMdd", CultureInfo.InvariantCulture) + ")");
            return 0;
        }
        var dir = Path.GetDirectoryName(Path.GetFullPath(script))!;
        string Arg(string name) { var i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : ""; }
        var data = Arg("--data-dir");
        var key = Arg("--api-key");
        var account = Path.Combine(data, "settings", "Users", "tester-user");
        var prefs = Path.Combine(account, "prefs");
        File.AppendAllText(Path.Combine(dir, "starts.log"), "start\n");
        File.AppendAllText(Path.Combine(dir, "prefs.log"), (File.Exists(prefs) ? File.ReadAllText(prefs).Replace("\n", " ", StringComparison.Ordinal) : "none") + "\n");
        File.WriteAllText(Path.Combine(dir, "key.txt"), key);
        Console.WriteLine("WARN: started with api key " + key);
        Directory.CreateDirectory(account);

        var b = WebApplication.CreateSlimBuilder();
        b.Logging.ClearProviders();
        b.WebHost.ConfigureKestrel(k => k.Listen(IPAddress.Loopback, 0));
        var app = b.Build();
        app.UseWebSockets();
        var commands = Path.Combine(dir, "commands.log");
        app.Run(async ctx =>
        {
            if (!ctx.WebSockets.IsWebSocketRequest) { ctx.Response.StatusCode = 400; return; }
            using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
            async Task Say(JsonObject o) => await ws.SendAsync(Encoding.UTF8.GetBytes(o.ToJsonString()), WebSocketMessageType.Text, true, CancellationToken.None);
            await Say(new JsonObject { ["type"] = "auth_state", ["logged_in"] = true, ["is_active"] = true });
            await Say(new JsonObject
            {
                ["type"] = "playback_state", ["status"] = "playing", ["is_active"] = true, ["volume"] = 100,
                ["item"] = Track(),
                ["position"] = new JsonObject { ["position_ms"] = 1000, ["timestamp_ms"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), ["speed"] = 1 }
            });
            var buf = new byte[1 << 16];
            while (ws.State == WebSocketState.Open)
            {
                var got = await ws.ReceiveAsync(buf, CancellationToken.None);
                if (got.MessageType == WebSocketMessageType.Close) return;
                File.AppendAllText(commands, Encoding.UTF8.GetString(buf, 0, got.Count) + "\n");
            }
        });
        await app.StartAsync();
        var port = new Uri(app.Urls.First()).Port;
        File.WriteAllText(Path.Combine(data, "ws.addr"), "127.0.0.1");
        File.WriteAllText(Path.Combine(data, "ws.port"), port.ToString(CultureInfo.InvariantCulture));
        await Task.Delay(Timeout.Infinite);
        return 0;
    }

    private static JsonObject Named(string name) => new() { ["entity"] = new JsonObject { ["decorations"] = new JsonObject { ["identity"] = new JsonObject { ["name"] = name } } } };

    private static JsonObject Track() => new()
    {
        ["uri"] = "spotify:track:standin",
        ["entity"] = new JsonObject
        {
            ["decorations"] = new JsonObject
            {
                ["identity"] = new JsonObject { ["name"] = "A Stand-in Song" },
                ["creators"] = new JsonArray(Named("The Stand-ins")),
                ["parent"] = Named("Stood In"),
                ["visual_identity"] = new JsonObject { ["cover"] = new JsonArray(new JsonObject { ["size"] = "large", ["url"] = "http://127.0.0.1:9/cover.jpg" }) },
                ["playback"] = new JsonObject { ["duration_ms"] = 200_000 }
            }
        }
    };
}
