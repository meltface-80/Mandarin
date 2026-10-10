// LibraryRoutes.cs — the library's read routes (v0.8.4), from
// lib/server/api-library.js, in the same shapes. An album of a streaming
// service's still opens through the Node server (its page asks the service),
// as does anything asked of a Node server too old to say which copy it holds:
// a request this side can't answer exactly is passed on, never guessed at.
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Library
{
    private delegate Task<bool> Handler(HttpContext ctx, Snapshot s, LibState st);

    private static readonly Dictionary<string, Handler> Gets = new()
    {
        ["/api/library-stats"] = Stats,
        ["/api/library/albums"] = Albums,
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
        ["/api/album/booklets"] = AlbumBooklets,
        ["/api/booklet/page"] = BookletPage,
        ["/api/artist-bio"] = ArtistBio,
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
                try { await UnmergeLabel(ctx, source); return; }
                catch (Exception e) when (!ctx.Response.HasStarted) { Front.Log($"[library] unmerge: {e.GetType().Name}: {e.Message}; passed to the Node server"); }
            }
            // Backup & restore and built-in Tailscale (v0.8.22, AdminRoutes.cs): the library's copy not needed.
            if (await AdminRoute(ctx)) return;
            // Restart, Shut down and the processor split (v0.8.31, PowerRoutes.cs): nor here.
            if (await PowerRoute(ctx)) return;
            // Rescan, Reindex and the music folders (v0.8.34, ScanRoutes.cs), once the scans are made here.
            if (await ScanRoute(ctx)) return;
            // Qobuz's and Tidal's catalogue, read-only (v0.8.39, ServiceRoutes.cs), once the Node server has handed over its work.
            if (await ServiceRoute(ctx)) return;
            if (ctx.Request.Path.Value is { } p && ((HttpMethods.IsGet(m) || HttpMethods.IsHead(m)) ? Gets : HttpMethods.IsPost(m) ? Posts : HttpMethods.IsDelete(m) ? Deletes : null) is { } table
                && table.TryGetValue(p, out var h))
            {
                try
                {
                    var cur = await Current();
                    if (cur is var (s, st) && await h(ctx, s, st)) return;
                }
                catch (Exception e) when (!ctx.Response.HasStarted)
                {
                    Front.Log($"[library] {p}: {e.GetType().Name}: {e.Message}; passed to the Node server");
                }
            }
            await next();
        });
    }

    // ---------------------------------------------------------------- answers

    private static readonly JsonSerializerOptions Out = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /* res.json, as Express sends it: its weak ETag, and "not modified" for a copy still current. */
    private static async Task<bool> Send(HttpContext ctx, JsonNode body, int status = 200)
    {
        var bytes = Encoding.UTF8.GetBytes(body.ToJsonString(Out));
        var tag = "W/\"" + bytes.Length.ToString("x") + "-" + Convert.ToBase64String(SHA1.HashData(bytes))[..27] + "\"";
        var h = ctx.Response.Headers;
        h["X-Mandarin-Answered"] = "C#";
        h.ETag = tag;
        if (status == 200 && ctx.Request.Headers.IfNoneMatch.ToString().Contains(tag, StringComparison.Ordinal)) { ctx.Response.StatusCode = 304; return true; }
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        ctx.Response.ContentLength = bytes.Length;
        if (!HttpMethods.IsHead(ctx.Request.Method)) await ctx.Response.Body.WriteAsync(bytes);
        return true;
    }
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

    // ------------------------------------------------------------ the routes

    private static Task<bool> Stats(HttpContext ctx, Snapshot s, LibState st)
    {
        using var c = Db.Open();
        var tracks = (long)Rows(c, "SELECT COUNT(*) AS n FROM tracks")[0][0]!;
        return Send(ctx, new JsonObject { ["albums"] = s.Count, ["tracks"] = tracks, ["building"] = st.Building });
    }

    private static Task<bool> Albums(HttpContext ctx, Snapshot s, LibState st)
    {
        if (st.Building) return NotReady(ctx);
        var view = View(name => Values(ctx, name), s);
        int total = view.Count;
        var offset = (int)Math.Max(0, Math.Min(total, IntOr(Q(ctx, "offset") is { Length: > 0 } o ? o : "0", 0)));
        var count = (int)Math.Max(1, Math.Min(200, IntOr(Q(ctx, "count") is { Length: > 0 } n ? n : "60", 60)));
        return Send(ctx, new JsonObject
        {
            ["albums"] = AlbumList(s, view.Skip(offset).Take(count)),
            ["offset"] = offset, ["total"] = total
        });
    }

    private sealed record FacetDef(string Id, string Label, string? Sort, Func<string, string>? Labels, Func<Album, List<string>> Values);

    private static List<FacetDef> FacetDefs(Snapshot s)
    {
        var now = Now;
        var defs = new List<FacetDef>
        {
            new("genre", "Genre", null, null, al => al.Genres),
            new("decade", "Decade", "numeric-desc", v => v + "s",
                al => al.Year != null ? [((long)Math.Floor(al.Year.Value / 10.0) * 10).ToString(CultureInfo.InvariantCulture)] : []),
        };
        if (s.LabelsOn) defs.Add(new("label", "Record label", null, null, al => s.LabelOf(al) is { } l ? [l] : []));
        defs.Add(new("format", "Format", null, null, al => al.Container != null ? [al.Container] : []));
        defs.Add(new("rate", "Sample rate", "numeric-asc", v => (PInt(v) is long hz ? RateLabel(hz) : null) ?? v,
            al => al.Rate != null ? [al.Rate.Value.ToString(CultureInfo.InvariantCulture)] : []));
        defs.Add(new("bits", "Bit depth", "numeric-asc", v => v + "-bit",
            al => al.Bits != null ? [al.Bits.Value.ToString(CultureInfo.InvariantCulture)] : []));
        defs.Add(new("letter", "Starts with", null, null, al =>
        {
            if (al.SortTitle.Length == 0) return [];
            var c = al.SortTitle[..1].ToUpperInvariant();
            return [c.Any(ch => ch is >= 'A' and <= 'Z') ? c : "#"];
        }));
        defs.Add(new("added", "Added in the last", "none", v => AddedWindows.FirstOrDefault(w => w.Value == v).Label ?? v, al =>
        {
            if (al.Added == null) return [];
            var age = now - al.Added.Value;
            return AddedWindows.Where(w => age <= w.Days * Day).Select(w => w.Value).ToList();
        }));
        return defs;
    }

    /* parseFloat */
    private static double PFloat(string v)
    {
        var m = Regex.Match(Names.JsTrim(v), @"^[+-]?(?:Infinity|[0-9]+\.?[0-9]*(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?)");
        if (!m.Success) return double.NaN;
        if (m.Value.EndsWith("Infinity", StringComparison.Ordinal)) return m.Value[0] == '-' ? double.NegativeInfinity : double.PositiveInfinity;
        return double.Parse(m.Value, NumberStyles.Float, CultureInfo.InvariantCulture);
    }
    // a - b as a comparator gives it: NaN is "equal".
    private static int Diff(double a, double b) => double.IsNaN(a - b) ? 0 : Math.Sign(a - b);

    private static Task<bool> Facets(HttpContext ctx, Snapshot s, LibState st)
    {
        if (st.Building) return NotReady(ctx);
        var defs = FacetDefs(s);
        var counts = defs.Select(_ => (Order: new List<string>(), N: new Dictionary<string, int>())).ToList();
        foreach (var al in s.Albums)
            for (int i = 0; i < defs.Count; i++)
                foreach (var v in defs[i].Values(al))
                {
                    if (counts[i].N.TryGetValue(v, out var n)) counts[i].N[v] = n + 1;
                    else { counts[i].N[v] = 1; counts[i].Order.Add(v); }
                }
        var facets = new JsonArray();
        for (int i = 0; i < defs.Count; i++)
        {
            var def = defs[i];
            var m = counts[i].N;
            var values = counts[i].Order;
            values = def.Sort switch
            {
                "numeric-desc" => Sorted(values, (a, b) => Diff(PFloat(b), PFloat(a))),
                "numeric-asc" => Sorted(values, (a, b) => Diff(PFloat(a), PFloat(b))),
                "none" => AddedWindows.Select(w => w.Value).Where(m.ContainsKey).ToList(),
                _ => Sorted(values, (a, b) => Or(m[b] - m[a], () => Lc(a, b)))
            };
            if (values.Count == 0) continue;
            facets.Add(new JsonObject
            {
                ["id"] = def.Id, ["label"] = def.Label, ["total_values"] = values.Count,
                ["values"] = new JsonArray(values.Take(ChipMax).Select(v => (JsonNode)new JsonObject
                {
                    ["value"] = v, ["label"] = def.Labels != null ? def.Labels(v) : v, ["count"] = m[v]
                }).ToArray())
            });
        }
        int CountWith(string id) { var d = defs.First(x => x.Id == id); return s.Albums.Count(al => d.Values(al).Count > 0); }
        bool hasPlays = false;
        try { using var c = Db.Open(); hasPlays = Rows(c, "SELECT 1 FROM plays LIMIT 1").Count > 0; } catch (SqliteException) { /* no table yet */ }
        return Send(ctx, new JsonObject
        {
            ["total"] = s.Count,
            ["facets"] = facets,
            ["coverage"] = new JsonObject { ["decade"] = CountWith("decade"), ["genre"] = CountWith("genre"), ["format"] = CountWith("format"), ["added"] = CountWith("added") },
            ["sources_derived"] = false,
            ["played"] = new JsonArray(Played.Select(p => (JsonNode)p).ToArray()),
            ["hasPlays"] = hasPlays
        });
    }

    private static bool FacetMatch(List<string> selected, List<string> values)
    {
        bool wanted = false, sawInclude = false;
        foreach (var sel in selected)
        {
            if (sel.StartsWith('!')) { if (values.Contains(sel[1..])) return false; }
            else { sawInclude = true; if (values.Contains(sel)) wanted = true; }
        }
        return !sawInclude || wanted;
    }

    /* library.view(q): the Library wall, filtered and sorted. */
    private static List<Album> View(Func<string, List<string>?> ask, Snapshot s)
    {
        string? Q(HttpContext? _, string name) => ask(name) is { } v ? string.Join(",", v) : null;
        List<string>? Values(HttpContext? _, string name) => ask(name);
        HttpContext? ctx = null;
        var sortQ = Q(ctx, "sort") ?? "";
        var sort = Sorts.Contains(sortQ) ? sortQ : "album";
        var desc = (Q(ctx, "dir") is { Length: > 0 } d ? d : "asc") == "desc";
        var seed = IntOr(Q(ctx, "seed"), 1);
        var played = Q(ctx, "played") is { Length: > 0 } pl ? pl : "any";
        var defs = FacetDefs(s);
        var picked = defs.Select(def => (Def: def, Sel: (Values(ctx, def.Id) ?? []).Where(v => v.Length > 0).ToList())).Where(x => x.Sel.Count > 0).ToList();
        var prefix = Names.Fold(Q(ctx, "prefix") ?? "");
        if (prefix.Length > 40) prefix = prefix[..40];
        var sig = string.Join("|", new[] { sort, desc ? "1" : "0", seed.ToString(CultureInfo.InvariantCulture), played, prefix }
            .Concat(picked.Select(x => x.Def.Id + "=" + string.Join(",", x.Sel.OrderBy(v => v, StringComparer.Ordinal)))));
        var usesPlays = played != "any" || sort == "plays" || sort == "lastplayed";
        if (!usesPlays && prefix.Length == 0) lock (s.ViewCache) if (s.ViewCache.TryGetValue(sig, out var hit)) return hit;

        IEnumerable<Album> list = s.Albums;
        foreach (var (def, sel) in picked) list = list.Where(al => FacetMatch(sel, def.Values(al))).ToList();
        if (prefix.Length > 0)
            list = list.Where(al => al.SortTitle.StartsWith(prefix, StringComparison.Ordinal) || al.NTitle.StartsWith(prefix, StringComparison.Ordinal) ||
                al.NArtist.StartsWith(prefix, StringComparison.Ordinal) || al.ArtistNames.Any(a => a.N.StartsWith(prefix, StringComparison.Ordinal))).ToList();
        using var c = (played != "any" || sort is "plays" or "lastplayed") ? Db.Open() : null;
        if (played != "any")
        {
            var months = PInt(played);
            double since = played is "never" or "played" ? 0
                : Now - (months is long mo && mo > 0 ? mo : 6) * 30.0 * Day;
            var seen = new HashSet<long>(Rows(c!, "SELECT DISTINCT album_id FROM plays WHERE ts >= $1 AND album_id IS NOT NULL", since).Select(r => (long)r[0]!));
            var want = played == "played";
            list = list.Where(al => seen.Contains(al.Id) == want).ToList();
        }
        Dictionary<long, (long N, long T)>? stats = null;
        if (sort is "plays" or "lastplayed")
        {
            stats = [];
            foreach (var r in Rows(c!, "SELECT album_id, COUNT(*) AS n, MAX(ts) AS t FROM plays WHERE album_id IS NOT NULL GROUP BY album_id"))
                stats[(long)r[0]!] = ((long)r[1]!, Convert.ToInt64(r[2] ?? 0L, CultureInfo.InvariantCulture));
        }
        var useed = ToUint32(seed);
        Comparison<Album> cmp = sort switch
        {
            "artist" => (a, b) => Or(Kc(a.SortArtistKey, b.SortArtistKey), () => Or(Math.Sign((a.Year ?? 0) - (b.Year ?? 0)), () => Kc(a.SortTitleKey, b.SortTitleKey))),
            "year" => (a, b) => Or(Math.Sign(string.CompareOrdinal(a.DateKey, b.DateKey)), () => Kc(a.SortTitleKey, b.SortTitleKey)),
            "added" => (a, b) => Or(Math.Sign(a.Added!.Value - b.Added!.Value), () => Kc(a.SortTitleKey, b.SortTitleKey)),
            "plays" => (a, b) => Or(Math.Sign((stats!.TryGetValue(a.Id, out var x) ? x.N : 0) - (stats.TryGetValue(b.Id, out var y) ? y.N : 0)), () => Kc(a.SortTitleKey, b.SortTitleKey)),
            "lastplayed" => (a, b) => Or(Math.Sign((stats!.TryGetValue(a.Id, out var x) ? x.T : 0) - (stats.TryGetValue(b.Id, out var y) ? y.T : 0)), () => Kc(a.SortTitleKey, b.SortTitleKey)),
            "random" => (a, b) => Math.Sign((long)SeededRank(a.NTitle + a.NArtist, useed) - SeededRank(b.NTitle + b.NArtist, useed)),
            _ => (a, b) => Or(Kc(a.SortTitleKey, b.SortTitleKey), () => Kc(a.NArtistKey, b.NArtistKey)),
        };
        List<Album> outList;
        if (sort is "year" or "added")
        {
            var known = new List<Album>();
            var unknown = new List<Album>();
            foreach (var al in list) ((sort == "year" ? al.Year != null : al.Added != null) ? known : unknown).Add(al);
            known = Sorted(known, cmp);
            if (desc) known.Reverse();
            outList = Sorted(unknown, (a, b) => Kc(a.SortTitleKey, b.SortTitleKey));
            outList.InsertRange(0, known);
        }
        else
        {
            outList = Sorted(list, cmp);
            if (desc) outList.Reverse();
        }
        if (!usesPlays && prefix.Length == 0)
            lock (s.ViewCache)
            {
                if (s.ViewCache.Count > 64) s.ViewCache.Remove(s.ViewCache.Keys.First());
                s.ViewCache[sig] = outList;
            }
        return outList;
    }

    private static Task<bool> RandomAlbums(HttpContext ctx, Snapshot s, LibState st)
    {
        if (st.Building) return NotReady(ctx);
        var count = (int)Math.Max(1, Math.Min(96, IntOr(Q(ctx, "count") is { Length: > 0 } cq ? cq : "30", 30)));
        // parseFilter: a genre, tag or decade, and its value.
        var ftype = Names.JsTrim(Q(ctx, "filter_type") ?? "");
        var fvalue = Names.JsTrim(Q(ctx, "filter_value") ?? "");
        bool filtered = ftype.Length > 0 && fvalue.Length > 0 && ftype is "genre" or "tag" or "decade";
        long? seed = Q(ctx, "seed") is { } sq ? PInt(sq) : null;
        List<Album> pool = s.Albums;
        if (filtered)
        {
            var v = Names.Fold(fvalue);
            if (ftype == "genre") pool = s.Albums.Where(al => al.Genres.Any(g => Names.Fold(g) == v)).ToList();
            else if (ftype == "decade")
            {
                var dd = PInt(fvalue);
                pool = dd is long dec ? s.Albums.Where(al => al.Year != null && al.Year >= dec && al.Year < dec + 10).ToList() : [];
            }
            else pool = [];
        }
        int n = Math.Min(count, pool.Count);
        List<Album> albums;
        if (seed is long sd)
        {
            var us = ToUint32(sd);
            albums = Sorted(pool, (a, b) => Math.Sign((long)SeededRank(a.NTitle + a.NArtist, us) - SeededRank(b.NTitle + b.NArtist, us))).Take(n).ToList();
        }
        else
        {
            var chosen = new List<int>();
            var seen = new HashSet<int>();
            while (chosen.Count < n) { var i = Random.Shared.Next(pool.Count); if (seen.Add(i)) chosen.Add(i); }
            albums = chosen.Select(i => pool[i]).ToList();
        }
        return Send(ctx, new JsonObject { ["albums"] = AlbumList(s, albums), ["total"] = pool.Count, ["filtered"] = filtered });
    }

    private sealed record TrackRow(long Id, string Title, string Artist, long? Disc, long? No, double Duration, bool Lossless, long? Bits, long? Rate, string NamesFrom);

    /* library.tracks(id): in playing order, corrected titles laid over the tagged ones. */
    private static List<TrackRow> Tracks(SqliteConnection c, Snapshot s, Album al)
    {
        const string sql = "SELECT * FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path";
        var col = Columns(c, sql, al.Id);
        object? F(object?[] r, string name) => col.TryGetValue(name, out var i) ? r[i] : null;
        s.TrackEdits.TryGetValue(al.Key, out var edits);
        var rows = Rows(c, sql, al.Id);
        var list = new List<TrackRow>(rows.Count);
        for (int i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var disc = Long(F(r, "disc_no"));
            var no = Long(F(r, "track_no"));
            var title = Convert.ToString(F(r, "title"), CultureInfo.InvariantCulture) ?? "";
            if (edits != null && edits.TryGetValue($"{disc ?? 1}-{(no != null ? no.Value.ToString(CultureInfo.InvariantCulture) : "p" + (i + 1))}", out var t) && t.Length > 0) title = t;
            list.Add(new TrackRow((long)F(r, "id")!, title, Text(F(r, "artist")) ?? "", disc, no,
                F(r, "duration") is { } du ? Convert.ToDouble(du, CultureInfo.InvariantCulture) : 0, Truthy(F(r, "lossless")),
                Long(F(r, "bits")), Long(F(r, "sample_rate")), Text(F(r, "names_from")) ?? ""));
        }
        return list;
    }

    private static long JsRound(double x) => (long)Math.Floor(x + 0.5);
    private static string FmtLen(double sec)
    {
        var n = Math.Max(0, JsRound(double.IsNaN(sec) ? 0 : sec));
        if (n == 0) return "";
        return $"{n / 60}:{(n % 60).ToString(CultureInfo.InvariantCulture).PadLeft(2, '0')}";
    }

    [GeneratedRegex(@"(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))(artist|album)(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))")]
    private static partial Regex NamesFromFolders();

    private static Task<bool> AlbumPage(HttpContext ctx, Snapshot s, LibState st)
    {
        var al = s.Find(Num(Q(ctx, "offset")));
        if (al == null) return Send(ctx, new JsonObject { ["error"] = "That album is no longer in the library — rescan to refresh" }, 409);
        // A streamed album's page asks the service too: the Node server's.
        if (al.Service != null) return Task.FromResult(false);
        using var c = Db.Open();
        var tracks = Tracks(c, s, al);
        var discs = tracks.Select(t => t.Disc ?? 1).Distinct().Count();
        var albumKey = Names.ArtistKey(al.Artist);
        var rows = new JsonArray(tracks.Select(t =>
        {
            var disc = discs > 1 ? $"Disc {t.Disc ?? 1}" : "";
            var credit = t.Artist.Length > 0 && Names.ArtistKey(t.Artist) != albumKey ? t.Artist : "";
            string? fmt = null;
            if (t.Lossless && t.Bits != null && t.Rate != null) fmt = $"{t.Bits}/{RateShort(t.Rate.Value)}";
            var row = new JsonObject
            {
                ["title"] = t.Title,
                ["subtitle"] = string.Join(" · ", new[] { credit, disc, FmtLen(t.Duration) }.Where(x => x.Length > 0)),
                ["length"] = JsRound(t.Duration),
                ["track_id"] = t.Id,
                ["quality"] = fmt
            };
            // A set's tracks say which disc, as a number (v0.8.27: Shelf's back of the case heads each disc).
            if (discs > 1) row["disc"] = t.Disc is long d && d != 0 ? d : 1;
            return (JsonNode)row;
        }).ToArray());
        var album = AlbumJson(s, al);
        album["year"] = al.Year;
        album["genres"] = new JsonArray(al.Genres.Select(g => (JsonNode)g).ToArray());
        if (s.LabelOf(al) is { } label) album["label"] = label;
        var boxAlbums = new JsonArray();
        if (al.Box != null)
            foreach (var id in al.Box.Ids)
                if (id != al.Id && s.ById.TryGetValue(id, out var x))
                    boxAlbums.Add(AlbumJson(s, x, new JsonObject { ["disc"] = x.Box?.Disc }));
        return Send(ctx, new JsonObject
        {
            ["album"] = album,
            ["tracks"] = rows,
            ["actions"] = new JsonArray(
                new JsonObject { ["kind"] = "play_now", ["title"] = "Play Now" },
                new JsonObject { ["kind"] = "queue", ["title"] = "Queue" },
                new JsonObject { ["kind"] = "play_next", ["title"] = "Play Next" },
                new JsonObject { ["kind"] = "shuffle", ["title"] = "Shuffle" },
                new JsonObject { ["kind"] = "radio", ["title"] = "Start Radio" }),
            ["offset"] = al.Id,
            ["artists"] = new JsonArray((al.Compilation ? [al.Artist] : Names.SplitArtists(al.Artist)).Select(a => (JsonNode)a).ToArray()),
            ["library_moved"] = false,
            ["partial"] = false,
            ["names_from_folders"] = !al.Edited && tracks.Any(t => NamesFromFolders().IsMatch(t.NamesFrom)),
            ["box_albums"] = boxAlbums,
            ["declared_tracks"] = tracks.Count
        });
    }

    // ----------------------------------------------------------------- search

    private static int ConsecutivePrefixStart(string[] tokens, string[] q)
    {
        int last = tokens.Length - q.Length;
        for (int i = 0; i <= last; i++)
        {
            bool ok = true;
            for (int k = 0; k < q.Length; k++) if (!tokens[i + k].StartsWith(q[k], StringComparison.Ordinal)) { ok = false; break; }
            if (ok) return i;
        }
        return -1;
    }
    private static bool AllTokensPrefixSomewhere(string[] tokens, string[] q)
    {
        var used = new bool[tokens.Length];
        foreach (var qt in q)
        {
            bool found = false;
            for (int i = 0; i < tokens.Length; i++)
                if (!used[i] && tokens[i].StartsWith(qt, StringComparison.Ordinal)) { used[i] = true; found = true; break; }
            if (!found) return false;
        }
        return true;
    }
    private static bool IsSubsequence(string q, string s)
    {
        int i = 0;
        for (int j = 0; j < s.Length && i < q.Length; j++) if (s[j] == q[i]) i++;
        return i == q.Length;
    }

    private static int ScoreAlbum(Album al, string q, string[] qt, string qj, bool single)
    {
        int s = 0;
        if (al.NTitle == q) return 1000;
        if (al.NTitle.StartsWith(q, StringComparison.Ordinal)) s = Math.Max(s, 920 - Math.Min(al.NTitle.Length - q.Length, 60));
        {
            var start = ConsecutivePrefixStart(al.TTitle, qt);
            if (start == 0) s = Math.Max(s, 900 - Math.Min(al.TTitle.Length, 40));
            else if (start > 0 && !single) s = Math.Max(s, 820 - start * 4);
        }
        if (al.JTitle.StartsWith(qj, StringComparison.Ordinal)) s = Math.Max(s, 870 - Math.Min(al.JTitle.Length - qj.Length, 60));
        if (!single)
        {
            if (s < 760 && qt.Length > 1 && AllTokensPrefixSomewhere(al.TTitle, qt)) s = Math.Max(s, 760);
            if (s < 650 && al.NTitle.Contains(q, StringComparison.Ordinal)) s = Math.Max(s, 650 - Math.Min(al.NTitle.IndexOf(q, StringComparison.Ordinal), 40));
            if (s < 700 && qt.Length > 1 && AllTokensPrefixSomewhere([.. al.TTitle, .. al.TArtist], qt)) s = Math.Max(s, 700);
        }
        if (al.NArtist.Length > 0)
        {
            if (al.NArtist == q) s = Math.Max(s, 770);
            if (al.NArtist.StartsWith(q, StringComparison.Ordinal)) s = Math.Max(s, 740 - Math.Min(al.NArtist.Length - q.Length, 60));
            {
                var start = ConsecutivePrefixStart(al.TArtist, qt);
                if (start == 0) s = Math.Max(s, 720 - Math.Min(al.TArtist.Length, 40));
                else if (start > 0 && !single) s = Math.Max(s, 660 - start * 4);
            }
            if (al.JArtist.StartsWith(qj, StringComparison.Ordinal)) s = Math.Max(s, 700 - Math.Min(al.JArtist.Length - qj.Length, 60));
            if (!single)
            {
                if (s < 600 && qt.Length > 1 && AllTokensPrefixSomewhere(al.TArtist, qt)) s = Math.Max(s, 600);
                if (s < 520 && al.NArtist.Contains(q, StringComparison.Ordinal)) s = Math.Max(s, 520 - Math.Min(al.NArtist.IndexOf(q, StringComparison.Ordinal), 40));
            }
        }
        if (s == 0 && !single && qj.Length >= 4)
        {
            if (IsSubsequence(qj, al.JTitle)) s = 300;
            else if (IsSubsequence(qj, al.JArtist)) s = 260;
        }
        return s;
    }

    /* library.search(query, limit): the albums whose names hold the words, best first. */
    private static List<(Album Al, int Score)> SearchHits(Snapshot s, string raw, int limit)
    {
        var q = Names.Fold(raw);
        if (q.Length == 0) return [];
        var qt = q.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var qj = q.Replace(" ", "");
        var single = qj.Length <= 1;
        var hits = new List<(Album Al, int Score)>();
        foreach (var al in s.Albums) { var sc = ScoreAlbum(al, q, qt, qj, single); if (sc > 0) hits.Add((al, sc)); }
        hits = Sorted(hits, (a, b) => Or(b.Score - a.Score, () => Or(Lc(a.Al.NTitle, b.Al.NTitle), () => Kc(a.Al.NArtistKey, b.Al.NArtistKey))));
        return hits.Take(limit).ToList();
    }

    private static Task<bool> Search(HttpContext ctx, Snapshot s, LibState st)
    {
        var raw = Q(ctx, "q") ?? "";
        var limit = (int)Math.Max(1, Math.Min(100, IntOr(Q(ctx, "limit") is { Length: > 0 } l ? l : "60", 60)));
        if (Names.JsTrim(raw).Length == 0)
            return Send(ctx, new JsonObject { ["query"] = raw, ["results"] = new JsonArray(), ["artists"] = new JsonArray(), ["labels"] = new JsonArray(), ["indexed"] = s.Count });
        if (st.Building)
            return Send(ctx, new JsonObject { ["query"] = raw, ["results"] = new JsonArray(), ["artists"] = new JsonArray(), ["labels"] = new JsonArray(), ["building"] = true, ["progress"] = st.Progress?.DeepClone() });

        var q = Names.Fold(raw);
        var results = new JsonArray();
        foreach (var h in SearchHits(s, raw, limit)) results.Add(AlbumJson(s, h.Al, new JsonObject { ["score"] = h.Score }));

        // Labels (only while they're on) and artists whose names hold the words.
        var labels = new JsonArray();
        if (s.LabelsOn && q.Length > 0)
        {
            var qn = q.Replace(" ", "");
            var found = new List<(string Display, int Count, string N)>();
            foreach (var g in s.LabelGroups.Values)
            {
                var n = Names.Fold(g.Title);
                var merged = g.MergedFrom.Any(x => Names.Fold(x.Display).Contains(q, StringComparison.Ordinal));
                if (n.Contains(q, StringComparison.Ordinal) || g.Key.Contains(qn, StringComparison.Ordinal) || merged) found.Add((g.Title, g.Albums.Count, n));
            }
            foreach (var x in Sorted(found, (a, b) => Or((a.N.StartsWith(q, StringComparison.Ordinal) ? 0 : 1) - (b.N.StartsWith(q, StringComparison.Ordinal) ? 0 : 1), () => b.Count - a.Count)).Take(10))
                labels.Add(new JsonObject { ["display"] = x.Display, ["albumCount"] = x.Count, ["logo_url"] = null });
        }
        var artists = new JsonArray();
        if (q.Length > 0)
        {
            var seen = new Dictionary<string, (string Name, int Count)>();
            var order = new List<string>();
            foreach (var al in s.Albums)
                foreach (var (name, n) in al.ArtistNames)
                {
                    if (!n.Contains(q, StringComparison.Ordinal)) continue;
                    if (seen.TryGetValue(n, out var e)) seen[n] = (e.Name, e.Count + 1);
                    else { seen[n] = (name, 1); order.Add(n); }
                }
            foreach (var n in Sorted(order, (a, b) => Or((a.StartsWith(q, StringComparison.Ordinal) ? 0 : 1) - (b.StartsWith(q, StringComparison.Ordinal) ? 0 : 1), () => seen[b].Count - seen[a].Count)).Take(8))
                artists.Add(new JsonObject { ["name"] = seen[n].Name, ["n"] = n, ["count"] = seen[n].Count, ["albumCount"] = seen[n].Count });
        }
        return Send(ctx, new JsonObject { ["query"] = raw, ["count"] = results.Count, ["indexed"] = s.Count, ["results"] = results, ["labels"] = labels, ["artists"] = artists });
    }

    // ---------------------------------------------------------------- artists

    private static Task<bool> Artists(HttpContext ctx, Snapshot s, LibState st)
    {
        var sort = Q(ctx, "sort") is { Length: > 0 } so ? so : "az";
        var seed = ToUint32(IntOr(Q(ctx, "seed"), 1));
        var m = new Dictionary<string, (string Name, int Count, string Image, string SortName)>();
        var order = new List<string>();
        foreach (var al in s.Albums)
        {
            if (al.Compilation) continue;
            foreach (var (name, n) in al.ArtistNames)
            {
                if (m.TryGetValue(n, out var e)) m[n] = (e.Name, e.Count + 1, e.Image, e.SortName);
                else { m[n] = (name, 1, al.ImageKey, Names.SortName(name)); order.Add(n); }
            }
        }
        var keys = sort == "random" ? null : order.ToDictionary(n => n, n => SortKey(m[n].SortName));
        var list = sort switch
        {
            "random" => Sorted(order, (a, b) => Math.Sign((long)SeededRank(a, seed) - SeededRank(b, seed))),
            "albums" => Sorted(order, (a, b) => Or(m[b].Count - m[a].Count, () => Kc(keys![a], keys[b]))),
            _ => Sorted(order, (a, b) => Kc(keys![a], keys[b])),
        };
        var offset = (int)Math.Min(int.MaxValue, Math.Max(0, IntOr(Q(ctx, "offset"), 0)));
        var limit = (int)Math.Max(1, Math.Min(500, IntOr(Q(ctx, "limit"), 120)));
        return Send(ctx, new JsonObject
        {
            ["artists"] = new JsonArray(list.Skip(offset).Take(limit).Select(n => (JsonNode)new JsonObject { ["name"] = m[n].Name, ["albumCount"] = m[n].Count, ["image_key"] = m[n].Image }).ToArray()),
            ["offset"] = offset, ["total"] = list.Count
        });
    }

    [GeneratedRegex(@"^the\s+", RegexOptions.IgnoreCase)] private static partial Regex ThePrefix();

    private static Task<bool> ArtistAlbums(HttpContext ctx, Snapshot s, LibState st)
    {
        var artist = Names.JsTrim(Q(ctx, "artist") ?? "");
        if (artist.Length == 0) return Send(ctx, new JsonObject { ["error"] = "artist required" }, 400);
        var (primary, featured) = ArtistAlbumsOf(s, artist);
        return Send(ctx, new JsonObject { ["artist"] = artist, ["primary"] = AlbumList(s, primary), ["featured"] = AlbumList(s, featured) });
    }

    /* library.artistAlbums(name): the albums credited to the act first, then those it is on (Last.fm's tiles too, LastfmRoutes.cs). */
    private static (List<Album> Primary, List<Album> Featured) ArtistAlbumsOf(Snapshot s, string artist)
    {
        var q = Names.ArtistKey(artist);
        var primary = new List<Album>();
        var featured = new List<Album>();
        if (q.Length > 0)
        {
            foreach (var al in s.Albums)
            {
                var whole = Names.ArtistKey(al.Artist);
                var names = al.ArtistNames.Select(x => Names.ArtistKey(x.Name)).ToList();
                if (whole != q && !names.Contains(q)) continue;
                if (whole == q || names[0] == q) primary.Add(al); else featured.Add(al);
            }
            // A track credit on an album credited to someone else.
            using var c = Db.Open();
            foreach (var r in Rows(c, "SELECT DISTINCT album_id FROM tracks WHERE lower(artist) IN (lower($1), lower($2), lower($3)) LIMIT 200",
                         artist, ThePrefix().Replace(artist, "", 1), TheStart().IsMatch(artist) ? artist : "The " + artist))
                if (s.ById.TryGetValue((long)r[0]!, out var al) && !primary.Contains(al) && !featured.Contains(al)) featured.Add(al);
            int ByYear(Album a, Album b) => Or(Math.Sign((a.Year ?? 9999) - (b.Year ?? 9999)), () => Kc(a.SortTitleKey, b.SortTitleKey));
            primary = Sorted(primary, ByYear);
            featured = Sorted(featured, ByYear);
        }
        return (primary, featured);
    }

    // ------------------------------------------------------- genres, decades

    private static List<(string Title, int Count)> GenreCounts(Snapshot s)
    {
        var m = new Dictionary<string, int>();
        var order = new List<string>();
        foreach (var al in s.Albums)
            foreach (var g in al.Genres)
                if (m.TryGetValue(g, out var n)) m[g] = n + 1; else { m[g] = 1; order.Add(g); }
        return Sorted(order, (a, b) => m[b] - m[a]).Select(g => (g, m[g])).ToList();
    }
    private static string AlbumsWord(int n) => n.ToString("N0", CultureInfo.InvariantCulture) + (n == 1 ? " album" : " albums");

    private static Task<bool> GenresRoute(HttpContext ctx, Snapshot s, LibState st) =>
        Send(ctx, new JsonObject { ["genres"] = new JsonArray(GenreCounts(s).Select(g => (JsonNode)new JsonObject { ["title"] = g.Title, ["subtitle"] = AlbumsWord(g.Count) }).ToArray()) });

    private static Task<bool> DecadesRoute(HttpContext ctx, Snapshot s, LibState st)
    {
        if (st.Building) return NotReady(ctx);
        var m = new Dictionary<long, int>();
        var order = new List<long>();
        foreach (var al in s.Albums)
        {
            if (al.Year == null) continue;
            var d = (long)Math.Floor(al.Year.Value / 10.0) * 10;
            if (m.TryGetValue(d, out var n)) m[d] = n + 1; else { m[d] = 1; order.Add(d); }
        }
        return Send(ctx, new JsonObject
        {
            ["decades"] = new JsonArray(Sorted(order, (a, b) => Math.Sign(b - a)).Select(d => (JsonNode)new JsonObject { ["title"] = d + "s", ["subtitle"] = AlbumsWord(m[d]) }).ToArray())
        });
    }

    [GeneratedRegex(@"(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))pop(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))", RegexOptions.IgnoreCase)]
    private static partial Regex PopWord();
    private const string WB = @"(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))";
    [GeneratedRegex(WB + @"(soft\s*rock|folk[\s-]?rock|country[\s-]?rock|adult\s*contemporary|easy\s*listening|singer[\s/-]*songwriter|new\s*age|lounge|smooth\s*jazz|yacht\s*rock)" + WB, RegexOptions.IgnoreCase)]
    private static partial Regex Soft();
    [GeneratedRegex(WB + @"(metal|metalcore|thrash|sludge|doom|hard\s*rock|album\s*rock|classic\s*rock|blues[\s-]?rock|southern\s*rock|stoner|post[\s-]?rock|prog|art\s*rock|krautrock|psychedel|britpop|grunge|punk|hardcore|emo|shoegaze|indie|alternative|garage|rockabilly|surf|glam|goth|industrial|ska|rock)" + WB, RegexOptions.IgnoreCase)]
    private static partial Regex Hard();
    [GeneratedRegex(WB + @"(pop|dance|disco|synth|new\s*wave|electropop|r&b|rhythm\s*&\s*blues|soul|motown|funk)" + WB, RegexOptions.IgnoreCase)]
    private static partial Regex PopFamily();

    /* Home's "Browse by genre": Pop, and Rock/Metal. */
    private static Task<bool> GenreGroups(HttpContext ctx, Snapshot s, LibState st)
    {
        var pop = new JsonArray();
        var rock = new JsonArray();
        foreach (var (title, count) in GenreCounts(s))
        {
            JsonNode entry = new JsonObject { ["title"] = title, ["count"] = count };
            if (PopWord().IsMatch(title)) pop.Add(entry);
            else if (Soft().IsMatch(title)) continue;
            else if (Hard().IsMatch(title)) rock.Add(entry);
            else if (PopFamily().IsMatch(title)) pop.Add(entry);
        }
        return Send(ctx, new JsonObject { ["parent"] = null, ["pop"] = pop, ["rockmetal"] = rock, ["flat"] = true });
    }

    // ------------------------------------------------- hearts, Listen later

    private static Task<bool> Favourites(HttpContext ctx, Snapshot s, LibState st) => Marked(ctx, s, s.Marks.Fav);
    private static Task<bool> ListenLater(HttpContext ctx, Snapshot s, LibState st) => Marked(ctx, s, s.Marks.Later);
    /* Newest first. */
    private static Task<bool> Marked(HttpContext ctx, Snapshot s, Dictionary<string, long> keys) =>
        Send(ctx, new JsonObject { ["albums"] = AlbumList(s, Sorted(s.Albums.Where(al => keys.ContainsKey(al.Key)), (a, b) => Math.Sign(keys[b.Key] - keys[a.Key]))) });
}
