// LibraryRoutes.cs — the library's read routes (v0.8.4), from
// lib/server/api-library.js, in the same shapes. An album of a streaming
// service's page asks the service too (v0.8.44, ServiceRoutes.cs). A request
// no route here answers ends in Pages.NotThere.cs, never guessed at.
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class Library
{
    private delegate Task<bool> Handler(HttpContext ctx, Snapshot s, LibState st);

    private static readonly Dictionary<string, Handler> Gets = new()
    {
        ["/api/library-stats"] = Stats,
        // The server's health, open (v0.8.48, HealthRoutes.cs).
        ["/api/health"] = Health,
        ["/api/library/albums"] = Albums,
        ["/api/library/mark"] = Mark,
        ["/api/library/facets"] = Facets,
        ["/api/shelf/albums"] = ShelfAlbums,
        ["/api/random-albums"] = RandomAlbums,
        ["/api/album"] = AlbumPage,
        ["/api/search"] = Search,
        ["/api/artists"] = Artists,
        ["/api/artist-albums"] = ArtistAlbums,
        ["/api/filters/genres"] = GenresRoute,
        ["/api/filters/decades"] = DecadesRoute,
        ["/api/favourites"] = Favourites,
        ["/api/listen-later"] = ListenLater,
        ["/api/home/genre-groups"] = GenreGroups,
        ["/api/home/album-of-the-day"] = AlbumOfTheDay,
        ["/api/home/label-of-the-week"] = LabelOfTheWeek,
        ["/api/home/history"] = History,
        ["/api/home/unplayed"] = Unplayed,
        ["/api/settings/display"] = DisplaySettings,
        ["/api/settings/shelf"] = ShelfSettings,
        ["/api/settings/smart-picks"] = SmartPicksSettings,
        ["/api/settings/home-rows"] = HomeRowsSettings,
        ["/api/smart-playlists"] = SmartPlaylists,
        ["/api/smart-playlist"] = SmartPlaylist,
        ["/api/smart-playlist/albums"] = SmartPlaylistAlbums,
        ["/api/user-playlists"] = UserPlaylists,
        ["/api/user-playlist"] = UserPlaylist,
        ["/api/playlists"] = NoPlaylists,
        ["/api/playlist"] = NoSuchPlaylist,
        ["/api/playlist/art"] = NoPlaylistArt,
        ["/api/identify"] = IdentifyState,
        ["/api/identify/candidates"] = IdentifyCandidates,
        ["/api/identify/pack"] = PackState,
        ["/api/loudness"] = LoudnessState,
        ["/api/waveform"] = Waveform,
        ["/api/settings/waveform"] = WaveformSettings,
        ["/api/filters/labels"] = LabelWall,
        ["/api/label-albums"] = LabelAlbums,
        ["/api/labels-scan-status"] = LabelScanStatus,
        ["/api/labels-scan-log"] = LabelScanLog,
        ["/api/labels/logo-candidates"] = LogoCandidates,
        ["/api/settings/labels"] = LabelSettings,
        ["/api/settings/label-folder-depth"] = LabelFolderDepth,
        ["/api/settings/fanart-key"] = KeyState,
        ["/api/settings/discogs-token"] = KeyState,
        ["/api/similar"] = SimilarActs,
        ["/api/smart-picks"] = SmartPicks,
        ["/api/album/extras"] = AlbumExtras,
        ["/api/album/more"] = AlbumMore,
        ["/api/album/booklets"] = AlbumBooklets,
        ["/api/booklet/page"] = BookletPage,
        ["/api/artist-bio"] = ArtistBio,
        // The albums' credits and the acts behind them (bug list item 129, Credits/CreditRoutes.cs).
        ["/api/album/credits"] = AlbumCreditsRoute,
        ["/api/artist"] = ArtistRoute,
        ["/api/artist/similar"] = ArtistSimilar,
        ["/api/artist/similar-albums"] = ArtistSimilarAlbums,
        ["/api/credits/status"] = CreditsStatus,
        ["/api/pitchfork/reviews"] = PitchforkReviews,
        ["/api/pitchfork/review"] = PitchforkReviewMatch,
        ["/api/settings/share-links"] = ShareSettings,
        ["/api/qobuz-link"] = QobuzLink,
        ["/api/search/external"] = SearchExternal,
        ["/api/filters/tags"] = TagFilters,
        ["/api/album/edit"] = AlbumEditState,
        ["/api/album/art-search"] = AlbumArtSearch,
        ["/api/settings/lastfm-key"] = LastfmKeyState,
        ["/api/lastfm/similar-artists"] = LastfmSimilarArtists,
        ["/api/lastfm/similar-albums"] = LastfmSimilarAlbums,
        ["/api/dsp/headphones"] = Headphones,
        ["/api/dsp/headphones/profile"] = HeadphoneProfile,
        ["/api/download/album"] = DownloadAlbum,
        ["/api/download/auto"] = DownloadAuto,
    };
    private static readonly Dictionary<string, Handler> Posts = new()
    {
        ["/api/settings/display"] = SaveDisplaySettings,
        ["/api/settings/shelf"] = SaveShelfSettings,
        ["/api/settings/smart-picks"] = SaveSmartPicksSettings,
        ["/api/settings/home-rows"] = SaveHomeRows,
        ["/api/user-playlists"] = SavePlaylist,
        ["/api/user-playlists/delete"] = DeletePlaylist,
        ["/api/user-playlists/add"] = AddToPlaylist,
        ["/api/user-playlists/add-albums"] = AddAlbumsToPlaylist,
        ["/api/playlist/play"] = NoSuchPlaylist,
        ["/api/playlist/play-track"] = NoSuchPlaylist,
        ["/api/favourites"] = SaveFavourite,
        ["/api/listen-later"] = SaveLater,
        ["/api/labels/merge"] = MergeLabels,
        ["/api/settings/labels"] = SaveLabelsOn,
        ["/api/settings/label-folder-depth"] = SaveLabelDepth,
        ["/api/identify/settings"] = IdentifySettings,
        ["/api/identify/accept"] = IdentifyAccept,
        ["/api/identify/reject"] = IdentifyReject,
        ["/api/identify/undo"] = IdentifyUndo,
        ["/api/identify/recheck"] = IdentifyRecheck,
        ["/api/identify/recheck-all"] = IdentifyRecheckAll,
        ["/api/identify/match"] = IdentifyMatch,
        ["/api/identify/pack/download"] = PackDownload,
        ["/api/identify/pack/remove"] = PackRemove,
        ["/api/identify/pack/folder"] = PackFolder,
        ["/api/loudness"] = SaveLoudness,
        ["/api/settings/waveform"] = SaveWaveformSettings,
        ["/api/labels/rescan"] = LabelRescan,
        ["/api/labels/rescan-force"] = LabelRescan,
        ["/api/labels/logo"] = SaveLabelLogo,
        ["/api/settings/fanart-key"] = SaveKey,
        ["/api/settings/discogs-token"] = SaveKey,
        ["/api/smart-picks/rebuild"] = RebuildSmartPicks,
        ["/api/smart-picks/block"] = BlockSmartPicksArtist,
        ["/api/settings/share-links"] = SaveShareSettings,
        ["/api/share/encode"] = ShareEncode,
        ["/api/share/import"] = ShareImport,
        ["/api/smart-playlists"] = SaveSmartPlaylist,
        ["/api/smart-playlists/delete"] = DeleteSmartPlaylist,
        ["/api/album/edit"] = SaveAlbumEdit,
        ["/api/album/edit/reset"] = ResetAlbumEdit,
        ["/api/settings/lastfm-key"] = SaveLastfmKey,
        ["/api/dsp/headphones/parse"] = ParseHeadphoneProfile,
        ["/api/download/albums"] = DownloadAlbums,
        ["/api/phone/plays"] = PhonePlays,
    };
    private static readonly Dictionary<string, Handler> Deletes = new()
    {
        ["/api/labels/logo"] = RemoveLabelLogo,
    };

    /* Before the routes: what is answered here is answered; the rest goes on. */
    public static void Use(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            var m = ctx.Request.Method;
            // A merged label let go (v0.8.16, LibraryChanges.cs).
            if (UnmergeAddress(ctx, out var source))
            {
                try { await UnmergeLabel(ctx, source); } catch (Exception e) when (!ctx.Response.HasStarted) { await Server.Failed(ctx, "library", e); }
                return;
            }
            // Playback (v0.8.49, stage 6, PlaybackRoutes.cs: once this server holds the job); backup & restore and built-in Tailscale (v0.8.22, AdminRoutes.cs): the library's copy not needed.
            if (await PlaybackRoutes.Route(ctx) || await AdminRoute(ctx)) return;
            // Restart, Shut down and the processor split (v0.8.31, PowerRoutes.cs): nor here.
            if (await PowerRoute(ctx)) return;
            // Settings → Updates (v0.8.48, UpdateRoutes.cs); the app's logging's server side (item 121, DiagnosticsRoutes.cs).
            if (await UpdateRoute(ctx) || await DiagnosticsRoute(ctx)) return;
            // Audio Devices: the writes (v0.8.48, DeviceRoutes.cs); the list, a device's page, Look again and Forget (v0.8.49, DeviceRoutes.Read.cs) once this server holds playback.
            if (await DeviceRoute(ctx) || await DeviceReadRoute(ctx)) return;
            // /api/status, Clean up and the wall display's content (v0.8.48, HousekeepingRoutes.cs).
            if (await HousekeepingRoute(ctx)) return;
            // Rescan, Reindex and the music folders (v0.8.34, ScanRoutes.cs), once the scans are made here.
            if (await ScanRoute(ctx)) return;
            // Qobuz's and Tidal's catalogue, read-only (v0.8.39, ServiceRoutes.cs).
            if (await ServiceRoute(ctx)) return;
            // And their albums opened, favourited and cleaned up (v0.8.44, ServiceRoutes.cs), likewise.
            if (await ServiceWrite(ctx)) return;
            // And Settings → Services' state and switches, Update library now and the favourites' watch
            // (v0.8.45, ServiceRoutes.cs).
            if (await ServiceImport(ctx)) return;
            if (ctx.Request.Path.Value is { } p && ((HttpMethods.IsGet(m) || HttpMethods.IsHead(m)) ? Gets : HttpMethods.IsPost(m) ? Posts : HttpMethods.IsDelete(m) ? Deletes : null) is { } table
                && table.TryGetValue(p, out var h))
            {
                try
                {
                    var cur = await Current();
                    if (cur is var (s, st) && (await SendKept(ctx, p, s, st) || await h(ctx, s, st))) return;
                }
                catch (Exception e) when (!ctx.Response.HasStarted) { await Server.Failed(ctx, "library", e); return; }
            }
            await next();
        });
    }

    // ---------------------------------------------------------------- answers

    private static readonly JsonSerializerOptions Out = Http.Relaxed;

    /* res.json, as Express sends it (Http.cs): its weak ETag, and "not modified" for a copy still current; kept when its route asked (LibraryRoutes.Kept.cs). */
    private static Task<bool> Send(HttpContext ctx, JsonNode body, int status = 200)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(body.ToJsonString(Out));
        var tag = Http.Tag(bytes);
        Keep(ctx, bytes, tag, status);
        return Http.Send(ctx, bytes, Http.JsonType, status, tag);
    }
    /*
     * GET /api/library/mark (v0.8.43): which albums there are, as the
     * X-Mandarin-Library header carries it on every answer. The page asks
     * when nothing else has been asked for a while, so a scan's albums still
     * reach a screen left alone.
     */
    private static Task<bool> Mark(HttpContext ctx, Snapshot s, LibState st) =>
        Send(ctx, new JsonObject { ["albums"] = s.AlbumSet });

    private static Task<bool> NotReady(HttpContext ctx) => Send(ctx, new JsonObject { ["error"] = "The library is still being scanned" }, 503);

    // req.query.x as String() makes it: undefined when absent, "a,b" when repeated.
    private static string? Q(HttpContext ctx, string name)
    {
        var v = Values(ctx, name);
        return v == null ? null : string.Join(",", v);
    }
    private static List<string>? Values(HttpContext ctx, string name)
    {
        var q = ctx.Request.Query;
        bool a = q.TryGetValue(name, out var x), b = q.TryGetValue(name + "[]", out var y);
        if (!a && !b) return null;
        var list = new List<string>();
        if (a) list.AddRange(x.Select(v => v ?? ""));
        if (b) list.AddRange(y.Select(v => v ?? ""));
        return list;
    }

    /* parseInt(s, 10), or null for NaN. */
    private static long? PInt(string? s)
    {
        if (s == null) return null;
        s = s.TrimStart();
        int i = 0;
        bool neg = false;
        if (i < s.Length && (s[i] == '+' || s[i] == '-')) { neg = s[i] == '-'; i++; }
        int start = i;
        while (i < s.Length && char.IsAsciiDigit(s[i])) i++;
        if (i == start) return null;
        var digits = s[start..i];
        if (digits.Length > 18) return neg ? long.MinValue : long.MaxValue;
        var r = long.Parse(digits, CultureInfo.InvariantCulture);
        return neg ? -r : r;
    }
    /* parseInt(s, 10) || d */
    private static long IntOr(string? s, long d) => PInt(s) is long v && v != 0 ? v : d;

    [GeneratedRegex(@"^[+-]?(?:Infinity|[0-9]+\.?[0-9]*(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?)\z")]
    private static partial Regex Decimal();
    /* Number(s) */
    public static double Num(string? s)
    {
        if (s == null) return double.NaN;
        s = Names.JsTrim(s);
        if (s.Length == 0) return 0;
        if (s.Length > 2 && s[0] == '0' && (s[1] | 0x20) is 'x' or 'o' or 'b')
        {
            int radix = (s[1] | 0x20) == 'x' ? 16 : (s[1] | 0x20) == 'o' ? 8 : 2;
            double v = 0;
            foreach (var c in s[2..])
            {
                int d = char.IsAsciiDigit(c) ? c - '0' : char.IsAsciiLetter(c) ? (c | 0x20) - 'a' + 10 : 99;
                if (d >= radix) return double.NaN;
                v = v * radix + d;
            }
            return v;
        }
        if (!Decimal().IsMatch(s)) return double.NaN;
        if (s.EndsWith("Infinity", StringComparison.Ordinal)) return s[0] == '-' ? double.NegativeInfinity : double.PositiveInfinity;
        return double.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture);
    }

    // ------------------------------------------------------------ an album

    private static (string? Quality, bool Hires) QualityOf(Album al)
    {
        if (!al.Lossless) return (al.Container, false);
        string? q = null;
        if (al.Bits != null && al.Rate != null) q = al.Bits + "/" + RateShort(al.Rate.Value);
        else if (al.Rate != null) q = RateShort(al.Rate.Value) + " kHz";
        return (q ?? al.Container, al.Bits > 16 || al.Rate > 48000);
    }

    /* library.json(al, extra): an album as every list shows it. */
    public static JsonObject AlbumJson(Snapshot s, Album al, JsonObject? extra = null)
    {
        var q = QualityOf(al);
        var o = new JsonObject { ["offset"] = al.Id, ["title"] = al.Title, ["subtitle"] = al.Artist, ["image_key"] = al.ImageKey, ["source"] = al.Service };
        if (al.Service != null) { var sid = AlbumIdOf(al.Key, al.Service); o["service_id"] = sid; o[al.Service + "_id"] = sid; }
        var marks = s.Marks;
        if (marks.Fav.ContainsKey(al.Key)) o["favourite"] = true;
        if (marks.Later.ContainsKey(al.Key)) o["later"] = true;
        if (!string.IsNullOrEmpty(q.Quality)) o["quality"] = q.Quality;
        if (q.Hires) o["hires"] = true;
        if (al.Year != null) o["year"] = al.Year;
        if (al.Discs > 1) o["discs"] = al.Discs;
        if (al.Box != null) o["box"] = new JsonObject { ["name"] = al.Box.Name, ["disc"] = al.Box.Disc, ["of"] = al.Box.Of };
        if (extra != null) foreach (var (k, v) in extra.ToList()) { extra.Remove(k); o[k] = v; }
        return o;
    }
    private static JsonArray AlbumList(Snapshot s, IEnumerable<Album> albums) => new(albums.Select(a => (JsonNode)AlbumJson(s, a)).ToArray());
}
