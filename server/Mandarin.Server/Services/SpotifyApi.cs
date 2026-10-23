// SpotifyApi.cs — Spotify's Web API as the library import asks it (bug list item 143; docs/spotify-plan.md), as
// SpotOn and Music Assistant ask it under the rules of February 2026:
//
//   https://api.spotify.com/v1/<call>      Bearer <the account's access token>
//   https://accounts.spotify.com/authorize, /api/token   the sign-in: OAuth with PKCE (no secret), each person's own
//                                          Client ID (Development Mode), the code sent back to a loopback address
//
// The access token lasts an hour: one due within the minute is refreshed before the call (Spotify sends a new
// refresh token each time, kept at once), and a call refused (401) is made once more with a refreshed one. Too many
// calls (429): waited out and made again, three times at most. Lists are read a page at a time, in turn, never side
// by side (the limits are per Client ID). A failure is said in Spotify's words where it gave some.
using System.Security.Cryptography;
using System.Text;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

internal sealed class SpotifyApi(string? baseUrl, string? accountsUrl, Func<object?> account, Action<JsObj> onToken)
{
    public const string Base = "https://api.spotify.com/v1/";
    public const string Accounts = "https://accounts.spotify.com/";
    /* Where Spotify sends the sign-in back: a loopback address, as Spotify allows without HTTPS (the app catches it there; a browser shows it to be pasted). */
    public const string RedirectUri = "http://127.0.0.1:43143/mandarin-spotify";
    public const string Scopes = "user-library-read user-library-modify user-follow-read playlist-read-private playlist-read-collaborative user-read-private user-read-playback-state user-modify-playback-state";
    private const int Timeout = 20_000;
    private const int MaxPages = 400;   // 20,000 saved albums, 40,000 playlist tracks: more than anyone keeps

    public string BaseUrl { get; } = baseUrl is { Length: > 0 } b ? b.TrimEnd('/') + "/" : Base;
    public string AccountsUrl { get; } = accountsUrl is { Length: > 0 } a ? a.TrimEnd('/') + "/" : Accounts;
    private readonly SemaphoreSlim refreshGate = new(1, 1);

    // ------------------------------------------------------------ signing in (PKCE)

    /* A verifier (64 characters of the unreserved set) and its S256 challenge. */
    public static (string Verifier, string Challenge) Pkce()
    {
        const string Set = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
        var bytes = RandomNumberGenerator.GetBytes(64);
        var verifier = new string(bytes.Select(x => Set[x % Set.Length]).ToArray());
        return (verifier, Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))));
    }

    public static string Base64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /* The page Spotify asks the person to approve Mandarin on. */
    public string AuthorizeUrl(string clientId, string state, string challenge) =>
        AccountsUrl + "authorize?response_type=code&client_id=" + Component(clientId) + "&scope=" + Component(Scopes)
        + "&redirect_uri=" + Component(RedirectUri) + "&state=" + Component(state) + "&code_challenge_method=S256&code_challenge=" + Component(challenge);

    /* The code (from the address Spotify sent back) for the account's tokens: { access, refresh, expires }. */
    public async Task<JsObj> Exchange(string clientId, string code, string verifier) =>
        await TokenCall("grant_type=authorization_code&code=" + Form(code) + "&redirect_uri=" + Form(RedirectUri) + "&client_id=" + Form(clientId) + "&code_verifier=" + Form(verifier), null);

    private async Task<JsObj> TokenCall(string form, object? keepRefresh)
    {
        var (status, text) = await Send("POST", AccountsUrl + "api/token", [], form, "application/x-www-form-urlencoded", Timeout);
        var j = ParseOrNull(text);
        if (status is < 200 or > 299)
        {
            var said = Js.Str(Or(P(j, "error_description"), Or(P(j, "error"), "Spotify answered " + status)));
            throw new ServiceError("Spotify refused the sign-in: " + said, status == 400 ? 401 : 502);
        }
        var t = new JsObj();
        t["access"] = P(j, "access_token");
        t["refresh"] = Or(P(j, "refresh_token"), keepRefresh);
        t["expires"] = NowMs() + NumOr(P(j, "expires_in"), 3600) * 1000;
        return t;
    }

    /* The token refreshed (one refresh at a time), kept at once: Spotify sends a new refresh token each time. */
    private async Task<string> Fresh(bool force)
    {
        await refreshGate.WaitAsync();
        try
        {
            var a = Or(account(), new JsObj());
            var token = P(a, "token");
            if (!Js.Truthy(token)) throw new ServiceError("Sign in to Spotify (Settings → Services → Spotify)", 401);
            if (!force && NowMs() < NumOr(P(token, "expires"), 0) - 60_000) return Js.Str(P(token, "access"));
            var t = await TokenCall("grant_type=refresh_token&refresh_token=" + Form(Js.Str(P(token, "refresh"))) + "&client_id=" + Form(Js.Str(P(a, "clientId"))), P(token, "refresh"));
            onToken(t);
            return Js.Str(t["access"]);
        }
        finally { refreshGate.Release(); }
    }

    // ------------------------------------------------------------ calls

    /* A call ([path] under v1/, or a whole address Spotify gave as "next"): its answer as JSON, null for none. */
    public async Task<object?> Call(string method, string path, string? body = null)
    {
        var url = path.StartsWith("http", StringComparison.Ordinal) ? path : BaseUrl + path;
        var refreshed = false;
        for (int attempt = 0; ; attempt++)
        {
            var access = await Fresh(false);
            (string, string)[] headers = [("Authorization", "Bearer " + access), ("Accept", "application/json")];
            var (status, text) = method == "GET" ? await Get(url, headers, Timeout) : await Send(method, url, headers, body ?? "", "application/json", Timeout);
            if (status == 401 && !refreshed) { refreshed = true; await Fresh(true); continue; }
            if (status == 429 && attempt < 3) { await Task.Delay(2000 * (attempt + 1)); continue; }
            if (status is >= 200 and <= 299) return text.Length > 0 ? ParseOrNull(text) : null;
            var j = ParseOrNull(text);
            var said = Js.Str(Or(P(P(j, "error"), "message"), "Spotify answered " + status));
            throw new ServiceError("Spotify: " + said, status is 401 or 403 or 404 ? status : 502);
        }
    }

    public Task<object?> GetJson(string path) => Call("GET", path);

    /* Every item of a paged list (offset paging, Spotify's "next" followed), in order. */
    public async Task<List<object?>> All(string path)
    {
        var o = new List<object?>();
        string? next = path;
        for (int i = 0; next != null && i < MaxPages; i++)
        {
            var j = await GetJson(next);
            var page = P(j, "items") is List<object?> ? j : P(j, "artists");   // following: { artists: { items, next } }
            o.AddRange(Items(P(page, "items")));
            next = P(page, "next") is string n && n.Length > 0 ? n : null;
        }
        return o;
    }

    /* A list's entry as itself: Development Mode answers may say "item" where they said "track" or "album" (as SpotOn and Music Assistant read them). */
    public static object? Inner(object? x, string kind) => Js.Truthy(P(x, kind)) ? P(x, kind) : Js.Truthy(P(x, "item")) ? P(x, "item") : null;
}
