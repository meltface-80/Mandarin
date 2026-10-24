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
            var done = Looked();
            if (s.Albums.FirstOrDefault(a => !done.ContainsKey(a.Id) && !a.Transient && a.Service == null) is { } al) await LookAtAlbum(al);
            if (NextArtist(s) is { } act) await LookUp(act.Name, act.Mbid);
        }
        catch (Exception e) when (e is LookupError or Microsoft.Data.Sqlite.SqliteException or IOException) { log($"[credits] {e.Message}"); }
        finally { Interlocked.Exchange(ref ticking, 0); }
    }

    /* The next act to look up: an album artist of the library's, else a name credited with a MusicBrainz id. */
    private (string Name, string? Mbid)? NextArtist(Snapshot s)
    {
        var seen = Known();
        foreach (var al in s.Albums)
        {
            if (al.Compilation || al.Transient) continue;
            foreach (var (name, _) in al.ArtistNames)
            {
                var key = Names.ArtistKey(name);
                if (key.Length > 0 && !seen.ContainsKey(key)) return (name, actIds.TryGetValue(key, out var id) ? id : null);
            }
        }
        foreach (var (key, name, mbid) in CreditStore.CreditedUnknown(20))
            if (!seen.ContainsKey(key)) return (name, mbid);
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
    public async Task LookUp(string name, string? mbid)
    {
        var key = Names.ArtistKey(name);
        if (key.Length == 0) return;
        Known()[key] = 0;
        ArtistFacts? facts = null;
        string? photo, source;
        try
        {
            mbid ??= actIds.TryGetValue(key, out var id) ? id : await Find(name);
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
            // MusicBrainz out of reach: not kept, so asked again after a restart; a page asks again in an hour.
            log($"[credits] {name}: {e.Message}");
            failed[key] = NowMs();
            return;
        }
        failed.TryRemove(key, out _);
        CreditStore.SaveArtist(key, name, facts?.Mbid ?? mbid, facts, photo, source);
        // Another name for an artist already kept (item 151): the library read again, as one artist.
        if ((facts?.Mbid ?? mbid) is { } kept && SameArtists.Shared(kept)) await Library.Tell(new System.Text.Json.Nodes.JsonObject { ["lookups"] = true });
        // The artists' list is kept for the library's copy (LibraryRoutes.Kept.cs); a picture found changes it without a new copy.
        if (photo != null) Library.ForgetKept("/api/artists");
    }

    /*
     * For a route: an act as kept, looked up first when it hasn't been (for [waitMs] at most, the lookup going on
     * behind for the next visit). One whose lookup failed in the last hour is answered as kept, not waited on again.
     */
    public async Task<StoredArtist?> ArtistNow(string name, int waitMs)
    {
        var key = Names.ArtistKey(name);
        var kept = CreditStore.Artist(key);
        // Kept as read before (CreditStore.AboutVersion): looked up again, the old facts meanwhile and if that fails.
        if (kept != null && (int?)kept.About["v"] >= CreditStore.AboutVersion) return kept;
        if (failed.TryGetValue(key, out var at) && NowMs() - at < FailedMs) return kept;
        await Task.WhenAny(LookingUp(key, name), Task.Delay(waitMs));
        return CreditStore.Artist(key) ?? kept;
    }

    /* An act's lookup, one at a time however many pages ask; anything it throws said, not the page's. */
    private Task LookingUp(string key, string name)
    {
        var mine = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var running = lookingUp.GetOrAdd(key, mine.Task);
        if (running != mine.Task) return running;
        _ = Task.Run(async () =>
        {
            try { await LookUp(name, null); }
            catch (Exception e) { log($"[credits] {name}: {e.GetType().Name}: {e.Message}"); }
            finally { lookingUp.TryRemove(key, out _); mine.TrySetResult(); }
        });
        return mine.Task;
    }
}
