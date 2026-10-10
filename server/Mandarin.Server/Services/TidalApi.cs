// TidalApi.cs — Tidal's API as lib/tidal/api.js asks it (v0.8.39, stage 4.1):
// the catalogue's calls only, read-only. Each call is
//
//   https://api.tidal.com/v1/<call>?<the parameters>&countryCode=…   Bearer <token>
//
// with the signed-in account's access token and country, read at each call.
// The token is the Node server's to refresh (it alone, until stage 4.4 moves
// the sign-in, so the two servers never hold different ones): one about to
// expire, or one Tidal refuses, and the request is the Node server's to
// answer (ToNode), which refreshes it and asks again, as api.js does.
// A failure is said as the Node server says it: Tidal's userMessage, else
// "Tidal answered <status>"; 404 for a 404, 502 for the rest.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

internal sealed class TidalApi(string? baseUrl, string? imagesUrl, Func<object?> token, Func<object?> country)
{
    public const string Base = "https://api.tidal.com/v1/";
    public const string Images = "https://resources.tidal.com/images/";
    private const double Page = 100;

    public string BaseUrl { get; } = baseUrl is { Length: > 0 } b ? b : Base;
    public string ImagesUrl { get; } = imagesUrl is { Length: > 0 } i ? i : Images;
    public readonly AnswerCache Cache = new();

    /* A cover id ("a1b2c3d4-…") as the picture at a size Tidal serves (api.js imageUrl). */
    public string Image(object? id, string size)
    {
        if (!Js.Truthy(id)) return "";
        var s = Js.Str(id);
        if (s.StartsWith("http:", StringComparison.Ordinal) || s.StartsWith("https:", StringComparison.Ordinal)) return s;
        return ImagesUrl + s.Replace('-', '/') + "/" + size + ".jpg";
    }

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

    /* The access token, while it is good for another minute; else the Node server refreshes it (api.js accessToken). */
    private string AccessToken()
    {
        var t = token();
        var access = Js.Truthy(t) ? P(t, "access") : null;
        if (!Js.Truthy(t) || !Js.Truthy(access)) throw new ServiceError("Not signed in to Tidal", 401);
        var expires = P(t, "expires");
        if (Js.Truthy(expires) && NowMs() > Js.ToNumber(expires) - 60000) throw new ToNode("Tidal's token is due to be refreshed");
        return Js.Str(access);
    }

    /* One call (api.js call, GET): [ttl] ms kept, [fresh] asked again now. */
    public async Task<object?> Call(string path, IEnumerable<(string Key, object? Value)> prms, double ttl = 0, bool fresh = false, long? version = null)
    {
        var url = UrlFor(path, prms);
        var key = "GET " + url;
        if (ttl > 0 && !fresh && Cache.TryGet(key, version, out var kept)) return kept;
        var (status, text) = await ServiceHttp.Get(url, [("Authorization", "Bearer " + AccessToken())], 20000);
        // Refused: the Node server refreshes the token and asks again.
        if (status == 401) throw new ToNode("Tidal refused the token");
        var j = ParseOrNull(text);
        if (status is < 200 or > 299)
        {
            object? said = null;
            foreach (var k in new[] { "userMessage", "error_description", "error" })
            {
                said = AndP(j, k);
                if (Js.Truthy(said) || !Js.Truthy(j)) break;
            }
            throw new ServiceError(Js.Truthy(said) ? Js.Str(said) : $"Tidal answered {status}", status == 404 ? 404 : 502);
        }
        if (ttl > 0) Cache.Set(key, ttl, j, version);
        return j;
    }

    /* Every page of a list call, as the plugin pages (api.js getAll): no limit of our own. */
    public async Task<List<object?>> GetAll(string path, double ttl = 0)
    {
        var outList = new List<object?>();
        for (double offset = 0; ; offset += Page)
        {
            var j = Or(await Call(path, [("limit", Page), ("offset", offset)], ttl), new JsObj());
            var items = Items(Or(P(j, "items"), new List<object?>()));
            outList.AddRange(items);
            var total = NumOr(P(j, "totalNumberOfItems"), 0);
            if (items.Count == 0 || outList.Count >= total) break;
        }
        return outList;
    }

    // ------------------------------------------------------------ the catalogue

    private const double Month = 30 * 86400e3, Day = 86400e3, Hour = 3600e3;

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
}
