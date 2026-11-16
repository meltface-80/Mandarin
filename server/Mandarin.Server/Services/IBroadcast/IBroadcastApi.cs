// IBroadcastApi.cs — iBroadcast's servers as Mandarin asks them (item 443; help.ibroadcast.com/developer, and the
// requests of iBroadcast's own Python client):
//   - OAuth 2.0 on oauth.ibroadcast.com, by its device flow: a code shown here, approved by the person on iBroadcast,
//     asked after at the interval iBroadcast gives (slower when it says slow_down). No address of Mandarin's to
//     register, so a server at home signs in as a TV app does. The access token is refreshed there before it expires,
//     and once more when an answer says "authenticated": false; the refresh token kept when none comes back.
//   - the JSON API on api.ibroadcast.com: POST /<mode>, the mode, the client, its version, the device's name and the
//     user agent in the body, Bearer <access token>. Not REST: "result": false is a failure, in iBroadcast's words.
// IBROADCAST_URL (the tests' stand-in) puts every server under one address: <url>/oauth, /api, /library, /upload.
using System.Globalization;
using System.Text.Json.Nodes;

namespace Mandarin.Server.Services.IBroadcast;

internal sealed class IBroadcastApi
{
    /// <summary>Mandarin's app at iBroadcast (made on media.ibroadcast.com → Apps → Developers); not a secret.</summary>
    public const string ClientId = "15389a47e1c211f1b50eb49691aa2236";
    /// <summary>What Mandarin asks to be let do: read the account and the library, change the library, upload.</summary>
    public const string Scopes = "user.account:read user.library:read user.library:write user.upload";

    /// <summary>Where each of iBroadcast's servers is.</summary>
    public string OAuth { get; }
    public string Api { get; }
    public string Library { get; }
    public string Upload { get; }

    private readonly Func<JsonObject?> token;
    private readonly Action<JsonObject> keep;
    private readonly SemaphoreSlim refreshing = new(1, 1);

    /// <summary>iBroadcast's servers, or [testBase]'s; [token] the tokens kept, [keep] keeps refreshed ones.</summary>
    public IBroadcastApi(string? testBase, Func<JsonObject?> token, Action<JsonObject> keep)
    {
        var b = testBase is { Length: > 0 } t ? t.TrimEnd('/') : null;
        OAuth = b != null ? b + "/oauth" : "https://oauth.ibroadcast.com";
        Api = b != null ? b + "/api" : "https://api.ibroadcast.com";
        Library = b != null ? b + "/library" : "https://library.ibroadcast.com";
        Upload = b != null ? b + "/upload" : "https://upload.ibroadcast.com";
        this.token = token;
        this.keep = keep;
    }

    /// <summary>Mandarin as iBroadcast is told it: "mandarin/1.3.3".</summary>
    public static string Agent => "mandarin/" + Server.Version;

    /// <summary>A device code: the one asked after, the one the person types, where, how long it lasts and how often to ask.</summary>
    public sealed record DeviceCode(string Code, string UserCode, string Url, double ExpiresIn, double Interval);

    /// <summary>A code to sign in with, from iBroadcast.</summary>
    public async Task<DeviceCode> BeginDevice()
    {
        var (status, text) = await Call(() => ServiceHttp.Get($"{OAuth}/device/code?client_id={ClientId}&scope={Uri.EscapeDataString(Scopes)}", [("User-Agent", Agent)], 15000));
        var j = Parse(text);
        if (status >= 400 || Str(j?["device_code"]) is not { } code) throw new ServiceError(Said(j, $"iBroadcast answered {status}"), 502);
        var url = Str(j?["verification_uri_complete"]) ?? Str(j?["verification_uri"]) ?? "https://media.ibroadcast.com";
        return new(code, Str(j?["user_code"]) ?? "", url, Num(j?["expires_in"], 600), Math.Max(1, Num(j?["interval"], 5)));
    }

    /// <summary>One ask whether [deviceCode] is approved: its tokens once it is; null while not (Slower: iBroadcast asks to be asked less often).</summary>
    public async Task<(JsonObject? Token, bool Slower)> PollDevice(string deviceCode)
    {
        var (status, text) = await Form("/token", ("grant_type", "device_code"), ("client_id", ClientId), ("device_code", deviceCode));
        var j = Parse(text);
        if (status < 400 && Str(j?["access_token"]) != null) return (TokenOf(j!, null), false);
        switch (Str(j?["error"]))
        {
            case "authorization_pending": return (null, false);
            case "slow_down": return (null, true);
            case "expired_token": throw new ServiceError("The code expired: sign in again for a new one", 410);
            case "access_denied": throw new ServiceError("The sign-in was turned down on iBroadcast", 401);
            default: throw new ServiceError(Said(j, $"iBroadcast answered {status}"), 401);
        }
    }

    /// <summary>A new access token from the refresh token, kept; one refresh at a time.</summary>
    public async Task<JsonObject> Refresh(string? refused = null)
    {
        await refreshing.WaitAsync();
        try
        {
            var t = token() ?? throw new ServiceError("Not signed in to iBroadcast", 401);
            // Refreshed meanwhile by another call: that one.
            if (refused != null && Str(t["access"]) is { } now && now != refused) return t;
            var refresh = Str(t["refresh"]) ?? throw new ServiceError("Not signed in to iBroadcast", 401);
            var (status, text) = await Form("/token", ("grant_type", "refresh_token"), ("refresh_token", refresh), ("client_id", ClientId));
            var j = Parse(text);
            if (Str(j?["access_token"]) == null) throw new ServiceError(Said(j, $"iBroadcast refused a new sign-in token ({status}): sign in again"), 401);
            var next = TokenOf(j!, refresh);
            keep(next);
            return next;
        }
        finally { refreshing.Release(); }
    }

    /// <summary>The sign-in let go at iBroadcast too ([refresh]: its refresh token); whatever it answers.</summary>
    public async Task Revoke(string refresh)
    {
        try { await Form("/revoke", ("refresh_token", refresh), ("client_id", ClientId)); }
        catch (ServiceError) { /* gone here all the same */ }
    }

    /// <summary>The JSON API's [mode], with [extra] in the body; [url] another server's address (the library's).</summary>
    public async Task<JsonObject> Json(string mode, JsonObject? extra = null, string? url = null)
    {
        var body = new JsonObject { ["client"] = "mandarin", ["version"] = Server.Version, ["device_name"] = "Mandarin", ["user_agent"] = Agent, ["mode"] = mode };
        foreach (var (k, v) in extra ?? []) body[k] = v?.DeepClone();
        var access = await Access();
        for (var again = false; ; again = true)
        {
            var (status, text) = await Call(() => ServiceHttp.Send("POST", url ?? Api + "/" + mode, Headers(access), body.ToJsonString(), "application/json", 60000));
            var j = Parse(text) as JsonObject;
            var refused = status == 401 || (j?["authenticated"] is JsonValue a && a.TryGetValue<bool>(out var ok) && !ok);
            if (refused && !again) { access = Str((await Refresh(access))["access"])!; continue; }
            if (refused) throw new ServiceError("iBroadcast turned the sign-in down: sign in again", 401);
            if (status >= 400 || j == null) throw new ServiceError(Said(j, $"iBroadcast answered {status}"), 502);
            if (j["result"] is JsonValue r && r.TryGetValue<bool>(out var done) && !done) throw new ServiceError(Said(j, "iBroadcast refused it"), 502);
            return j;
        }
    }

    /// <summary>The access token, refreshed first where it expires within the minute.</summary>
    public async Task<string> Access()
    {
        var t = token();
        if (Str(t?["access"]) is not { } access) throw new ServiceError("Not signed in to iBroadcast", 401);
        if (t!["expires"] is JsonValue e && e.TryGetValue<double>(out var at) && Now() > at - 60_000) return Str((await Refresh(access))["access"])!;
        return access;
    }

    private static (string, string)[] Headers(string access) => [("User-Agent", Agent), ("Authorization", "Bearer " + access)];

    private Task<(int Status, string Text)> Form(string path, params (string Key, string Value)[] form) =>
        Call(() => ServiceHttp.Send("POST", OAuth + path, [("User-Agent", Agent)], string.Join("&", form.Select(f => Uri.EscapeDataString(f.Key) + "=" + Uri.EscapeDataString(f.Value))),
            "application/x-www-form-urlencoded", 15000));

    /* A request; not answering, said so. */
    private static async Task<(int Status, string Text)> Call(Func<Task<(int, string)>> send)
    {
        try { return await send(); }
        catch (Tags.JsError e) { throw new ServiceError("iBroadcast couldn't be reached (" + e.Message + ")", 502); }
    }

    private static JsonObject TokenOf(JsonNode j, string? oldRefresh) => new()
    {
        ["access"] = Str(j["access_token"]),
        ["refresh"] = Str(j["refresh_token"]) ?? oldRefresh,
        ["expires"] = Now() + Num(j["expires_in"], 3600) * 1000,
        ["scope"] = j["scope"] is JsonArray s ? string.Join(' ', s.Select(x => x?.ToString())) : Str(j["scope"]),
    };

    private static JsonNode? Parse(string text)
    {
        try { return text.Length > 0 ? JsonNode.Parse(text) : null; } catch (System.Text.Json.JsonException) { return null; }
    }

    /// <summary>A JSON value as text, null where there is none.</summary>
    public static string? Str(JsonNode? n) => n is JsonValue v ? (v.TryGetValue<string>(out var s) ? (s.Length > 0 ? s : null) : v.ToJsonString().Trim('"')) : null;

    private static double Num(JsonNode? n, double or) => n is JsonValue v && (v.TryGetValue<double>(out var d) || (v.TryGetValue<string>(out var s) && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out d))) ? d : or;

    private static string Said(JsonNode? j, string or) => Str(j?["message"]) ?? Str(j?["error_description"]) ?? Str(j?["error"]) ?? or;

    /// <summary>Now, in milliseconds since 1970.</summary>
    public static double Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}
