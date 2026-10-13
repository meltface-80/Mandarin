// ServiceRoutes.cs — Qobuz's and Tidal's catalogue, as the page and the apps
// browse it (v0.8.39, stage 4.1 of docs/specs/csharp-migration.md), from
// lib/server/api-service.js in the same shapes and words (Services/):
//
//   GET /api/<s>/lists              the lists the service features (Tidal), the browser's tabs
//   GET /api/<s>/new-releases?days  GET /api/<s>/featured?type=…
//   GET /api/<s>/search?q&offset    GET /api/<s>/artist-albums?artist_id&offset
//   GET /api/<s>/album?id           the album and its tracks
//   GET /api/<s>/state?album_id     whether it is in the account's favourites
//
// and from v0.8.44 (stage 4.2) the library's rows of them (Services/Rows.cs):
//
//   POST /api/<s>/open { album_id } → { ok, offset, album }: the album's page here
//   POST /api/<s>/favorite { album_id } · /unfavorite → { ok, album_id, favourite }:
//                                   on the service, and kept in (or let go from) the library
//   POST /api/library/cleanup { kind: "qobuz" | "tidal" }: the albums no longer wanted
//                                   (where the scans are this server's, Scans.cs)
//
// A streamed album's page (GET /api/album) is LibraryRoutes.cs's, with its
// service's favourite and why it is here (ServiceFields, below).
//
// From v0.8.45 (stage 4.3) the import, the favourites' watch and the service
// playlists (Services/Import.cs), once the Node server has handed them over
// (the job "import"):
//
//   GET  /api/settings/<s>          the account's state and settings, the import's (signed in)
//   POST /api/settings/<s>          { quality?, import? } (signed in): the switch on, the import made
//   POST /api/settings/<s>/import   Update library now: what it made
//   POST /api/services/watch        the favourites looked at now (the page, coming back)
//
// and from v0.8.47 (stage 4.4) the accounts, once the Node server has handed
// over the services too (the job "services"; Services/Accounts.cs):
//
//   GET  /api/settings/<s>          signed out too, a Tidal sign-in under way among it
//   POST /api/settings/<s>          signed out too
//   POST /api/settings/<s>/signin   Qobuz: { username, password } → signed in (the password not kept);
//                                   Tidal: → { pending: { url, code } }, the sign-in on tidal.com
//   POST /api/settings/<s>/signin/cancel   Tidal: the link and code let go
//   POST /api/settings/<s>/signout · /disconnect
//   POST /api/<s>/play { album_id, zone_or_output_id, kind, track? }: the album's rows
//                                   written, then its tracks played by the Node server
//                                   (POST /internal/playback/play; playback is its until stage 6)
//
// and the services' part of the search from Home (GET /api/search/external).
// Tidal's token is this server's alone to refresh (TidalApi.cs), and a
// service's streams are made here too (Streams.cs): once the services are
// handed over, the Node server asks Qobuz and Tidal nothing in the ordinary way
// of things. Before then (its first seconds) it makes them as it always did;
// and a body Express would read otherwise, or refuse, is passed on as it came,
// to be answered there (a request the page never makes).
// Answered here once the Node server has handed over its work; until then, by it.
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Mandarin.Server.Services;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;
using SH = Mandarin.Server.Services.ServiceHttp;

internal static partial class Library
{
    [GeneratedRegex(@"^/api/(qobuz|tidal)/(lists|new-releases|featured|search|artist-albums|album|state)$")]
    private static partial Regex ServicePath();

    private static Catalogue? CatalogueOf(string id) => !Jobs.Held ? null : id == "qobuz" ? Jobs.Qobuz : id == "tidal" ? Jobs.Tidal : null;

    private static JsObj Assigned(JsObj first, JsObj rest)
    {
        foreach (var k in rest.Keys) first[k] = rest[k];
        return first;
    }
    private static JsObj Jso(params (string Key, object? Value)[] kv)
    {
        var o = new JsObj();
        foreach (var (k, v) in kv) o[k] = v;
        return o;
    }

    /* The catalogue's routes: true when answered here. */
    private static async Task<bool> ServiceRoute(HttpContext ctx)
    {
        var m = ctx.Request.Method;
        if (!HttpMethods.IsGet(m) && !HttpMethods.IsHead(m)) return false;
        var match = ServicePath().Match(ctx.Request.Path.Value ?? "");
        if (!match.Success || CatalogueOf(match.Groups[1].Value) is not { } svc) return false;
        var what = match.Groups[2].Value;
        try
        {
            if (!svc.Connected()) return await SendJs(ctx, Jso(("error", "Not signed in to " + svc.Name), ("connected", false)), 401);
            // The favourites a minute old at most, and never from before the Node server's library last changed.
            var ask = new Ask((await State())?.Version);
            var offset = Math.Max(0, SH.NumOr(Num(Q(ctx, "offset")), 0));
            switch (what)
            {
                case "lists":
                    if (svc.Lists(ask) is not { } lists) return await JsError(ctx, 404, svc.Name + " has no lists");
                    return await SendJs(ctx, Jso(("connected", true), ("lists", await lists)));
                case "new-releases":
                    var days = Math.Max(1, Math.Min(90, SH.NumOr(Num(Q(ctx, "days")), 30)));
                    return await SendJs(ctx, Jso(("connected", true), ("days", days), ("albums", await svc.NewReleases(days, ask))));
                case "featured":
                    return await SendJs(ctx, Jso(("connected", true), ("albums", await svc.Featured(Q(ctx, "type") ?? "", ask))));
                case "search":
                    var query = Names.JsTrim(Q(ctx, "q") ?? "");
                    if (query.Length == 0) return await SendJs(ctx, Jso(("connected", true), ("albums", new List<object?>()), ("artists", new List<object?>()), ("total", 0.0), ("has_more", false)));
                    return await SendJs(ctx, Assigned(Jso(("connected", true)), await svc.Search(query, offset, ask)));
                case "artist-albums":
                    if (Q(ctx, "artist_id") is not { Length: > 0 } artist) return await JsError(ctx, 400, "artist_id required");
                    return await SendJs(ctx, Assigned(Jso(("connected", true)), await svc.ArtistAlbums(artist, offset, ask)));
                case "album":
                    if (Q(ctx, "id") is not { Length: > 0 } id) return await JsError(ctx, 400, "id required");
                    var d = await svc.AlbumDetail(id, ask);
                    var row = svc.AlbumRow(TJs.Str(SH.P(d["album"], "id")));
                    return await SendJs(ctx, Assigned(Jso(("connected", true), ("offset", row is long r ? (double)r : null)), d));
                default:
                    if (Q(ctx, "album_id") is not { Length: > 0 } albumId) return await JsError(ctx, 400, "album_id required");
                    return await SendJs(ctx, Jso(("connected", true), ("favourite", await svc.IsFavourite(albumId, ask))));
            }
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            // Answered here whatever it is: passed on, the Node server would ask the service itself.
            if (e is not (ServiceError or Tags.JsError)) Front.Log($"[{svc.Id}] {ctx.Request.Path}: {e.GetType().Name}: {e.Message}");
            return await ImportFailed(ctx, e);
        }
    }

    /* As api-service.js's wrap answers what throws: e.status (500 when none), its message; a 401 says signed out. */
    private static Task<bool> ServiceFailed(HttpContext ctx, Exception e)
    {
        var status = e is ServiceError se ? se.Status : 500;
        var o = Jso(("error", e.Message.Length > 0 ? e.Message : "Error"));
        if (status == 401) o["connected"] = false;
        return SendJs(ctx, o, status);
    }

    private static Task<bool> SignedOut(HttpContext ctx, Catalogue svc) =>
        SendJs(ctx, Jso(("error", "Not signed in to " + svc.Name), ("connected", false)), 401);

    // ------------------------------------------------------------ the library's rows (v0.8.44)

    [GeneratedRegex(@"^/api/(qobuz|tidal)/(open|favorite|unfavorite|play)$")]
    private static partial Regex ServiceWritePath();

    [GeneratedRegex(@"^SQLite Error \d+: '(.*)'\.$", RegexOptions.Singleline)]
    private static partial Regex SqliteSaid();
    /* An error in the words the Node server's would have: SQLite's own message, as better-sqlite3 gives it. */
    private static string NodeWords(Exception e) => e is SqliteException && SqliteSaid().Match(e.Message) is { Success: true } m ? m.Groups[1].Value : e.Message;

    /*
     * req.body as the Node server's express.json() made it (Http.ReadJs), the
     * request kept as it came (put back) for a route after this one: {} for a
     * body of another type; Ok false for one turned down, for Pages.NotThere.cs
     * to answer in its words.
     */
    private static async Task<(bool Ok, object? Body)> ServiceBody(HttpContext ctx)
    {
        var (b, read) = await Http.ReadJs(ctx, keep: true);
        return read.Refused ? (false, null) : (true, b);
    }

    /* Opening an album, favouriting it, playing it (v0.8.47), Clean up: true when answered here. */
    private static async Task<bool> ServiceWrite(HttpContext ctx)
    {
        if (!HttpMethods.IsPost(ctx.Request.Method)) return false;
        var path = ctx.Request.Path.Value ?? "";
        if (path == "/api/library/cleanup") return await ServiceCleanUp(ctx);
        var match = ServiceWritePath().Match(path);
        if (!match.Success || CatalogueOf(match.Groups[1].Value) is not { } svc || !BodyFits(ctx)) return false;
        var what = match.Groups[2].Value;
        if (what == "play" && !Jobs.Holds("services")) return false;
        var (ok, b) = await ServiceBody(ctx);
        if (!ok) return false;
        try
        {
            if (!svc.Connected()) return await SignedOut(ctx, svc);
            var given = Prop(b, "album_id");
            if (!TJs.Truthy(given)) return await JsError(ctx, 400, "album_id required");
            var albumId = TJs.Str(given);
            return what switch
            {
                "open" => await OpenAlbum(ctx, svc, albumId),
                "play" => await PlayAlbum(ctx, svc, albumId, b),
                _ => await Favourite(ctx, svc, albumId, what == "favorite")
            };
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            // Answered here whatever it is: passed on, the Node server would ask the service itself.
            if (e is not (ServiceError or Tags.JsError)) Front.Log($"[{svc.Id}] {path}: {e.GetType().Name}: {e.Message}");
            return await ImportFailed(ctx, e);
        }
    }

    /*
     * The album as library rows (transient until favourited), so its page here
     * opens. One already known is answered as it is: no asking the service
     * again, no library reload, for every tap in the browser.
     */
    private static async Task<bool> OpenAlbum(HttpContext ctx, Catalogue svc, string albumId)
    {
        if (svc.AlbumRow(albumId) is long known && await Current() is var (s, _) && s.Find(known) is { } al)
            return await Send(ctx, new JsonObject { ["ok"] = true, ["offset"] = known, ["album"] = AlbumJson(s, al) });
        var t0 = NowMs();
        var offset = await svc.EnsureAlbum(albumId);
        var t1 = NowMs();
        await svc.Changed("opened");
        var t2 = NowMs();
        // Where the time went, for a slow open to be read off the log.
        Front.Log($"[{svc.Id}] open {albumId}: asked and written in {t1 - t0} ms, library read in {t2 - t1} ms");
        // The album as the page's tiles carry it, so the page opens without another ask.
        JsonObject? album = null;
        try { if (await Current() is var (s2, _) && s2.Find(offset) is { } a2) album = AlbumJson(s2, a2); }
        catch (Exception e) when (e is SqliteException or IOException) { Front.Log($"[{svc.Id}] open {albumId}: {e.Message}"); }
        return await Send(ctx, new JsonObject { ["ok"] = true, ["offset"] = offset, ["album"] = album });
    }

    /*
     * The favourite on the service, then the album kept in the library (its
     * rows written first) or let go. Once the service has made it, a failure is
     * answered here as the Node server's wrap() answers it, rather than passed
     * on to be made twice.
     */
    private static async Task<bool> Favourite(HttpContext ctx, Catalogue svc, string albumId, bool on)
    {
        await svc.SetFavouriteThere(albumId, on);
        try { await svc.SetFavouriteHere(albumId, on); }
        catch (Exception e) when (e is not (ServiceError or Tags.JsError) && !ctx.Response.HasStarted)
        {
            Front.Log($"[{svc.Id}] {ctx.Request.Path}: {e.GetType().Name}: {e.Message}");
            return await JsError(ctx, 500, NodeWords(e));
        }
        return await SendJs(ctx, Jso(("ok", true), ("album_id", albumId), ("favourite", on)));
    }

    /*
     * Clean up of a service's albums, where the scans are this server's
     * (Scans.cs): its own scan is the one Clean up waits for, and none starts
     * while it is made. The music folders' kind ("files") and the counts (GET)
     * are HousekeepingRoutes.cs's.
     */
    private static async Task<bool> ServiceCleanUp(HttpContext ctx)
    {
        if (!Scans.On || !BodyFits(ctx)) return false;
        var (ok, b) = await ServiceBody(ctx);
        if (!ok || Prop(b, "kind") is not string kind || CatalogueOf(kind) is not { } svc) return false;
        var removed = 0;
        try
        {
            if (Scans.Running) return await Send(ctx, new JsonObject { ["error"] = ScanUnderWay }, 409);
            if (!Scans.WhileNoScan(() => removed = svc.CleanUp())) return await Send(ctx, new JsonObject { ["error"] = ScanUnderWay }, 409);
        }
        // Nothing written (the transaction undone): why, as the Node server's route answered it (its playlists not a list, the database held).
        catch (Exception e) when (e is SqliteException or Tags.JsError or InvalidOperationException && !ctx.Response.HasStarted) { return await Front.Failed(ctx, svc.Id, e); }
        if (removed > 0) await svc.Changed();
        return await Send(ctx, new JsonObject { ["ok"] = true, ["kind"] = kind, ["removed"] = removed, ["count"] = await CountNow() });
    }

    /*
     * A streamed album's page, signed in (api-library.js GET /api/album): its
     * favourite on the service, the library brought into line with it first
     * (reconcile), and why it is here — its release day too when that is
     * still to come. Each failure leaves its part out, as there.
     */
    private static async Task<JsObj> ServiceFields(Catalogue svc, Album al, LibState st)
    {
        var o = new JsObj();
        if (!svc.Connected()) return o;
        var id = AlbumIdOf(al.Key, svc.Id);
        try
        {
            // qobuz[s + "_favourite"] = qobuz.service_favourite = …: the second set first.
            var fav = await svc.Reconcile(id, new Ask(st.Version));
            o["service_favourite"] = fav;
            o[svc.Id + "_favourite"] = fav;
        }
        catch (Exception) { /* unknown: no item */ }
        try
        {
            var why = svc.Why(id);
            o["service_why"] = why;
            var today = DateTime.UtcNow.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
            if (!string.IsNullOrEmpty(al.Date) && string.CompareOrdinal(al.Date, today) > 0) why["releases"] = al.Date;
        }
        catch (Exception) { /* no note */ }
        return o;
    }

    // ------------------------------------------------------------ the import (v0.8.45), and the accounts (v0.8.47)

    [GeneratedRegex(@"^/api/settings/(qobuz|tidal)(/import|/signin|/signin/cancel|/signout|/disconnect)?$")]
    private static partial Regex ServiceSettingsPath();

    /* The service, once the Node server has handed over the import. */
    private static Catalogue? ImportOf(string id) => !Jobs.Holds("import") ? null : id == "qobuz" ? Jobs.Qobuz : id == "tidal" ? Jobs.Tidal : null;
    /* The service, once the Node server has handed over its account too (v0.8.47): signed in or not. */
    private static Catalogue? AccountOf(string id) => !Jobs.Holds("services") ? null : ImportOf(id);

    /* Settings → Services' state and switches, signing in and out, Update library now, the favourites' watch: true when answered here. */
    private static async Task<bool> ServiceImport(HttpContext ctx)
    {
        var m = ctx.Request.Method;
        var path = ctx.Request.Path.Value ?? "";
        if (path == "/api/services/watch")
        {
            if (!HttpMethods.IsPost(m) || !Jobs.Holds("import") || !BodyFits(ctx)) return false;
            var (fine, _) = await ServiceBody(ctx);
            return fine && await ServicesWatch(ctx);
        }
        var match = ServiceSettingsPath().Match(path);
        if (!match.Success) return false;
        var sub = match.Groups[2].Value;
        // Update library now: once the import is handed over; the rest once the account is too.
        if ((sub == "/import" ? ImportOf(match.Groups[1].Value) : AccountOf(match.Groups[1].Value)) is not { } svc) return false;
        if (sub.Length == 0 && (HttpMethods.IsGet(m) || HttpMethods.IsHead(m)))
        {
            try { return await SendJs(ctx, svc.Status()); }
            catch (Exception e) when (e is SqliteException or Tags.JsError or IOException && !ctx.Response.HasStarted) { return await Front.Failed(ctx, svc.Id, e); }
        }
        if (!HttpMethods.IsPost(m) || !BodyFits(ctx)) return false;
        var (ok, b) = await ServiceBody(ctx);
        if (!ok) return false;
        return sub switch
        {
            "/import" => await ImportNow(ctx, svc),
            "/signin" => await SignIn(ctx, svc, b),
            "/signin/cancel" => await CancelSignIn(ctx, svc),
            "/signout" or "/disconnect" => await SignOut(ctx, svc),
            _ => await SaveServiceSettings(ctx, svc, b)
        };
    }

    /*
     * Signing in (api-service.js POST /api/settings/<s>/signin): Qobuz with a
     * username and a password, then its import made when switched on; Tidal's
     * sign-in on tidal.com begun (the link and the code), its import made once
     * it lands (Accounts.cs). Refused in the service's words.
     */
    private static async Task<bool> SignIn(HttpContext ctx, Catalogue svc, object? b)
    {
        try
        {
            if (svc is QobuzCatalogue q)
            {
                await SendJs(ctx, await q.SignIn(Prop(b, "username"), Prop(b, "password")));
                if (q.Settings().Import) global::Mandarin.Server.Services.Import.Later(q);
                return true;
            }
            return await SendJs(ctx, await ((TidalCatalogue)svc).BeginSignIn());
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            if (e is not (ServiceError or Tags.JsError)) Front.Log($"[{svc.Id}] sign-in: {e.GetType().Name}: {e.Message}");
            return await ImportFailed(ctx, e);
        }
    }

    /* A Tidal sign-in let go (POST …/signin/cancel): the state, as it is then (Qobuz's as it is). */
    private static Task<bool> CancelSignIn(HttpContext ctx, Catalogue svc)
    {
        if (svc is TidalCatalogue t) t.CancelSignIn();
        return SendJs(ctx, svc.Status());
    }

    /* Signed out (POST …/signout, …/disconnect): the state, signed out. */
    private static async Task<bool> SignOut(HttpContext ctx, Catalogue svc)
    {
        try { return await SendJs(ctx, await svc.SignOut()); }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            if (e is not (ServiceError or Tags.JsError)) Front.Log($"[{svc.Id}] sign-out: {e.GetType().Name}: {e.Message}");
            return await ImportFailed(ctx, e);
        }
    }

    /* As api-service.js's wrap answers what throws, a 500 in SQLite's own words too. */
    private static Task<bool> ImportFailed(HttpContext ctx, Exception e)
    {
        var status = e is ServiceError se ? se.Status : 500;
        var said = Catalogue.Said(e);
        var o = Jso(("error", said.Length > 0 ? said : "Error"));
        if (status == 401) o["connected"] = false;
        return SendJs(ctx, o, status);
    }

    /* Update library now (POST /api/settings/<s>/import): signed in, the switch on; what the import made. */
    private static async Task<bool> ImportNow(HttpContext ctx, Catalogue svc)
    {
        try
        {
            if (!svc.Connected()) return await SignedOut(ctx, svc);
            // Switched off, nothing is brought in (v0.7.10).
            if (!svc.Settings().Import) return await SendJs(ctx, Jso(("error", "Switch on " + svc.Name + " in the library first"), ("import", false)), 409);
            return await SendJs(ctx, Jso(("ok", true), ("result", await svc.ImportLibrary())));
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            // Asked of the service and written as it went: answered here, as the Node server's would be.
            if (e is not (ServiceError or Tags.JsError)) Front.Log($"[{svc.Id}] import: {e.GetType().Name}: {e.Message}");
            return await ImportFailed(ctx, e);
        }
    }

    /*
     * The quality and the import's switch (POST /api/settings/<s>): written,
     * the switch's albums and playlists in or out of the library at once, and
     * switched on while signed in, brought up to date (the import started, so
     * the state answered says so). A quality not offered is refused before
     * anything is written.
     */
    private static async Task<bool> SaveServiceSettings(HttpContext ctx, Catalogue svc, object? b)
    {
        var before = svc.Settings();
        try { svc.SetSettings(Prop(b, "quality"), Undef.V); }
        catch (ServiceError e) when (!ctx.Response.HasStarted) { return await ServiceFailed(ctx, e); }
        catch (Exception e) when (e is SqliteException or IOException && !ctx.Response.HasStarted) { return await Front.Failed(ctx, svc.Id, e); }
        try
        {
            var start = false;
            if (Prop(b, "import") is var imp && imp is not Undef)
            {
                await svc.SetImport(TJs.Truthy(imp));
                start = svc.Settings().Import && !before.Import && svc.Connected();
            }
            await svc.SettingsWritten();
            // The state as the import starts, as the Node server answered it (its
            // import then still at its first ask of the service): importing.
            var st = svc.Status();
            if (start) { global::Mandarin.Server.Services.Import.Later(svc); st["importing"] = true; }
            return await SendJs(ctx, st);
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            Front.Log($"[{svc.Id}] settings: {e.GetType().Name}: {e.Message}");
            return await ImportFailed(ctx, e);
        }
    }

    /*
     * The quick look at the services' favourites (POST /api/services/watch,
     * api-library.js), when the page comes back to Home or the Library wall:
     * each signed in with its import on, not more than once in 15 seconds;
     * whether anything changed, so the page can redraw.
     */
    private static async Task<bool> ServicesWatch(HttpContext ctx)
    {
        var o = Jso(("changed", false));
        var each = new JsObj();
        o["services"] = each;
        try
        {
            foreach (var svc in new Catalogue?[] { Jobs.Qobuz, Jobs.Tidal })
            {
                if (svc == null || !svc.Connected() || !svc.Settings().Import) continue;
                try
                {
                    var r = await svc.Watch(15000);
                    if (r != null) { each[svc.Id] = r; if (TJs.Truthy(r["changed"])) o["changed"] = true; }
                }
                catch (Exception e) { each[svc.Id] = Jso(("error", Catalogue.Said(e))); }
            }
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            // The account or the switch unreadable: as the route's wrap answers it there.
            Front.Log($"[library] /api/services/watch: {e.GetType().Name}: {e.Message}");
            return await JsError(ctx, 500, Catalogue.Said(e));
        }
        return await SendJs(ctx, o);
    }

    /*
     * A service playlist's tracks as the Node server's import makes them
     * (streaming.js importPlaylists, Services/Import.cs): each record's album
     * as the library has it now, the track found on it by its path; one that
     * isn't there left out.
     */
    internal static List<object?> ServicePlaylistTracks(SqliteConnection c, Snapshot s, IEnumerable<(long AlbumId, string Path)> items)
    {
        var tracks = new List<object?>();
        var read = new Dictionary<long, List<TrackRow>>();
        foreach (var (albumId, p) in items)
        {
            if (s.Find(albumId) is not { } al) continue;
            if (!read.TryGetValue(al.Id, out var rows)) read[al.Id] = rows = Tracks(c, s, al);
            var i = rows.FindIndex(t => t.Path == p);
            if (i < 0) continue;
            var t = rows[i];
            tracks.Add(Jso(("album_offset", (double)al.Id), ("album_title", al.Title), ("album_subtitle", al.Artist), ("track_index", (double)i),
                ("title", t.Title), ("subtitle", t.Artist.Length > 0 ? t.Artist : al.Artist), ("image_key", al.ImageKey), ("track_no", t.No is long n ? (double)n : null)));
        }
        return tracks;
    }
}
