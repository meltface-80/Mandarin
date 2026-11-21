// SpotifyApi.cs — Spotify's Web API as Mandarin asks it (bug list item 497), under Spotify's rules of February 2026
// for an app in Development Mode:
//
//   https://api.spotify.com/v1/<call>                      Bearer <the account's access token>
//   https://accounts.spotify.com/authorize, /api/token     the sign-in: OAuth with PKCE (no secret), Mandarin's own
//                                                           app (its Client ID is public: it names the app, nothing
//                                                           more), the code sent back to a loopback address
//
// The access token lasts an hour: one due within the minute is refreshed before the call, and a call refused (401) is
// made once more with a refreshed one. Spotify sends a new refresh token each time and the old one stops working, so
// one refresh runs at a time and its token is kept at once; a call waiting on it takes the new one. Too many calls
// (429): waited out as long as Spotify's Retry-After says, a minute at most, and made again, three times at most
// (item 499); a longer wait is kept, and every call until then is answered at once that Spotify is busy, without asking
// it, so a run of calls (an import) stops rather than asking again and again. Lists are read a page at a time, following Spotify's "next",
// and only ever on Spotify's own address: the token goes nowhere else. A failure is said in Spotify's words.
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
    /* Mandarin's app on Spotify for Developers (the owner's, Development Mode). */
    public const string ClientId = "5938a1a6cf2c4b5ebf7756be64378e1f";
    /* Where Spotify sends the sign-in back: a loopback address, which Spotify allows without HTTPS. The Android app
     * catches it there; a browser elsewhere can't open it, and the address it shows is pasted on the page instead. */
    public const string RedirectUri = "http://127.0.0.1:43143/mandarin-spotify";
    public const string Scopes = "user-library-read user-library-modify user-follow-read";
    private const int Timeout = 20_000;
    private const int MaxPages = 1000;

    public string BaseUrl { get; } = baseUrl is { Length: > 0 } b ? b.TrimEnd('/') + "/" : Base;
    public string AccountsUrl { get; } = accountsUrl is { Length: > 0 } a ? a.TrimEnd('/') + "/" : Accounts;
    public readonly AnswerCache Cache = new();
    private readonly SemaphoreSlim refreshGate = new(1, 1);
    /* How long a 429 without a Retry-After is waited out, each time (the tests make it short); the most waited at once. */
    public int BusyWaitMs { get; init; } = 5000;
    public double MostWaitS { get; init; } = 60;
    private double busyUntil;

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
    public string AuthorizeUrl(string state, string challenge) =>
        AccountsUrl + "authorize?response_type=code&client_id=" + Component(ClientId) + "&scope=" + Component(Scopes)
        + "&redirect_uri=" + Component(RedirectUri) + "&state=" + Component(state) + "&code_challenge_method=S256&code_challenge=" + Component(challenge);

    /* The code (from the address Spotify sent back) for the account's tokens: { access, refresh, expires }. */
    public Task<JsObj> Exchange(string code, string verifier) =>
        TokenCall("grant_type=authorization_code&code=" + Form(code) + "&redirect_uri=" + Form(RedirectUri) + "&client_id=" + Form(ClientId)
            + "&code_verifier=" + Form(verifier), null);

    private async Task<JsObj> TokenCall(string form, object? keepRefresh)
    {
        var (status, text) = await Send("POST", AccountsUrl + "api/token", [], form, "application/x-www-form-urlencoded", Timeout);
        var j = ParseOrNull(text);
        if (status is < 200 or > 299 || !Js.Truthy(P(j, "access_token")))
        {
            var said = Js.Str(Or(P(j, "error_description"), Or(P(j, "error"), "Spotify answered " + status)));
            throw new ServiceError("Spotify refused the sign-in: " + said, status is 400 or 401 ? 401 : 502);
        }
        var t = new JsObj();
        t["access"] = P(j, "access_token");
        t["refresh"] = Or(P(j, "refresh_token"), keepRefresh);
        t["expires"] = NowMs() + NumOr(P(j, "expires_in"), 3600) * 1000;
        return t;
    }

    /*
     * The access token: the one kept while it has a minute left; else refreshed, one refresh at a time. [refused]: the
     * token Spotify just turned down; one kept that differs is newer (another call refreshed it), and is taken as is.
     */
    private async Task<string> Access(string? refused)
    {
        await refreshGate.WaitAsync();
        try
        {
            var token = P(account(), "token");
            if (!Js.Truthy(token) || !Js.Truthy(P(token, "refresh"))) throw new ServiceError("Not signed in to Spotify", 401);
            var access = Js.Str(P(token, "access"));
            var newer = refused != null && access.Length > 0 && access != refused;
            if (newer || (refused == null && access.Length > 0 && NowMs() < NumOr(P(token, "expires"), 0) - 60_000)) return access;
            var t = await TokenCall("grant_type=refresh_token&refresh_token=" + Form(Js.Str(P(token, "refresh"))) + "&client_id=" + Form(ClientId), P(token, "refresh"));
            onToken(t);
            return Js.Str(t["access"]);
        }
        finally { refreshGate.Release(); }
    }

    // ------------------------------------------------------------ calls

    /* Spotify's own address for [path] (under v1/), or a whole address Spotify gave as "next" when it is Spotify's. */
    private string UrlOf(string path)
    {
        if (!path.StartsWith("http", StringComparison.Ordinal)) return BaseUrl + path;
        if (path.StartsWith(BaseUrl, StringComparison.Ordinal)) return path;
        throw new ServiceError("Spotify gave a next page elsewhere", 502);
    }

    /* A call: its answer as JSON (null for none); a GET kept [ttl] ms when asked to. */
    public async Task<object?> Call(string method, string path, string? body = null, double ttl = 0)
    {
        var url = UrlOf(path);
        var key = "GET " + url;
        if (method == "GET" && ttl > 0 && Cache.TryGet(key, null, out var kept)) return kept;
        string? refused = null;
        for (int attempt = 0; ; attempt++)
        {
            if (Busy() is { } waiting) throw new ServiceError(waiting, 503);
            var access = await Access(refused);
            (string, string)[] headers = [("Authorization", "Bearer " + access), ("Accept", "application/json")];
            var (status, text, retryAfter) = await SendTimed(method, url, headers, method == "GET" ? null : body ?? "", "application/json", Timeout);
            if (status == 401 && refused == null) { refused = access; continue; }
            if (status == 429)
            {
                var wait = retryAfter ?? BusyWaitMs * (attempt + 1) / 1000.0;
                if (wait > MostWaitS) { busyUntil = NowMs() + wait * 1000; Server.Log($"[spotify] Spotify asks Mandarin to wait {Math.Ceiling(wait / 60)} min"); }
                else if (attempt < 3) { await Task.Delay(TimeSpan.FromSeconds(wait)); continue; }
                throw new ServiceError(Busy() ?? "Spotify is busy: try again in a minute", 503);
            }
            if (status is >= 200 and <= 299)
            {
                var j = text.Length > 0 ? ParseOrNull(text) : null;
                if (method == "GET" && ttl > 0) Cache.Set(key, ttl, j, null);
                return j;
            }
            var said = Js.Str(Or(P(P(ParseOrNull(text), "error"), "message"), "Spotify answered " + status));
            throw new ServiceError(status == 429 ? "Spotify is busy: try again in a minute" : "Spotify: " + said, status is 401 or 403 or 404 ? status : 502);
        }
    }

    public Task<object?> GetJson(string path, double ttl = 0) => Call("GET", path, null, ttl);

    /* While Spotify has asked Mandarin to wait: what is said; null when it may be asked. */
    public string? Busy() => NowMs() < busyUntil ? $"Spotify asked Mandarin to wait: it is asked again in {Math.Ceiling((busyUntil - NowMs()) / 60_000)} min" : null;

    /* Every item of a paged list, in order, Spotify's "next" followed. [inner]: the key the page sits under ("artists" for those followed). */
    public async Task<List<object?>> All(string path, string? inner = null)
    {
        var o = new List<object?>();
        string? next = path;
        for (int i = 0; next != null && i < MaxPages; i++)
        {
            var j = await GetJson(next);
            var page = inner != null ? P(j, inner) : j;
            o.AddRange(Items(P(page, "items")));
            next = P(page, "next") is string n && n.Length > 0 ? n : null;
        }
        return o;
    }

    /* A list's entry as itself: Development Mode answers may say "item" where they said "album" or "track". */
    public static object? Inner(object? x, string kind) => Js.Truthy(P(x, kind)) ? P(x, kind) : Js.Truthy(P(x, "item")) ? P(x, "item") : null;

    // ------------------------------------------------------------ what Mandarin asks

    private const double Month = 30 * 86400e3;

    /* The signed-in account: { id, display_name }. */
    public Task<object?> Me() => GetJson("me");
    /* The saved albums, each { added_at, album }, newest first. */
    public Task<List<object?>> SavedAlbums() => All("me/albums");
    /* An album with its first page of tracks; the rest by AlbumTracks. */
    public Task<object?> Album(string id) => GetJson("albums/" + Uri.EscapeDataString(id), Month);
    /* Every track of an album, the first page as the album gave it, the rest asked for. */
    public async Task<List<object?>> AlbumTracks(object? album)
    {
        var page = P(album, "tracks");
        var o = Items(P(page, "items")).ToList();
        if (P(page, "next") is string n && n.Length > 0) o.AddRange(await All(n));
        return o;
    }
}
