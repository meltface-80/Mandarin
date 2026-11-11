// LastfmAccount.cs — Last.fm with an account: scrobbling's sign-in and its
// signed calls. Lastfm.cs reads (similar artists and albums) with the API key
// alone; scrobbling also needs the key's shared secret (Settings → API Keys)
// and the owner's leave, asked on Last.fm's own page:
//
//   Connect      auth.getToken, and Last.fm's page to approve it on
//                (https://www.last.fm/api/auth/?api_key=…&token=…), opened by
//                the page or the app;
//   Status       while a token waits, auth.getSession (at most every 2 s): an
//                approved one becomes the session, kept until Disconnect or
//                until Last.fm says it is no longer good (error 9);
//   Call         a signed call: api_sig is the MD5 of the parameters, sorted,
//                each name and value, then the secret (Last.fm's rule;
//                Fingerprint.Md5, as Qobuz's signature).
//
// One account a server, as Mandarin has one owner. The secret and the session
// travel in a backup's keys, sealed (Admin/Backup.cs); Last.fm's address is
// Lastfm.cs' (Jobs.cs: a fake in the tests).
using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;

namespace Mandarin.Server.Extras;

internal static class LastfmAccount
{
    /* Where the owner approves Mandarin: Last.fm's page, never this server's. */
    public const string AuthPage = "https://www.last.fm/api/auth/";
    public const string SecretKey = "lastfmSecret", SessionKey = "lastfmSession", TokenKey = "lastfmToken", RevokedKey = "lastfmRevoked";
    private const long TokenLifeMs = 60 * 60 * 1000, AskEveryMs = 2000;
    private static readonly HttpClient Http = new(new SocketsHttpHandler { AutomaticDecompression = DecompressionMethods.All }) { Timeout = TimeSpan.FromSeconds(15) };
    private static long lastAsked;

    /* The account Mandarin scrobbles as: Last.fm's session key and the user's name. */
    public sealed record Session(string Key, string Name);

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static JsonNode? Get(string key) { using var c = Db.Open(); return Db.Setting(c, key); }
    private static void Put(string key, JsonNode? value) { using var c = Db.Open(); QueueStore.SetSetting(c, key, value); }
    private static string Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";

    /* The shared secret saved in Settings, or "". */
    public static string Secret() => Names.JsTrim(Text(Get(SecretKey)));

    /* The secret saved (empty: none); the session it signed goes with the old one. */
    public static void SetSecret(string secret)
    {
        Put(SecretKey, JsonValue.Create(Names.JsTrim(secret)));
        Disconnect();
    }

    /* The connected account, or null. */
    public static Session? Current() =>
        Get(SessionKey) is JsonObject o && Text(o["key"]) is { Length: > 0 } k ? new Session(k, Text(o["name"])) : null;

    /* Not connected any more, and no sign-in waiting. */
    public static void Disconnect()
    {
        Put(SessionKey, null);
        Put(TokenKey, null);
        Put(RevokedKey, null);
    }

    /* Last.fm said the session is no longer good (error 9): not connected, and the owner told to connect again. */
    public static void Revoked()
    {
        Put(SessionKey, null);
        Put(RevokedKey, JsonValue.Create(true));
    }

    /* api_sig: the MD5 of every parameter but format and callback, sorted by name, each name then value, then the secret. */
    public static string Sign(IEnumerable<KeyValuePair<string, string>> ps, string secret)
    {
        var text = string.Concat(ps.Where(p => p.Key is not ("format" or "callback")).OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + p.Value)) + secret;
        return Convert.ToHexStringLower(Fingerprint.Md5(Encoding.UTF8.GetBytes(text)));
    }

    /* A signed call to [method] with [ps], posted or not; Last.fm's error as a LastfmError (its number the code). */
    public static async Task<JsonNode> Call(string method, IReadOnlyDictionary<string, string> ps, bool post, CancellationToken ct = default)
    {
        var key = Library.LastfmKey();
        var secret = Secret();
        if (key.Length == 0 || secret.Length == 0) throw new LastfmError("Last.fm needs its API key and shared secret", "nokey");
        var all = new Dictionary<string, string>(ps, StringComparer.Ordinal) { ["method"] = method, ["api_key"] = key };
        all["api_sig"] = Sign(all, secret);
        all["format"] = "json";
        var url = Jobs.Lastfm.BaseUrl;
        using var req = post
            ? new HttpRequestMessage(HttpMethod.Post, url) { Content = new FormUrlEncodedContent(all) }
            : new HttpRequestMessage(HttpMethod.Get, url + "?" + string.Join("&", all.Select(p => Uri.EscapeDataString(p.Key) + "=" + Uri.EscapeDataString(p.Value))));
        req.Headers.UserAgent.ParseAdd("Mandarin/" + Server.Version);
        using var res = await Http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        JsonNode? j = null;
        try { j = JsonNode.Parse(body); } catch (JsonException) { /* not JSON: said below */ }
        if (j?["error"] is JsonValue e && e.TryGetValue<int>(out var code)) throw new LastfmError(Text(j["message"]) is { Length: > 0 } m ? m : "Last.fm error " + code, code);
        if (!res.IsSuccessStatusCode || j == null) throw new LastfmError("Last.fm answered " + (int)res.StatusCode, "http");
        return j;
    }

    /* A sign-in begun: Last.fm's token kept, and the page to approve it on. */
    public static async Task<string> Connect(CancellationToken ct = default)
    {
        var token = Text((await Call("auth.getToken", new Dictionary<string, string>(), false, ct))["token"]);
        if (token.Length == 0) throw new LastfmError("Last.fm gave no token", "http");
        Put(TokenKey, new JsonObject { ["token"] = token, ["at"] = Now });
        Put(RevokedKey, null);
        Interlocked.Exchange(ref lastAsked, 0);
        return AuthPage + "?api_key=" + Uri.EscapeDataString(Library.LastfmKey()) + "&token=" + Uri.EscapeDataString(token);
    }

    /*
     * Where scrobbling stands, for Settings: the key and secret there, the account connected (its name), a sign-in
     * waiting on Last.fm's page (asked about now, at most every 2 s), and what went wrong. [queued]: scrobbles waiting.
     */
    public static async Task<JsonObject> Status(long queued, string? lastError, CancellationToken ct = default)
    {
        string? error = null;
        var waiting = Get(TokenKey) is JsonObject t && Text(t["token"]) is { Length: > 0 } tk ? (Token: tk, At: t["at"] is JsonValue a && a.TryGetValue<long>(out var at) ? at : 0) : default;
        if (Current() == null && waiting.Token != null)
        {
            if (Now - waiting.At > TokenLifeMs) { Put(TokenKey, null); waiting = default; error = "The sign-in on Last.fm wasn't finished in time: connect again"; }
            else if (Now - Interlocked.Read(ref lastAsked) >= AskEveryMs)
            {
                Interlocked.Exchange(ref lastAsked, Now);
                try
                {
                    var s = (await Call("auth.getSession", new Dictionary<string, string> { ["token"] = waiting.Token }, false, ct))["session"];
                    if (Text(s?["key"]) is { Length: > 0 } sk)
                    {
                        Put(SessionKey, new JsonObject { ["key"] = sk, ["name"] = Text(s?["name"]) });
                        Put(TokenKey, null);
                        waiting = default;
                    }
                }
                catch (LastfmError e) when (e.Code is 14) { /* not approved yet */ }
                catch (LastfmError e) when (e.Code is 4 or 15) { Put(TokenKey, null); waiting = default; error = "The sign-in on Last.fm expired: connect again"; }
                catch (Exception e) when (e is LastfmError or HttpRequestException or TaskCanceledException) { error = e.Message; }
            }
        }
        var session = Current();
        if (session == null && Get(RevokedKey) is JsonValue r && r.TryGetValue<bool>(out var revoked) && revoked) error ??= "Last.fm no longer accepts Mandarin's sign-in: connect again";
        return new JsonObject
        {
            ["key_set"] = Library.LastfmKey().Length > 0, ["secret_set"] = Secret().Length > 0,
            ["connected"] = session != null, ["name"] = session?.Name, ["pending"] = session == null && waiting.Token != null,
            ["queued"] = queued, ["error"] = error ?? (session != null ? lastError : null),
            ["masked_secret"] = Secret() is { Length: > 0 } sec ? "••••" + (sec.Length > 4 ? sec[^4..] : sec) : "",
        };
    }

    /* Seconds since 1970, as Last.fm counts them. */
    public static string Seconds(long ms) => (ms / 1000).ToString(CultureInfo.InvariantCulture);
}
