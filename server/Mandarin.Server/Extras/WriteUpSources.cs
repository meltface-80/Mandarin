// WriteUpSources.cs — asking the sources of a record's write-up (v0.8.21), as
// lib/meta.js asks them: MusicBrainz for the year, Pitchfork's review page,
// Qobuz's search and album pages, Wikipedia's search and extracts, each
// remembered in memory (as the Node server does, two thousand at most), each
// source given its own pause between requests (MusicBrainz on the one timer
// both servers share); and Pitchfork's two lists, kept six hours when they
// have anything in them. WriteUps.cs decides what each answer holds.
using System.Collections.Concurrent;
using Mandarin.Server.Identify;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal sealed class WriteUpSources(string? mbBase, string? wikipediaBase, string? pitchforkBase, string? qobuzBase, string version)
{
    public readonly string Mb = (string.IsNullOrEmpty(mbBase) ? MusicBrainz.DefaultBase : mbBase).TrimEnd('/');
    public readonly string Wikipedia = (string.IsNullOrEmpty(wikipediaBase) ? "https://en.wikipedia.org" : wikipediaBase).TrimEnd('/');
    public readonly string Pitchfork = (string.IsNullOrEmpty(pitchforkBase) ? "https://pitchfork.com" : pitchforkBase).TrimEnd('/');
    public readonly string Qobuz = (string.IsNullOrEmpty(qobuzBase) ? "https://www.qobuz.com" : qobuzBase).TrimEnd('/');
    private readonly string mbAgent = $"Mandarin/{version} ( https://github.com/meltface-80/Mandarin )";
    private const string BrowserUa = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    private static readonly (string, string)[] Browser = [("User-Agent", BrowserUa), ("Accept-Language", "en-US,en;q=0.9")];

    /* A Map kept to two thousand, the oldest let go first (meta.js's Memo). */
    private sealed class Memo
    {
        private readonly Dictionary<string, object?> map = [];
        private readonly LinkedList<string> order = new();
        public bool TryGet(string k, out object? v) { lock (map) return map.TryGetValue(k, out v); }
        public void Set(string k, object? v)
        {
            lock (map)
            {
                if (!map.ContainsKey(k)) order.AddLast(k);
                map[k] = v;
                while (map.Count > 2000) { map.Remove(order.First!.Value); order.RemoveFirst(); }
            }
        }
    }
    private readonly Memo years = new(), qobuz = new(), pitchfork = new(), wiki = new();

    /* The time since this source was last asked, at least [ms]. */
    private sealed class Pace(int ms)
    {
        private readonly SemaphoreSlim gate = new(1, 1);
        private long last;
        public async Task Wait()
        {
            await gate.WaitAsync();
            try
            {
                var elapsed = Environment.TickCount64 - last;
                if (elapsed < ms) await Task.Delay((int)(ms - elapsed));
                last = Environment.TickCount64;
            }
            finally { gate.Release(); }
        }
    }
    private readonly Pace pitchforkPace = new(1000), qobuzPace = new(700);

    private static string Key(object? title, object? artist) => WriteUps.Normalize(title) + "||" + WriteUps.Normalize(Js.Truthy(artist) ? artist : "");
    private static string S(object? v) => Js.Truthy(v) ? Js.Str(v) : "";

    // ------------------------------------------------------------ MusicBrainz

    public async Task<string?> AlbumYear(string title, string artist)
    {
        if (title.Length == 0) return null;
        var key = Key(title, artist);
        if (years.TryGet(key, out var hit)) return hit as string;
        if (Mb == MusicBrainz.DefaultBase) await Lookups.MbWait();
        var q = $"release:\"{MusicBrainz.Quote(title)}\"";
        if (artist.Length > 0) q += $" AND artist:\"{MusicBrainz.Quote(artist)}\"";
        string? year;
        try { year = WriteUps.PickAlbumYear(await Lookups.Json($"{Mb}/release-group/?query={Lookups.Encode(q)}&fmt=json&limit=5", [("User-Agent", mbAgent)], 8000)); }
        catch (Exception) { year = null; }
        years.Set(key, year);
        return year;
    }

    // ------------------------------------------------------------ Qobuz

    public async Task<JsObj?> QobuzReview(string title, string artist)
    {
        if (title.Length == 0) return null;
        var key = Key(title, artist);
        if (qobuz.TryGet(key, out var hit)) return hit as JsObj;
        JsObj? outObj = null;
        try
        {
            var q = Js.Trim($"{title} {artist}");
            await qobuzPace.Wait();
            var searchHtml = await Lookups.Text($"{Qobuz}/us-en/search?q={Lookups.Encode(q)}", Browser, 12000);
            if (WriteUps.QobuzPick(searchHtml, title, artist) is { } pick)
            {
                await qobuzPace.Wait();
                var albumUrl = $"{Qobuz}/us-en/album/{pick.Slug}/{pick.Id}";
                outObj = WriteUps.QobuzAlbumPage(await Lookups.Text(albumUrl, Browser, 12000), title, artist, albumUrl);
            }
        }
        catch (Exception) { outObj = null; }
        qobuz.Set(key, outObj);
        return outObj;
    }

    // ------------------------------------------------------------ Wikipedia

    private async Task<List<object?>> WikiSearch(string query, int limit = 5)
    {
        var data = await Lookups.Json($"{Wikipedia}/w/api.php?action=query&list=search&srsearch={Lookups.Encode(query)}&srlimit={limit}&format=json&origin=*",
            [("User-Agent", mbAgent)], 8000);
        return (data as JsObj)?["query"] is JsObj q && q["search"] is List<object?> l && l.Count > 0 ? l : [];
    }
    private async Task<JsObj?> WikiExtract(object? pageTitle)
    {
        var data = await Lookups.Json($"{Wikipedia}/w/api.php?action=query&prop=extracts|info&exintro=true&explaintext=true&redirects=1&inprop=url&titles={Lookups.Encode(Js.Str(pageTitle))}&format=json&origin=*",
            [("User-Agent", mbAgent)], 8000);
        return WriteUps.WikiExtractOf(data);
    }
    private static object? TitleOf(object? c) => c is JsObj o ? o["title"] : Undef.V;

    private async Task<JsObj?> WikiAlbum(string title, string artist)
    {
        if (title.Length == 0) return null;
        foreach (var c in await WikiSearch($"{title} {artist} album"))
        {
            var ext = await WikiExtract(TitleOf(c));
            if (ext == null) continue;
            if (WriteUps.WikiAlbumAccepts(TitleOf(c), ext, title, artist)) { ext["source"] = "Wikipedia"; return ext; }
        }
        return null;
    }

    /* Whether Wikipedia's full text ties the article to the album: `"artist" "album"` finds it. Errors: not confirmed. */
    private async Task<bool> WikiMentionsAlbum(object? pageTitle, string artist, string albumTitle)
    {
        try
        {
            var want = WriteUps.Normalize(pageTitle);
            return (await WikiSearch($"\"{artist}\" \"{albumTitle}\"", 10)).Any(h => WriteUps.Normalize(TitleOf(h)) == want);
        }
        catch (Exception) { return false; }
    }

    /* The artist's own article: { title, description, url, name, source }, or null. */
    public async Task<JsObj?> WikiArtist(string name, string? albumTitle)
    {
        if (name.Length == 0) return null;
        var primary = WriteUps.WikiArtistPrimary(name);
        foreach (var c in await WikiSearch($"{primary} band musician singer"))
        {
            if (!WriteUps.WikiArtistTitleOk(TitleOf(c), primary)) continue;
            var ext = await WikiExtract(TitleOf(c));
            if (ext == null || !WriteUps.WikiArtistExtractOk(ext)) continue;
            if (!string.IsNullOrEmpty(albumTitle) && !await WikiMentionsAlbum(TitleOf(c), primary, albumTitle)) continue;
            ext["name"] = ext["title"];
            ext["source"] = "Wikipedia";
            return ext;
        }
        return null;
    }

    private async Task<JsObj?> WikipediaBoth(string title, string artist)
    {
        if (title.Length == 0) return null;
        var key = Key(title, artist);
        if (wiki.TryGet(key, out var hit)) return hit as JsObj;
        JsObj? result = null;
        var albumTask = Quiet(WikiAlbum(title, artist));
        var artistTask = artist.Length > 0 ? Quiet(WikiArtist(artist, title)) : Task.FromResult<JsObj?>(null);
        var (album, artistInfo) = (await albumTask, await artistTask);
        if (album != null || artistInfo != null)
        {
            result = new JsObj();
            result["album"] = album;
            result["artist"] = artistInfo;
        }
        wiki.Set(key, result);
        return result;
    }

    // ------------------------------------------------------------ Pitchfork

    private async Task<JsObj?> PitchforkReview(string title, string artist)
    {
        var key = Key(title, artist);
        if (pitchfork.TryGet(key, out var hit)) return hit as JsObj;
        var primary = WriteUps.PitchforkPrimary(artist);
        string artistSlug = WriteUps.SlugifyForPitchfork(primary), albumSlug = WriteUps.SlugifyForPitchfork(title);
        if (artistSlug.Length == 0 || albumSlug.Length == 0) { pitchfork.Set(key, null); return null; }
        var url = $"{Pitchfork}/reviews/albums/{artistSlug}-{albumSlug}/";
        JsObj? outObj;
        try
        {
            await pitchforkPace.Wait();
            outObj = WriteUps.PitchforkVerdict(await Lookups.Text(url, Browser, 15000), primary, url);
        }
        catch (Exception) { outObj = null; }
        pitchfork.Set(key, outObj);
        return outObj;
    }

    private static async Task<T?> Quiet<T>(Task<T?> t) where T : class
    {
        try { return await t; } catch (Exception) { return null; }
    }

    /* Pitchfork, Qobuz and Wikipedia asked together, and made one (WriteUps.CombineBios). */
    public async Task<JsObj?> AlbumBios(string title, string artist)
    {
        if (title.Length == 0) return null;
        var pf = Quiet(PitchforkReview(title, artist));
        var qz = Quiet(QobuzReview(title, artist));
        var wk = Quiet(WikipediaBoth(title, artist));
        await Task.WhenAll(pf, qz, wk);
        return WriteUps.CombineBios(pf.Result, qz.Result, wk.Result, artist);
    }

    // ------------------------------------------------------------ Pitchfork's lists

    private static readonly TimeSpan ListTtl = TimeSpan.FromHours(6);
    private readonly ConcurrentDictionary<string, (DateTime At, List<JsObj> Items)> lists = new();
    private readonly ConcurrentDictionary<string, Lazy<Task<List<JsObj>>>> listPending = new();
    private static readonly (string, string)[] PfHeaders = Browser;

    private async Task<List<JsObj>> Listing(string path)
    {
        await pitchforkPace.Wait();
        return PitchforkLists.ListingItems(await Lookups.Text(Pitchfork + path, PfHeaders, 15000));
    }
    private async Task<List<JsObj>> Rss()
    {
        await pitchforkPace.Wait();
        return PitchforkLists.ParseRss(await Lookups.Text(Pitchfork + "/feed/feed-album-reviews/rss", PfHeaders, 15000));
    }

    private async Task<List<JsObj>> BuildList(string type)
    {
        if (type == "best")
            return PitchforkLists.NewestFirst((await Listing("/reviews/best/albums/")).Select(PitchforkLists.ItemOut).Where(it => Js.Truthy(it["album"])));
        Exception? listErr = null;
        var items = new List<JsObj>();
        try { items = (await Listing("/reviews/albums/")).Select(PitchforkLists.ItemOut).Where(it => Js.Truthy(it["album"])).ToList(); }
        catch (Exception e) { listErr = e; }
        if (items.Count > 0) return PitchforkLists.NewestFirst(items);
        List<JsObj> rss;
        try { rss = await Rss(); } catch (Exception) { rss = []; }
        var outList = rss.Select(r =>
        {
            var x = new JsObj();
            x["url"] = r["url"];
            x["album"] = r["album"];
            x["artist"] = PitchforkLists.ArtistFromReviewUrl(r["url"], r["album"]);
            x["cover"] = r["cover"];
            x["date"] = r["date"];
            return PitchforkLists.ItemOut(x);
        }).Where(it => Js.Truthy(it["album"])).ToList();
        if (outList.Count == 0 && listErr != null) throw listErr;
        return outList;
    }

    /* Latest or Best New Music: kept six hours when there's anything in it; one fetch at a time for each. */
    public async Task<List<JsObj>> Reviews(string type)
    {
        if (lists.TryGetValue(type, out var hit) && DateTime.UtcNow - hit.At < ListTtl) return hit.Items;
        var mine = new Lazy<Task<List<JsObj>>>(async () =>
        {
            try
            {
                var items = await BuildList(type);
                if (items.Count > 0) lists[type] = (DateTime.UtcNow, items);
                return items;
            }
            finally { listPending.TryRemove(type, out _); }
        });
        return await listPending.GetOrAdd(type, mine).Value;
    }

    /* The reviews on either list that the search's words find. */
    public async Task<List<JsObj>> SearchReviews(string q, int limit)
    {
        if (WriteUps.Normalize(q).Length == 0) return [];
        var latest = Quiet2(Reviews("latest"));
        var best = Quiet2(Reviews("best"));
        return PitchforkLists.Match(await latest, await best, q, limit);
    }
    private static async Task<List<JsObj>> Quiet2(Task<List<JsObj>> t) { try { return await t; } catch (Exception) { return []; } }

    // ------------------------------------------------------------ the Qobuz app's link

    /* The id of the album on Qobuz's own search page for this storefront, or null. */
    public async Task<string?> QobuzAlbumId(string store, string artist, string album)
    {
        var query = ShareLinks.SearchQuery(ShareLinks.PrimaryArtist(artist), album);
        if (query == null) return null;
        var html = await Lookups.Text($"{Qobuz}/{store}/search/albums/{query}", Browser, 12000);
        return WriteUps.PickAlbumId(html, store, ShareLinks.PrimaryArtist(artist), album);
    }
}
