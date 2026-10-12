// TidalApi.cs — Tidal's API as lib/tidal/api.js asks it (v0.8.39, stage 4.1):
// the catalogue's calls; from v0.8.44 (stage 4.2) the favourite set and taken
// away too; from v0.8.45 (stage 4.3) the import's lists (the favourite albums
// and tracks, the playlists and their tracks); from v0.8.47 (stage 4.4) the
// sign-in (OAuth's device flow on auth.tidal.com: a link and a code, then
// asked until the person has signed in), the account's user and subscription,
// the token refreshed, and a track's playbackinfo. Each call is
//
//   https://api.tidal.com/v1/<call>?<the parameters>&countryCode=…   Bearer <token>
//
// with the signed-in account's access token and country, read at each call.
// The token is this server's alone to refresh (v0.8.47): one due within the
// minute is refreshed before the call, and a call Tidal refuses is made once
// more with a refreshed one, as api.js does; one refresh at a time, and the
// refresh token kept when Tidal sends no new one. A failure is said as the
// Node server says it: Tidal's userMessage, else "Tidal answered <status>";
// 401 for a token refused even so, 404 for a 404, 502 for the rest.
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

internal sealed partial class TidalApi(string? baseUrl, string? imagesUrl, string? authUrl, Func<object?> token, Action<JsObj> onToken, Func<object?> country)
{
    public const string Base = "https://api.tidal.com/v1/";
    public const string Images = "https://resources.tidal.com/images/";
    public const string Auth = "https://auth.tidal.com";
    private const double Page = 100;
    private const string Scope = "r_usr w_usr";
    private const string GrantDevice = "urn:ietf:params:oauth:grant-type:device_code";
    // The plugin's credentials, as it carries them (lib/tidal/api.js BLOB).
    private const string Blob = "$WyI0TjNu$.$NlExeDk1TEw1SzdwIiwib0tPWGZKVzM3$.$MWNYNnhhWjBQeWhnR05CZE5MbEJaZDRB$.$S0tZb3VnTWppaz0iXQ$";

    public string BaseUrl { get; } = baseUrl is { Length: > 0 } b ? b : Base;
    public string ImagesUrl { get; } = imagesUrl is { Length: > 0 } i ? i : Images;
    public string AuthUrl { get; } = authUrl is { Length: > 0 } a ? a : Auth;
    public readonly AnswerCache Cache = new();
    private readonly (string ClientId, string Secret) creds = Credentials();
    private readonly object refreshGate = new();
    private Task<JsObj>? refreshing;

    /* api.js credentials(): the blob without its marks, read as base64, a JSON pair. */
    public static (string ClientId, string Secret) Credentials()
    {
        var text = Encoding.UTF8.GetString(Convert.FromBase64String(Blob.Replace("$", "").Replace(".", "") + "=="));
        var pair = JsJson.Parse(text) as List<object?>;
        var id = pair is { Count: > 0 } ? pair[0] : null;
        var secret = pair is { Count: > 1 } ? pair[1] : null;
        if (!Js.Truthy(id) || !Js.Truthy(secret)) throw new InvalidOperationException("Tidal credentials unreadable");
        return (Js.Str(id), Js.Str(secret));
    }

    /* A cover id ("a1b2c3d4-…") as the picture at a size Tidal serves (api.js imageUrl). */
    public string Image(object? id, string size)
    {
        if (!Js.Truthy(id)) return "";
        var s = Js.Str(id);
        if (s.StartsWith("http:", StringComparison.Ordinal) || s.StartsWith("https:", StringComparison.Ordinal)) return s;
        return ImagesUrl + s.Replace('-', '/') + "/" + size + ".jpg";
    }

    // ------------------------------------------------------------ signing in (v0.8.47)

    /*
     * api.js authPost: the form, the client id first, with the client's own
     * Basic sign; Tidal's status and its answer (JSON, else {}). fetch's
     * failures go on in its words.
     */
    private async Task<(int Status, object? Json)> AuthPost(string path, params (string Key, string Value)[] prms)
    {
        var body = string.Join("&", new[] { ("client_id", creds.ClientId) }.Concat(prms).Select(x => Form(x.Item1) + "=" + Form(x.Item2)));
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes(creds.ClientId + ":" + creds.Secret));
        var (status, text) = await ServiceHttp.Send("POST", AuthUrl + path, [("Authorization", "Basic " + basic)], body, "application/x-www-form-urlencoded", 15000);
        return (status, Or(ParseOrNull(text), new JsObj()));
    }

    [GeneratedRegex("^https?:")]
    private static partial Regex Http();

    /* The link and the code for the person to sign in with, on tidal.com (api.js deviceAuthorization). */
    public async Task<(object? DeviceCode, object? UserCode, string Url, double ExpiresIn, double Interval)> DeviceAuthorization()
    {
        var (status, j) = await AuthPost("/v1/oauth2/device_authorization", ("scope", Scope));
        if (status >= 400 || !Js.Truthy(P(j, "deviceCode")))
            throw new ServiceError(Js.Str(Or(Or(P(j, "error_description"), P(j, "error")), $"Tidal answered {status}")), 502);
        var uri = Js.Str(Or(Or(P(j, "verificationUriComplete"), P(j, "verificationUri")), "link.tidal.com"));
        return (P(j, "deviceCode"), Or(P(j, "userCode"), ""), Http().IsMatch(uri) ? uri : "https://" + uri, NumOr(P(j, "expiresIn"), 300), NumOr(P(j, "interval"), 2));
    }

    /*
     * One ask whether the sign-in is done (api.js pollDevice): null while it
     * isn't, the tokens and the user once it is; the code expired, or anything
     * else Tidal says, thrown in its words.
     */
    public async Task<JsObj?> PollDevice(object? deviceCode)
    {
        var (status, j) = await AuthPost("/v1/oauth2/token", ("scope", Scope), ("grant_type", GrantDevice), ("device_code", Js.Str(deviceCode)));
        if (Js.Truthy(P(j, "access_token"))) return TokensOf(j);
        var error = P(j, "error");
        if (error is "authorization_pending" or "slow_down") return null;
        var expired = error is "expired_token";
        throw new ServiceError(expired ? "The sign-in link expired — ask for a new one" : Js.Str(Or(Or(P(j, "error_description"), error), $"Tidal answered {status}")), expired ? 410 : 401);
    }

    /* api.js tokensOf: the tokens Tidal gave, when the access one expires, and the user. */
    private static JsObj TokensOf(object? j)
    {
        var o = new JsObj();
        o["access"] = P(j, "access_token");
        o["refresh"] = Or(P(j, "refresh_token"), null);
        o["expires"] = NowMs() + NumOr(P(j, "expires_in"), 3600) * 1000;
        o["userId"] = Or(Or(P(j, "user_id"), AndP(P(j, "user"), "userId")), null);
        o["user"] = Or(P(j, "user"), null);
        return o;
    }

    /*
     * A new access token from the refresh token, kept (onToken), as api.js
     * refresh: one at a time, a second asker given the first's; the refresh
     * token kept when Tidal sends none. Refused, in Tidal's words.
     */
    public Task<JsObj> Refresh()
    {
        lock (refreshGate)
        {
            if (refreshing != null) return refreshing;
            var run = Task.Run(async () =>
            {
                var t = token();
                if (!Js.Truthy(t) || !Js.Truthy(P(t, "refresh"))) throw new ServiceError("Not signed in to Tidal", 401);
                var (status, j) = await AuthPost("/v1/oauth2/token", ("scope", Scope), ("grant_type", "refresh_token"), ("refresh_token", Js.Str(P(t, "refresh"))));
                if (!Js.Truthy(P(j, "access_token")))
                    throw new ServiceError(Js.Str(Or(Or(P(j, "error_description"), P(j, "error")), $"Tidal refused a new token ({status})")), 401);
                var next = TokensOf(j);
                if (!Js.Truthy(next["refresh"])) next["refresh"] = P(t, "refresh");
                onToken(next);
                return next;
            });
            refreshing = run.ContinueWith(x => { lock (refreshGate) refreshing = null; return x; }, TaskScheduler.Default).Unwrap();
            return refreshing;
        }
    }

    /* The access token: refreshed first when it expires within the minute (api.js accessToken). */
    private async Task<string> AccessToken()
    {
        var t = token();
        var access = Js.Truthy(t) ? P(t, "access") : null;
        if (!Js.Truthy(t) || !Js.Truthy(access)) throw new ServiceError("Not signed in to Tidal", 401);
        var expires = P(t, "expires");
        if (Js.Truthy(expires) && NowMs() > Js.ToNumber(expires) - 60000) return Js.Str((await Refresh())["access"]);
        return Js.Str(access);
    }

    // ------------------------------------------------------------ requests

    /* api.js urlFor: the parameters as URLSearchParams has them, the account's country last unless given. */
    public string UrlFor(string path, IEnumerable<(string Key, object? Value)> prms)
    {
        var q = new List<(string K, string V)>();
        foreach (var (k, v) in prms)
        {
            if (Js.IsNullish(v)) continue;
            var at = q.FindIndex(x => x.K == k);
            if (at >= 0) q[at] = (k, Js.Str(v)); else q.Add((k, Js.Str(v)));
        }
        if (!q.Any(x => x.K == "countryCode")) { var cc = country(); q.Add(("countryCode", Js.Truthy(cc) ? Js.Str(cc) : "US")); }
        return BaseUrl + path + "?" + string.Join("&", q.Select(x => Form(x.K) + "=" + Form(x.V)));
    }

    /* Answers known already (the albums a list gave), kept as if each call had been made (api.js prime): the country read once for the list. */
    public void Prime(IEnumerable<(string Path, object? Value)> answers, double ttl)
    {
        var cc = country();
        foreach (var (path, value) in answers) Cache.Set("GET " + UrlFor(path, [("countryCode", Js.Truthy(cc) ? cc : "US")]), ttl, value);
    }

    /* One call (api.js call, GET): [ttl] ms kept, [fresh] asked again now; refused, asked once more with a refreshed token. */
    public async Task<object?> Call(string path, IEnumerable<(string Key, object? Value)> prms, double ttl = 0, bool fresh = false, long? version = null)
    {
        var url = UrlFor(path, prms);
        var key = "GET " + url;
        if (ttl > 0 && !fresh && Cache.TryGet(key, version, out var kept)) return kept;
        var (status, text) = await ServiceHttp.Get(url, [("Authorization", "Bearer " + await AccessToken())], 20000);
        if (status == 401) (status, text) = await ServiceHttp.Get(url, [("Authorization", "Bearer " + Js.Str((await Refresh())["access"]))], 20000);
        var j = Answered(status, text);
        if (ttl > 0) Cache.Set(key, ttl, j, version);
        return j;
    }

    /* Tidal's answer as api.js call reads it: a failure in Tidal's words, 401 for a token refused even so, 404 for a 404, 502 for the rest. */
    private static object? Answered(int status, string text)
    {
        var j = ParseOrNull(text);
        if (status is < 200 or > 299)
        {
            var said = Js.Truthy(j) ? Or(Or(P(j, "userMessage"), P(j, "error_description")), P(j, "error")) : j;
            throw new ServiceError(Js.Truthy(said) ? Js.Str(said) : $"Tidal answered {status}", status == 401 ? 401 : status == 404 ? 404 : 502);
        }
        return j;
    }

    /*
     * A write (api.js call with a method and a form body, v0.8.44): never
     * kept. Refused, made once more with a refreshed token, as api.js does:
     * Tidal made nothing of the one it refused.
     */
    private async Task<object?> Write(string method, string path, (string Key, string Value)[]? form)
    {
        var url = UrlFor(path, []);
        var body = form == null ? null : string.Join("&", form.Select(x => Form(x.Key) + "=" + Form(x.Value)));
        var (status, text) = await ServiceHttp.Send(method, url, [("Authorization", "Bearer " + await AccessToken())], body, "application/x-www-form-urlencoded", 20000);
        if (status == 401) (status, text) = await ServiceHttp.Send(method, url, [("Authorization", "Bearer " + Js.Str((await Refresh())["access"]))], body, "application/x-www-form-urlencoded", 20000);
        return Answered(status, text);
    }

    /* Every page of a list call, as the plugin pages (api.js getAll): no limit of our own; [prms] before the page's own. */
    public async Task<List<object?>> GetAll(string path, double ttl = 0, (string Key, object? Value)[]? prms = null, double limit = Page)
    {
        var outList = new List<object?>();
        for (double offset = 0; ; offset += limit)
        {
            var j = Or(await Call(path, (prms ?? []).Concat([("limit", (object?)limit), ("offset", offset)]), ttl), new JsObj());
            var items = Items(Or(P(j, "items"), new List<object?>()));
            outList.AddRange(items);
            var total = NumOr(P(j, "totalNumberOfItems"), 0);
            if (items.Count == 0 || outList.Count >= total) break;
        }
        return outList;
    }

    // ------------------------------------------------------------ the account (v0.8.47)

    private const double Month = 30 * 86400e3, Day = 86400e3, Hour = 3600e3;

    public Task<object?> User(object? userId) => Call($"users/{Js.Str(userId)}", [], Hour);
    public Task<object?> Subscription(object? userId) => Call($"users/{Js.Str(userId)}/subscription", [], Hour);

    // ------------------------------------------------------------ the catalogue

    public Task<object?> Album(string id) => Call($"albums/{id}", [], Month);
    public Task<List<object?>> AlbumTracks(string id) => GetAll($"albums/{id}/tracks", Month);
    public Task<object?> Search(string query, double limit, double offset) => Call("search", [("query", query), ("types", "ALBUMS,ARTISTS"), ("limit", limit), ("offset", offset)], Hour);
    public Task<object?> Artist(string id) => Call($"artists/{id}", [], Day);
    public Task<object?> ArtistAlbums(string id, double limit, double offset) => Call($"artists/{id}/albums", [("filter", "ALBUMS"), ("limit", limit), ("offset", offset)], Hour);
    /* The lists Tidal features (New, Recommended, Top, Rising…) and one list's albums. */
    public Task<object?> Featured() => Call("featured", [], Hour);
    public Task<object?> FeaturedAlbums(object? path, double limit = 100) => Call($"featured/{Js.Str(path)}/albums", [("limit", limit)], Hour);
    public Task<object?> NewReleases(double limit = 100) => FeaturedAlbums("new", limit);
    public Task<object?> FavouriteIds(object? userId, bool fresh, long? version) => Call($"users/{Js.Str(userId)}/favorites/ids", [], 60e3, fresh, version);

    // ------------------------------------------------------------ the library's rows (v0.8.44)

    /* The favourite on Tidal itself (api.js setFavourite): every answer kept forgotten first. */
    public Task<object?> SetFavourite(object? userId, string albumId, bool on)
    {
        Cache.Clear();
        if (on) return Write("POST", $"users/{Js.Str(userId)}/favorites/albums", [("albumIds", albumId), ("onArtifactNotFound", "SKIP")]);
        return Write("DELETE", $"users/{Js.Str(userId)}/favorites/albums/{albumId}", null);
    }

    // ------------------------------------------------------------ the import (v0.8.45)

    /* Every page of each, asked afresh each time, as api.js asks them. */
    public Task<List<object?>> FavouriteAlbums(object? userId) => GetAll($"users/{Js.Str(userId)}/favorites/albums", 0, [("order", "DATE"), ("orderDirection", "DESC")]);
    public Task<List<object?>> FavouriteTracks(object? userId) => GetAll($"users/{Js.Str(userId)}/favorites/tracks", 0, [("order", "DATE"), ("orderDirection", "DESC")]);
    public Task<List<object?>> Playlists(object? userId) => GetAll($"users/{Js.Str(userId)}/playlistsAndFavoritePlaylists", 0, null, 50);
    public Task<List<object?>> PlaylistItems(object? uuid) => GetAll($"playlists/{Js.Str(uuid)}/items");

    // ------------------------------------------------------------ the stream (v0.8.47)

    /*
     * tracks/<id>/playbackinfopostpaywall: where the audio is, for a few
     * minutes, and what it is, as a manifest (one address, or MPEG-DASH);
     * never kept (api.js playbackInfo). Read by ServiceStreams.cs.
     */
    public Task<object?> PlaybackInfo(string trackId, string quality) =>
        Call($"tracks/{trackId}/playbackinfopostpaywall", [("audioquality", quality), ("playbackmode", "STREAM"), ("assetpresentation", "FULL")]);
}
