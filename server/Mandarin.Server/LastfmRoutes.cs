// LastfmRoutes.cs — Last.fm, read-only (v0.8.26): lib/server/api-lastfm.js in
// the same shapes. The album view's similar artists and similar albums, and
// the key they need (Settings → Setup → API Keys): one saved in Settings, else
// LASTFM_KEY (the Node server says, Jobs.cs) — a saved one wins from the
// moment it is saved, even an empty one.
//
// With no key both lists answer { enabled: false }. A key Last.fm refuses
// (its errors 10 and 26) is said so, the one failure the user can fix;
// anything else leaves the sections out. Whether an artist or an album is in
// the library is decided here, before the tap. Last.fm's pictures go through
// this server's image address ("u-" keys, drawn by the Node server).
// Answered here once the Node server has handed over its work; until then, by it.
using System.Text;
using System.Text.Json.Nodes;
using Mandarin.Server.Extras;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private static Lastfm? HeldLastfm => Jobs.Held ? Jobs.Lastfm : null;

    /* The key saved in Settings: absent (null) until one is, even an empty one. */
    private static string? SavedLastfmKey()
    {
        var s = Labels.Setting("lastfmKey");
        return s is Undef || s == null ? null : TJs.Str(s);
    }
    public static string LastfmKey() => Names.JsTrim(SavedLastfmKey() ?? Jobs.LastfmEnvKey ?? "");
    private static string LastfmSource() => LastfmKey().Length == 0 ? "" : SavedLastfmKey() != null ? "settings" : "env";
    private static string LastfmMasked() => LastfmKey() is { Length: > 0 } k ? "••••" + (k.Length > 4 ? k[^4..] : k) : "";

    /* GET /api/settings/lastfm-key */
    private static async Task<bool> LastfmKeyState(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldLastfm is not { } fm) return false;
        var k = LastfmKey();
        return await Send(ctx, new JsonObject
        {
            ["set"] = k.Length > 0, ["configured"] = k.Length > 0, ["masked"] = LastfmMasked(), ["source"] = LastfmSource(),
            ["check"] = k.Length > 0 ? await fm.CheckKey(k, false, Front.Log) : null
        });
    }

    /* POST /api/settings/lastfm-key { key }: kept, checked at once; nothing remembered from the old one. */
    private static async Task<bool> SaveLastfmKey(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldLastfm is not { } fm) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var given = (FromNode(b) as JsObj ?? new JsObj())["key"];
        Labels.SetSetting("lastfmKey", Names.JsTrim(TJs.Truthy(given) ? TJs.Str(given) : ""));
        fm.Clear();
        var k = LastfmKey();
        return await Send(ctx, new JsonObject
        {
            ["ok"] = true, ["set"] = k.Length > 0, ["masked"] = LastfmMasked(), ["source"] = LastfmSource(),
            ["check"] = k.Length > 0 ? await fm.CheckKey(k, true, Front.Log) : null
        });
    }

    /* What the page is told when Last.fm couldn't answer. */
    private static JsonObject LastfmFailure(Exception e)
    {
        if (e is LastfmError { Code: "nokey" }) return new JsonObject { ["enabled"] = false };
        var refused = e is LastfmError { KeyRefused: true };
        if (!refused) Front.Log("[lastfm] " + e.Message);
        return new JsonObject { ["enabled"] = true, ["error"] = refused ? "Last.fm refused the API key" : "Last.fm did not answer" };
    }

    // The album's lead artist: the first of the credit's names.
    private static string LeadOf(string credit) => Names.SplitArtists(credit) is { Count: > 0 } n && n[0].Length > 0 ? n[0] : credit;
    // Artwork.foreignKey: a picture from elsewhere, through this server's image address.
    private static string? Picture(string url) => url.Length > 0
        ? "u-" + Convert.ToBase64String(Encoding.UTF8.GetBytes(url)).TrimEnd('=').Replace('+', '-').Replace('/', '_') : null;

    /* An artist as the page shows it: Last.fm's, and whether the library has them (by or with them), a cover of theirs if so. */
    private static JsonObject LastfmArtistJson(Snapshot s, LastfmArtist a)
    {
        var (primary, featured) = ArtistAlbumsOf(s, a.Name);
        var own = primary.Count > 0 ? primary[0] : featured.Count > 0 ? featured[0] : null;
        return new JsonObject
        {
            ["name"] = a.Name, ["url"] = a.Url, ["image"] = a.Image, ["in_library"] = own != null,
            ["image_key"] = own != null ? own.ImageKey : Picture(a.Image)
        };
    }

    // The library by title, made once per copy of it: nine albums are looked up for every album opened.
    private static (Snapshot? Of, Dictionary<string, List<Album>> Strict, Dictionary<string, List<Album>> Loose) lastfmTitles = (null, [], []);
    private static (Dictionary<string, List<Album>> Strict, Dictionary<string, List<Album>> Loose) TitlesOf(Snapshot s)
    {
        var t = lastfmTitles;
        if (t.Of == s) return (t.Strict, t.Loose);
        var strict = new Dictionary<string, List<Album>>();
        var loose = new Dictionary<string, List<Album>>();
        static void Add(Dictionary<string, List<Album>> m, string k, Album al)
        {
            if (k.Length == 0) return;
            if (m.TryGetValue(k, out var l)) l.Add(al); else m[k] = [al];
        }
        foreach (var al in s.Albums) { Add(strict, Names.Fold(al.Title), al); Add(loose, ArtFind.Loose(al.Title), al); }
        lastfmTitles = (s, strict, loose);
        return (strict, loose);
    }

    /* A Last.fm album in the library: the same title (edition words aside) and a credited name in common — never the title alone. */
    private static Album? LastfmInLibrary(Snapshot s, string title, string artist)
    {
        var want = new HashSet<string>(new[] { Names.ArtistKey(artist) }.Concat(Names.SplitArtists(artist).Select(Names.ArtistKey)).Where(x => x.Length > 0));
        if (want.Count == 0) return null;
        bool Theirs(Album al) => want.Contains(Names.ArtistKey(al.Artist)) || al.ArtistNames.Any(x => want.Contains(Names.ArtistKey(x.Name)));
        var (strict, loose) = TitlesOf(s);
        foreach (var hits in new[] { strict.GetValueOrDefault(Names.Fold(title)), loose.GetValueOrDefault(ArtFind.Loose(title)) })
            if (hits?.FirstOrDefault(Theirs) is { } al) return al;
        return null;
    }

    /* GET /api/lastfm/similar-artists?artist= */
    private static async Task<bool> LastfmSimilarArtists(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldLastfm is not { } fm) return false;
        var credit = Names.JsTrim(Q(ctx, "artist") ?? "");
        if (credit.Length == 0) return await Send(ctx, new JsonObject { ["error"] = "artist required" }, 400);
        if (LastfmKey().Length == 0) return await Send(ctx, new JsonObject { ["enabled"] = false });
        try
        {
            var sim = await fm.SimilarArtists(LeadOf(credit));
            return await Send(ctx, new JsonObject
            {
                ["enabled"] = true, ["artist"] = sim.Artist, ["url"] = sim.Url,
                ["artists"] = new JsonArray(sim.Artists.Take(12).Select(a => (JsonNode)LastfmArtistJson(s, a)).ToArray())
            });
        }
        catch (Exception e) when (e is LastfmError or HttpRequestException) { return await Send(ctx, LastfmFailure(e)); }
    }

    /*
     * GET /api/lastfm/similar-albums?artist= — a page that has moved on to
     * another album gives up the request, and each of the nine is a call
     * queued behind the last: one nobody is waiting for stops asking.
     */
    private static async Task<bool> LastfmSimilarAlbums(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldLastfm is not { } fm) return false;
        var credit = Names.JsTrim(Q(ctx, "artist") ?? "");
        if (credit.Length == 0) return await Send(ctx, new JsonObject { ["error"] = "artist required" }, 400);
        if (LastfmKey().Length == 0) return await Send(ctx, new JsonObject { ["enabled"] = false });
        bool Gone() => ctx.RequestAborted.IsCancellationRequested;
        try
        {
            var (_, albums) = await fm.SimilarAlbums(LeadOf(credit), 9, () => !Gone());
            if (Gone()) return true;
            return await Send(ctx, new JsonObject
            {
                ["enabled"] = true,
                ["albums"] = new JsonArray(albums.Select(al =>
                {
                    var own = LastfmInLibrary(s, al.Title, al.Artist);
                    return (JsonNode)new JsonObject
                    {
                        ["title"] = al.Title, ["artist"] = al.Artist, ["url"] = al.Url, ["image"] = al.Image,
                        ["image_key"] = Picture(al.Image), ["album"] = own != null ? AlbumJson(s, own) : null
                    };
                }).ToArray())
            });
        }
        catch (Exception e) when (e is LastfmError or HttpRequestException)
        {
            if (Gone()) return true;
            return await Send(ctx, LastfmFailure(e));
        }
    }
}
