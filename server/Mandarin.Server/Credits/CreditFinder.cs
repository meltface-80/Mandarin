// CreditFinder.cs — finding the albums' credits and the acts behind them (bug
// list item 129), in the background and when a page asks first.
//
// An album: its files' own tags (PERFORMER "Name (drums)", PRODUCER, ENGINEER…),
// then, where the album has a MusicBrainz release (its tags' album id, or the
// identification scan's applied match), that release's relations: who played
// and sang on each recording, who wrote each work, who made the record.
//
// An act: found on MusicBrainz (the release's own id for it, or by its name),
// its members or bands and its links (Wikidata, Wikipedia, Discogs…), and a
// picture: FanArt.tv's portrait (with a key, Settings → API Keys), else
// Wikidata's (Wikimedia Commons), else Deezer's.
//
// One album and one act a tick, MusicBrainz's one request a second
// (Lookups.MbWait) shared with everything else that asks it. The library's
// album artists first, so the artists' wall fills; then those credited.
using System.Collections.Concurrent;
using Mandarin.Server.Extras;
using Mandarin.Server.Identify;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Credits;

internal sealed class CreditFinder(MusicBrainz mb, string? deezerBase, string? wikidataBase, string fanartBase, string userAgent, Action<string> log)
{
    public const string ReleaseInc = "artists+recordings+artist-credits+artist-rels+recording-level-rels+work-rels+work-level-rels";
    private const long Day = 86_400_000;

    /* The one the routes ask (Jobs.cs sets it up). */
    public static CreditFinder? Current { get; set; }

    public Func<bool> Ready = () => true;

    private readonly string deezer = (string.IsNullOrEmpty(deezerBase) ? Taste.DeezerBase : deezerBase).TrimEnd('/');
    private readonly string wikidata = (string.IsNullOrEmpty(wikidataBase) ? "https://www.wikidata.org" : wikidataBase).TrimEnd('/');
    // The release's own ids for its acts, by key: an act looked up later needn't be searched for by name.
    private readonly ConcurrentDictionary<string, string> actIds = new(StringComparer.Ordinal);
    // An act's lookup under way, shared by the pages that ask meanwhile; and when one last failed, by key.
    private readonly ConcurrentDictionary<string, Task> lookingUp = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, long> failed = new(StringComparer.Ordinal);
    private const long FailedMs = 3_600_000;
    private ConcurrentDictionary<long, byte>? looked;
    private Snapshot? lookedIn;
    private ConcurrentDictionary<string, byte>? known;
    private Timer? timer;
    private int ticking;

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public void Start(int tickMs)
    {
        timer?.Dispose();
        timer = new Timer(_ => { _ = Tick(); }, null, Math.Min(60_000, tickMs * 10), tickMs);
    }

    public void Stop()
    {
        timer?.Dispose();
        timer = null;
    }

    private ConcurrentDictionary<long, byte> Looked() =>
        looked ??= new(CreditStore.AlbumsLooked(NowMs() - Day).Select(id => new KeyValuePair<long, byte>(id, 0)));
    private ConcurrentDictionary<string, byte> Known() =>
        known ??= new(CreditStore.Photos().Keys.Select(k => new KeyValuePair<string, byte>(k, 0)), StringComparer.Ordinal);

    private async Task Tick()
    {
        if (!Ready() || Interlocked.Exchange(ref ticking, 1) == 1) return;
        try
        {
            if (await Library.CurrentState() is not var (s, st) || st.Scanning) return;
            // The library changed: read again what was looked at (an album gone takes its own, and its id may be another's now; item 179).
            if (!ReferenceEquals(s, lookedIn)) { looked = null; lookedIn = s; }
            var done = Looked();
            if (s.Albums.FirstOrDefault(a => !done.ContainsKey(a.Id) && !a.Transient && a.Service == null) is { } al) await LookAtAlbum(al);
            if (NextArtist(s) is { } act)
            {
                // An act of the library's: the one its albums are by (item 340), not whoever the name finds first.
                var mbid = act.Mbid;
                if (mbid == null && act.Albums is { Count: > 0 } own)
                {
                    var (filed, titles) = Library.ActOfAlbums(own);
                    mbid = filed ?? await ActByAlbums(act.Name, titles);
                }
                await LookUp(act.Name, mbid);
            }
        }
        catch (Exception e) when (e is LookupError or Microsoft.Data.Sqlite.SqliteException or IOException) { log($"[credits] {e.Message}"); }
        finally { Interlocked.Exchange(ref ticking, 0); }
    }

    /* The next act to look up: an album artist of the library's, else a name credited with a MusicBrainz id. */
    private (string Name, string? Mbid, List<Album>? Albums)? NextArtist(Snapshot s)
    {
        var seen = Known();
        foreach (var al in s.Albums)
        {
            if (al.Compilation || al.Transient) continue;
            foreach (var (name, _) in al.ArtistNames)
            {
                var key = Names.ArtistKey(name);
                if (key.Length > 0 && !seen.ContainsKey(key))
                    return (name, actIds.TryGetValue(key, out var id) ? id : null,
                        s.Albums.Where(a => !a.Compilation && a.ArtistNames.Length > 0 && Names.ArtistKey(a.ArtistNames[0].Name) == key).ToList());
            }
        }
        foreach (var (key, name, mbid) in CreditStore.CreditedUnknown(20))
            if (!seen.ContainsKey(key)) return (name, mbid, null);
        return null;
    }

    // ---------------------------------------------------------------- an album

    private static bool IsMbid(string? s) => s is { Length: 36 } && Guid.TryParse(s, out _);

    /* The album's MusicBrainz release: its own (the tags'), its tracks' most common, or the identification scan's applied match. */
    private static string? ReleaseOf(Album al)
    {
        using var c = Db.Open();
        if (Library.Rows(c, "SELECT mb_album FROM albums WHERE id = $1", al.Id).Select(r => r[0] as string).FirstOrDefault() is var own && IsMbid(own)) return own;
        if (Library.Rows(c, "SELECT mb_album FROM tracks WHERE album_id = $1 AND mb_album IS NOT NULL AND mb_album <> '' GROUP BY mb_album ORDER BY count(*) DESC LIMIT 1", al.Id)
                .Select(r => r[0] as string).FirstOrDefault() is var most && IsMbid(most)) return most;
        return Library.Rows(c, "SELECT mbid FROM album_matches WHERE key = $1 AND status = 'applied'", al.Key)
            .Select(r => r[0] as string).FirstOrDefault(IsMbid);
    }

    /* Each track's credits from its raw tags, the tracks in the album's order; and how many tracks there are. */
    private static (List<Credit> Credits, int Tracks) TagCredits(long albumId)
    {
        using var c = Db.Open();
        var rows = Library.Rows(c, "SELECT tt.tags FROM tracks t LEFT JOIN track_tags tt ON tt.track_id = t.id WHERE t.album_id = $1 ORDER BY t.disc_no, t.track_no, t.path", albumId);
        var list = new List<Credit>();
        for (var i = 0; i < rows.Count; i++)
        {
            if (rows[i][0] is not string json) continue;
            object? tags;
            try { tags = Scan.JsJson.Parse(json); } catch (Exception) { continue; }
            if (tags is JsObj o) list.AddRange(CreditRules.FromTags(i + 1, o));
        }
        return (list, rows.Count);
    }

    /* An album's credits found and kept: what came of it ("tags", "musicbrainz" or "failed") and the rows. */
    public async Task<(string Status, List<AlbumCredit> Rows)> LookAtAlbum(Album al)
    {
        var (tagged, count) = TagCredits(al.Id);
        var release = ReleaseOf(al);
        var found = new List<Credit>();
        var status = "tags";
        if (release != null)
        {
            try
            {
                if (await mb.Get("release/" + release, ("inc", ReleaseInc)) is JsObj rel)
                {
                    found = CreditRules.FromRelease(rel);
                    foreach (var (name, id) in CreditRules.ReleaseActs(rel)) actIds[Names.ArtistKey(name)] = id;
                    status = "musicbrainz";
                }
            }
            catch (LookupError e)
            {
                // A release since merged or removed (404) leaves the tags'; anything else is asked again tomorrow.
                if (e.Status != 404) { status = "failed"; log($"[credits] release {release}: {e.Message}"); }
            }
        }
        var rows = CreditRules.Merge(tagged.Concat(found), count);
        CreditStore.SaveAlbum(al.Id, rows, release, status);
        Looked()[al.Id] = 0;
        return (status, rows);
    }

    /* For a route: an album's credits as kept, found first when they haven't been (for [waitMs] at most: "pending" past it). */
    public async Task<string> AlbumNow(Album al, int waitMs)
    {
        if (CreditStore.AlbumStatus(al.Id) is { } kept) return kept;
        var t = LookAtAlbum(al);
        return await Task.WhenAny(t, Task.Delay(waitMs)) == t ? (await t).Status : "pending";
    }

    // ---------------------------------------------------------------- an act

    private async Task<string?> Find(string name) =>
        await mb.Get("artist/", ("query", $"artist:\"{name.Replace("\"", "", StringComparison.Ordinal)}\""), ("limit", 5)) is JsObj found
            ? CreditRules.FoundMbid(found, name) : null;

    /* A picture of the act: FanArt.tv's (with a key), Wikidata's ([wd], its entity when it has one), Deezer's; and where it came from. */
    private async Task<(string? Url, string? Source)> Photo(string name, string? mbid, (JsObj Data, string Q)? wd)
    {
        var key = LabelLogos.FanartKey();
        if (mbid != null && key.Length > 0)
        {
            try
            {
                if (await Lookups.Json($"{fanartBase}/v3/music/{Lookups.Encode(mbid)}?api_key={Lookups.Encode(key)}", [], 15000) is JsObj f && CreditRules.FanartPhoto(f) is { } u)
                    return (u, "fanart.tv");
            }
            catch (LookupError) { /* none there: the next source */ }
        }
        if (wd is { } w && CreditRules.WikidataPhoto(w.Data, w.Q) is { } u2) return (u2, "Wikimedia Commons");
        try
        {
            if (await Lookups.Json($"{deezer}/search/artist?q={Lookups.Encode(name)}&limit=5", [], 8000) is JsObj d && CreditRules.DeezerPhoto(d, name) is { } u)
                return (u, "Deezer");
        }
        catch (LookupError) { /* none */ }
        return (null, null);
    }

    /* An act looked up and kept: its MusicBrainz entry (by [mbid], or found by name), its facts and picture. */
    public async Task LookUp(string name, string? mbid, string? storeKey = null)
    {
        var key = storeKey ?? Names.ArtistKey(name);
        if (key.Length == 0) return;
        Known()[key] = 0;
        ArtistFacts? facts = null;
        string? photo, source;
        try
        {
            mbid ??= actIds.TryGetValue(Names.ArtistKey(name), out var id) ? id : await Find(name);
            if (mbid != null && await mb.Get("artist/" + mbid, ("inc", "artist-rels+url-rels")) is JsObj a) facts = CreditRules.ArtistOf(a);
            // Wikidata's entry, once: its picture, and its official site over MusicBrainz's (kept up better; item 133).
            (JsObj, string)? wd = null;
            if (CreditRules.WikidataId(facts?.Links.GetValueOrDefault("wikidata")) is { } q)
            {
                try { if (await Lookups.Json($"{wikidata}/wiki/Special:EntityData/{q}.json", [("User-Agent", userAgent)], 15000) is JsObj w) wd = (w, q); }
                catch (LookupError) { /* none there: MusicBrainz's site, and the next picture */ }
            }
            if (facts != null && wd is { } d && CreditRules.WikidataSite(d.Item1, d.Item2) is { } site) facts.Links["official"] = site;
            (photo, source) = await Photo(name, mbid, wd);
        }
        catch (LookupError e)
        {
            // MusicBrainz out of reach: not kept, so asked again after a restart; a page asks again in an hour. Resting
            // (item 396): said once by MusicBrainz.cs, not again for every act asked about meanwhile.
            if (!e.Paused) log($"[credits] {name}: {e.Message}");
            failed[key] = NowMs();
            return;
        }
        failed.TryRemove(key, out _);
        CreditStore.SaveArtist(key, name, facts?.Mbid ?? mbid, facts, photo, source);
        // Another name for an artist already kept (item 151): the library read again, as one artist (in the background, Library.Copy.cs).
        if ((facts?.Mbid ?? mbid) is { } kept && SameArtists.Shared(kept)) await Library.TellSoon(new System.Text.Json.Nodes.JsonObject { ["lookups"] = true });
        // The artists' list is kept for the library's copy (LibraryRoutes.Kept.cs); a picture found changes it without a new copy.
        if (photo != null) Library.ForgetKept("/api/artists");
    }

    /*
     * For a route: an act as kept, looked up first when it hasn't been (for [waitMs] at most, the lookup going on
     * behind for the next visit). One whose lookup failed in the last hour is answered as kept, not waited on again.
     * The act is the library's where it knows it (item 340): [mbid], what its albums' tags or matches say, else the act
     * MusicBrainz credits with the library's [titles]; one kept for the name that is another act is looked up again.
     * [storeKey]: where it is kept (the name's key; the act's own where acts share the name).
     */
    public async Task<(StoredArtist? Info, bool Pending)> ArtistNow(string name, int waitMs, string? mbid = null, IReadOnlyList<string>? titles = null, string? storeKey = null)
    {
        var key = storeKey ?? Names.ArtistKey(name);
        var kept = CreditStore.Artist(key);
        if (failed.TryGetValue(key, out var at) && NowMs() - at < FailedMs) return (kept, false);
        var current = kept != null && (int?)kept.About["v"] >= CreditStore.AboutVersion;
        // The act to go by: the library's, else the one the titles found before (asked of MusicBrainz below where not yet).
        var (asked, found) = mbid != null ? (true, mbid) : titles is { Count: > 0 } t ? KeptActByAlbums(name, t) : (true, null);
        var act = mbid ?? found;
        // Kept, of this act (or of none to go by): as kept. Kept as read before (CreditStore.AboutVersion): looked up again.
        if (current && asked && (act == null || kept!.Mbid == act)) return (kept, false);
        var lookup = LookingUp(key, name, mbid, titles);
        var done = await Task.WhenAny(lookup, Task.Delay(waitMs)) == lookup;
        var now = CreditStore.Artist(key) ?? kept;
        // Still looking: what is kept for another act is not said meanwhile (item 341), and the page asks again.
        if (!done && act != null && now?.Mbid != act) return (null, true);
        return (now, !done);
    }

    /* What the albums' titles found before (kept a month): whether they were asked, and the act (null: none found). */
    private static (bool Asked, string? Act) KeptActByAlbums(string name, IReadOnlyList<string> titles) =>
        Extras.Taste.CacheGet("act-by-albums", ActKey(name, titles), 30.0 * Day) is var hit and not Undef ? (true, hit as string) : (false, null);

    private static string ActKey(string name, IReadOnlyList<string> titles) =>
        Names.ArtistKey(name) + "|" + string.Join("|", titles.Where(t => t.Length > 0).Distinct(StringComparer.Ordinal).Take(3).Select(Names.Fold));

    /* The act MusicBrainz credits with the most of [titles] (three at most) under [name]; null where none; kept a month. */
    private async Task<string?> ActByAlbums(string name, IReadOnlyList<string> titles)
    {
        var asked = titles.Where(t => t.Length > 0).Distinct(StringComparer.Ordinal).Take(3).ToList();
        if (asked.Count == 0) return null;
        var cacheKey = ActKey(name, titles);
        if (KeptActByAlbums(name, titles) is (true, var kept)) return kept;
        var votes = new List<string>();
        foreach (var t in asked)
        {
            var q = $"releasegroup:\"{Lucene(t)}\" AND artist:\"{Lucene(name)}\"";
            // MusicBrainz not answering: none found this time (not kept), the act looked up by its name as before.
            try { if (await mb.Get("release-group/", ("query", q), ("limit", 5)) is JsObj found && CreditRules.ActOfReleaseGroups(found, name) is { } id) votes.Add(id); }
            catch (LookupError) { return null; }
        }
        var act = votes.GroupBy(v => v, StringComparer.Ordinal).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault();
        Extras.Taste.CachePut("act-by-albums", cacheKey, act);
        return act;
    }

    private static string Lucene(string s) => s.Replace("\\", " ", StringComparison.Ordinal).Replace("\"", " ", StringComparison.Ordinal);

    /* An act's lookup, one at a time however many pages ask; anything it throws said, not the page's. */
    private Task LookingUp(string key, string name, string? mbid = null, IReadOnlyList<string>? titles = null)
    {
        var mine = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var running = lookingUp.GetOrAdd(key, mine.Task);
        if (running != mine.Task) return running;
        _ = Task.Run(async () =>
        {
            try
            {
                // The act the library's albums are by, where it says (item 340); as kept when that is the one kept.
                // The release's own id for it first (no search), then its albums' titles.
                var act = mbid ?? (actIds.TryGetValue(Names.ArtistKey(name), out var own) ? own : null) ?? (titles != null ? await ActByAlbums(name, titles) : null);
                var kept = CreditStore.Artist(key);
                if (kept != null && (int?)kept.About["v"] >= CreditStore.AboutVersion && (act == null || kept.Mbid == act)) return;
                await LookUp(name, act, key);
            }
            catch (Exception e) { log($"[credits] {name}: {e.GetType().Name}: {e.Message}"); }
            finally { lookingUp.TryRemove(key, out _); mine.TrySetResult(); }
        });
        return mine.Task;
    }
}
