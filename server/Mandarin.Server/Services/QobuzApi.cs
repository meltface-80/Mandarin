// QobuzApi.cs — Qobuz's API as lib/qobuz/api.js asks it (v0.8.39, stage 4.1):
// the catalogue's calls only, read-only. Each call is
//
//   https://www.qobuz.com/api.json/0.2/<call>?<the parameters, sorted>&app_id=…
//
// with the headers X-App-Id and X-User-Auth-Token (the signed-in account's,
// read at each call, so a sign-out takes at once), answered as JSON. The app id
// is the one the Lyrion plugin ships, decoded as api.js decodes it. A failure
// is said as the Node server says it: Qobuz's own message, else "Qobuz
// answered <status>"; 401 for a token it refuses, 502 for the rest.
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

internal sealed partial class QobuzApi(string? baseUrl, Func<string?> token)
{
    public const string Base = "https://www.qobuz.com/api.json/0.2/";
    // The plugin's credentials, as it carries them (lib/qobuz/api.js BLOB).
    private const string Blob = "3934323835323536373736313733306433663935653461663039616336336239613337636363393661393530303936393633";

    public string BaseUrl { get; } = baseUrl is { Length: > 0 } b ? b : Base;
    public readonly AnswerCache Cache = new();
    private readonly string appId = Credentials().AppId;

    [GeneratedRegex(@"^(\d{9})([a-f0-9]{32})(\d{9})", RegexOptions.IgnoreCase)]
    private static partial Regex CredentialsShape();

    public static (string AppId, string Secret) Credentials()
    {
        var s = Encoding.ASCII.GetString(Convert.FromHexString(Blob));
        var m = CredentialsShape().Match(s);
        if (!m.Success) throw new InvalidOperationException("Qobuz credentials unreadable");
        return (m.Groups[1].Value, m.Groups[2].Value);
    }

    /*
     * One call (api.js get): [ttl] ms kept, [fresh] asked again now. The
     * parameters go in as given, those null or undefined left out, then
     * app_id, the whole sorted as JavaScript sorts strings.
     */
    public async Task<object?> Get(string call, IEnumerable<(string Key, object? Value)> prms, double ttl = 0, bool fresh = false, long? version = null)
    {
        var q = new List<string>();
        foreach (var (k, v) in prms) if (!Js.IsNullish(v)) q.Add(k + "=" + Component(Js.Str(v)));
        var tok = token();
        if (string.IsNullOrEmpty(tok)) throw new ServiceError("Not signed in to Qobuz", 401);
        q.Add("app_id=" + appId);
        q.Sort(string.CompareOrdinal);
        var url = BaseUrl + call + "?" + string.Join("&", q);
        var key = url + "|" + tok;
        if (ttl > 0 && !fresh && Cache.TryGet(key, version, out var kept)) return kept;
        var (status, text) = await ServiceHttp.Get(url, [("X-App-Id", appId), ("X-User-Auth-Token", tok)], 15000);
        var j = ParseOrNull(text);
        if (status is < 200 or > 299)
        {
            var said = Or(AndP(j, "message") is var m && Js.Truthy(m) ? m : AndP(j, "error"), null);
            throw new ServiceError(Js.Truthy(said) ? Js.Str(said) : $"Qobuz answered {status}", status == 401 ? 401 : 502);
        }
        if (ttl > 0) Cache.Set(key, ttl, j, version);
        return j;
    }

    /* Every page of a list call, as the plugin's _pagingGet (api.js getAll): no limit of our own. */
    public async Task<List<object?>> GetAll(string call, (string Key, object? Value)[] prms, Func<object?, object?> pick, double ttl = 0, double limit = 500)
    {
        var outList = new List<object?>();
        for (double offset = 0; ; offset += limit)
        {
            var j = await Get(call, prms.Concat([("limit", (object?)limit), ("offset", offset)]), ttl);
            var list = Or(pick(j), new JsObj());
            var items = Items(Or(P(list, "items"), new List<object?>()));
            outList.AddRange(items);
            var total = NumOr(P(list, "total"), 0);
            if (items.Count == 0 || outList.Count >= total) break;
        }
        return outList;
    }

    // ------------------------------------------------------------ the catalogue

    private const double Month = 30 * 86400e3, Hour = 3600e3;

    public Task<object?> Album(string id) => Get("album/get", [("album_id", id), ("extra", "track_ids")], Month);
    public Task<List<object?>> AlbumTracks(string id) => GetAll("album/get", [("album_id", id)], j => P(j, "tracks"), Month);
    public Task<object?> Search(string query, double limit, double offset) => Get("catalog/search", [("query", query), ("limit", limit), ("offset", offset)], Hour);
    public Task<object?> Artist(string id, double limit, double offset) => Get("artist/get", [("artist_id", id), ("extra", "albums"), ("limit", limit), ("offset", offset)], Hour);
    public Task<object?> Featured(object? type, double limit, double offset = 0) => Get("album/getFeatured", [("type", type), ("limit", limit), ("offset", offset)], Hour);
    public Task<object?> FavouriteIds(bool fresh, long? version) => Get("favorite/getUserFavoriteIds", [], 60e3, fresh, version);
}
