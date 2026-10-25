// Auth.Open.cs — Mandarin without an account (bug list item 161, v1.1.8).
//
// A TV showing the shelf or the wall has no easy way to type a username and a
// password. So asking for a sign-in is a choice: a new install can be used
// without an account ("Use without an account" on the setup page), and an
// existing one can stop asking (Settings → Account, Ask for a sign-in). An
// install that already has an account keeps asking until it is switched off.
//
// With the sign-in off, anything on the home network or on the owner's own
// Tailscale network is let in; from anywhere else (a port forwarded to the
// internet) a sign-in is still needed, and with no account there is none to
// give. Each browser and app is still a device of its own, made without a
// password, so phone zones, the devices list and Sign out keep working:
// a browser opening a page is given its cookie there and then; the Android
// app asks for its token (/api/auth/join).
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Auth
{
    private const string OpenKey = "openAccess";

    /* Whether the sign-in is off: the setting, false until it is switched off. */
    public static bool OpenMode(SqliteConnection c) => Db.Setting(c, OpenKey) is JsonValue v && v.TryGetValue<bool>(out var b) && b;

    /* Tailscale's addresses (100.64.0.0/10, fd7a:115c:a1e0::/48): the owner's own network away from home. */
    public static bool IsTailnet(string ip)
    {
        var a = ip ?? "";
        if (a.StartsWith("::ffff:", StringComparison.Ordinal)) a = a[7..];
        if (a.StartsWith("fd7a:115c:a1e0:", StringComparison.OrdinalIgnoreCase)) return true;
        var parts = a.Split('.');
        if (parts.Length != 4 || !parts.All(p => p.Length is > 0 and <= 3 && p.All(char.IsAsciiDigit))) return false;
        int x = int.Parse(parts[0], System.Globalization.CultureInfo.InvariantCulture), y = int.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture);
        return x == 100 && y >= 64 && y <= 127;
    }

    /* The sign-in is off, and this request comes from the home network or the tailnet. */
    public static bool OpenHere(HttpContext ctx, SqliteConnection c)
    {
        var ip = ClientIp(ctx);
        return (IsLocal(ip) || IsTailnet(ip)) && OpenMode(c);
    }

    /* Let in: a signed-in device, or anything the sign-in being off lets in. For the media routes' own look (Streams.cs, Images.cs). */
    public static bool Through(HttpContext ctx, SqliteConnection c) => DeviceOf(ctx, c) != null || OpenHere(ctx, c);

    // The gate's word on a request with no device: let in when the sign-in is
    // off here; a browser opening a page is made a device as it comes in.
    private static bool OpenIn(HttpContext ctx, SqliteConnection c)
    {
        if (!OpenHere(ctx, c)) return false;
        var p = ctx.Request.Path.Value ?? "/";
        if (ctx.Request.Method == "GET" && !p.StartsWith("/api/", StringComparison.Ordinal) && !IsMedia(p)
            && ctx.Request.Headers.Accept.ToString().Contains("text/html", StringComparison.OrdinalIgnoreCase))
            Join(ctx, c, new JsonObject(), cookie: true);
        return true;
    }

    // A device made without a password: its cookie set, or its token handed back.
    private static (string token, JsonObject device) Join(HttpContext ctx, SqliteConnection c, JsonObject b, bool cookie)
    {
        var (token, device) = IssueDevice(ctx, c, b);
        if (cookie) SetCookie(ctx, token, true);
        ctx.Items["device"] = new Device(Js.Str(device["id"]), Js.Str(device["name"]), Js.Str(device["kind"]), Now);
        return (token, device);
    }

    private static void SetOpen(SqliteConnection c, bool on) => Playback.QueueStore.SetSetting(c, OpenKey, JsonValue.Create(on));

    // ------------------------------------------------------------ the routes

    public static void MapOpen(WebApplication app)
    {
        app.MapMethods("/api/auth/status", Http.GetOrHead, (HttpContext ctx) =>
        {
            using var c = Db.Open();
            var acct = GetAccount(c);
            var dev = DeviceOf(ctx, c);
            bool open = OpenMode(c);
            return Json(ctx, 200, new JsonObject
            {
                ["setup_required"] = acct == null,
                ["can_setup"] = acct == null && IsLocal(ClientIp(ctx)),
                ["away"] = IsAway(ctx),
                ["signed_in"] = dev != null,
                ["username"] = dev != null ? acct?.Username : null,
                ["device"] = dev != null ? new JsonObject { ["id"] = dev.Id, ["name"] = dev.Name, ["kind"] = dev.Kind } : null,
                // The sign-in off (item 161): "open", and whether it lets this caller in ("open_here").
                ["open"] = open,
                ["open_here"] = open && OpenHere(ctx, c)
            });
        });

        // This browser or app made a device, no password asked: only while the sign-in is off, and only here.
        app.MapPost("/api/auth/join", async (HttpContext ctx) =>
        {
            var b = await Body(ctx);
            if (b == null) return;
            using var c = Db.Open();
            if (!OpenHere(ctx, c)) { await Json(ctx, 403, new JsonObject { ["error"] = "Sign in to Mandarin", ["sign_in_required"] = true }); return; }
            await Joined(ctx, c, b);
        });

        // Ask for a sign-in, or not (Settings → Account; the setup page's "Use without an account").
        app.MapPost("/api/auth/open", async (HttpContext ctx) =>
        {
            var b = await Body(ctx);
            if (b == null) return;
            bool on = Js.Truthy(b["open"]);
            using var c = Db.Open();
            var acct = GetAccount(c);
            var dev = DeviceOf(ctx, c);
            if (acct == null && !on) { await Error(ctx, 409, "Create the account first: a sign-in needs one"); return; }
            // No account yet: from the home network, as the account itself would be made.
            if (acct == null && !IsLocal(ClientIp(ctx)) && !OpenHere(ctx, c)) { await Error(ctx, 403, "Set up Mandarin from a device on your home network"); return; }
            if (acct != null && dev == null && !OpenHere(ctx, c)) { await Json(ctx, 401, new JsonObject { ["error"] = "Sign in to Mandarin", ["sign_in_required"] = true }); return; }
            SetOpen(c, on);
            Server.Log(on ? $"[auth] sign-in switched off from {ClientIp(ctx)}" : $"[auth] sign-in switched on from {ClientIp(ctx)}");
            if (dev == null && on) { await Joined(ctx, c, b); return; }
            await Json(ctx, 200, new JsonObject { ["ok"] = true, ["open"] = on });
        });
    }

    private static Task Joined(HttpContext ctx, SqliteConnection c, JsonObject b)
    {
        bool wantToken = Js.Truthy(b["want_token"]);
        var (token, device) = Join(ctx, c, b, cookie: !wantToken);
        var o = new JsonObject { ["ok"] = true, ["open"] = true, ["device"] = device };
        if (wantToken) o["token"] = token;
        return Json(ctx, 200, o);
    }
}
