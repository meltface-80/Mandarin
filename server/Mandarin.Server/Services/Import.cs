// Import.cs — Qobuz's and Tidal's import, the favourites' watch and the
// service playlists (v0.8.45, stage 4.3 of docs/specs/csharp-migration.md),
// from lib/services/streaming.js, lib/qobuz/index.js and lib/tidal/index.js,
// rule for rule:
//
//   - the import: everything the account wants kept (its favourites; on Qobuz
//     its purchases too), every album, kept in the library as rows (Rows.cs),
//     only what is new or a week old asked of the service again; one no longer
//     wanted let go, by the ids asked for now; then the playlists. What it made
//     is kept as the Node server kept it (the setting <service>LastImport);
//   - the favourites' watch: the ids the account wants compared with what is
//     kept, a favourite added on the service brought in, one removed let go;
//   - the service playlists: each playlist there, and the favourite tracks, as
//     a playlist here (the setting userPlaylists), the albums their tracks are
//     from held (the cache, ns <service>-held);
//   - Settings → Services' state, the stream's quality and the import's switch.
//
// The work is a job the Node server hands over ("import", Jobs.cs): the first
// import shortly after the hand-over, one every six hours and the watch every
// couple of minutes (Import, below), as index.js's timers made them; an import
// it would have started itself (a Rescan) it asks for here (POST
// /internal/jobs/import), and one after signing in is started here (v0.8.47,
// Accounts.cs). Each change is told to it (/internal/library/changed,
// services), and it reads its library again, as each service's afterChange did.
//
// Tidal's token is refreshed here as the import or the watch asks (v0.8.47,
// TidalApi.cs), as the Node server's own refreshed it there: one Tidal
// refuses fails the album it was asked for, as there.
using System.Data;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

internal abstract partial class Catalogue
{
    // An album kept from a service is read from it again after this long (v0.7.10).
    private const double RefreshMs = 7 * 86400e3;
    private string PlPrefix => Id + "-pl-";
    private string PlFav => Id + "-favourite-tracks";

    private readonly object importGate = new();
    private Task<JsObj>? importing;
    private Task<JsObj?>? watching;
    private double lastWatch;
    // Moved by Halt: a run started before stops at its next album.
    private volatile int generation;

    // ------------------------------------------------------------ what each service brings

    /* The stream qualities it offers, and the one taken when none is set. */
    protected abstract string[] Qualities { get; }
    protected abstract string DefaultQuality { get; }
    /* wanted(): every album the account wants kept, in the order of a Map, each its listing with why and since when (kept_as, kept_at). */
    protected abstract Task<List<(string Id, JsObj Hint)>> Wanted();
    /* listFavouriteTracks(): [{ albumId, trackId }]. */
    protected abstract Task<List<(string AlbumId, string TrackId)>> ListFavouriteTracks();
    /* listPlaylists(): [{ id, name, tracks: [{ albumId, trackId }] }]. */
    protected abstract Task<List<(object? Id, object? Name, List<(string AlbumId, string TrackId)> Tracks)>> ListPlaylists();
    /* describe(out): the user on the status, for the page. */
    protected abstract void Describe(JsObj o);
    /* What the status says beyond (Tidal: a sign-in under way, Accounts.cs). */
    protected virtual void StatusMore(JsObj o) { }
    /* A setting written: what was learnt from the old ones forgotten (Tidal's setSettings: hi-res asked for again). */
    protected virtual void SettingsChanged() { }
    /* The settings written here: what the Node server learnt from the old ones forgotten there (Tidal, below). */
    public virtual Task SettingsWritten() => Task.CompletedTask;

    // ------------------------------------------------------------ the settings, and the state

    /* settings(): the quality (one the service offers, else its default) and the import's switch (off until switched on, v0.7.10). */
    public (string Quality, bool Import) Settings()
    {
        var s = Extras.Labels.Setting(Id + "Settings");
        if (s is Undef || !Js.Truthy(s)) s = new JsObj();
        return (P(s, "quality") is string q && Qualities.Contains(q) ? q : DefaultQuality, P(s, "import") is true);
    }

    /* setSettings(patch): a quality not offered refused in the Node server's words; written as it writes them. */
    public (string Quality, bool Import) SetSettings(object? quality, object? import)
    {
        var next = Settings();
        if (quality is not Undef)
        {
            if (quality is not string q || !Qualities.Contains(q)) throw new ServiceError("quality must be " + string.Join(", ", Qualities), 400);
            next.Quality = q;
        }
        if (import is not Undef) next.Import = Js.Truthy(import);
        var o = new JsObj();
        o["quality"] = next.Quality;
        o["import"] = next.Import;
        SettingsChanged();
        Extras.Labels.SetSetting(Id + "Settings", o);
        return next;
    }

    /*
     * The import's switch (streaming.js setImport): off, the service's albums
     * and playlists leave the library at once; on, they are back at once.
     * Nothing is deleted either way.
     */
    public async Task SetImport(bool on)
    {
        var was = Settings().Import;
        SetSettings(Undef.V, on);
        if (was != on)
        {
            Server.Log($"[{Id}] import {(on ? "on: the favourites back in the library" : "off: the favourites off the library")}");
            await Changed();
        }
    }

    /* status(): the account's state and settings, the import's, and the user (signed in). */
    public JsObj Status()
    {
        var s = Settings();
        var o = new JsObj();
        var connected = Connected();
        o["connected"] = connected;
        o["configured"] = true;
        o["available"] = true;
        o["quality"] = s.Quality;
        o["import"] = s.Import;
        lock (importGate) o["importing"] = importing != null;
        var last = Extras.Labels.Setting(Id + "LastImport");
        o["last_import"] = last is Undef ? null : last;
        o["kept"] = (double)KeptSet().Count;
        if (connected) Describe(o);
        StatusMore(o);
        return o;
    }

    // ------------------------------------------------------------ the import

    /* The library's id for this service album when it is here with its tracks and read within the week; else null (streaming.js freshAlbumId). */
    private long? FreshAlbumId(string id)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id, updated_at, track_count FROM albums WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", Key + id);
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        // As better-sqlite3 gives them: an integer as a number.
        static object? Value(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetValue(i) is long l ? (double)l : r.GetValue(i);
        if (!Js.Truthy(Value(r, 2))) return null;
        // Date.now() - (updated_at || 0) > a week: NaN is never more, as in JavaScript.
        if (NowMs() - Js.ToNumber(Or(Value(r, 1), 0.0)) > RefreshMs) return null;
        return r.GetInt64(0);
    }

    /*
     * Everything the account wants kept, every album (no cap), as kept albums
     * in the library; one no longer wanted goes back to being transient. Then
     * the playlists. What it made (streaming.js importLibrary). One at a time:
     * asked again while it runs, the one running is the answer.
     */
    public Task<JsObj> ImportLibrary()
    {
        lock (importGate)
        {
            if (importing != null) return importing;
            var run = Task.Run(RunImport);
            var done = run.ContinueWith(t => { lock (importGate) importing = null; return t; }, TaskScheduler.Default).Unwrap();
            importing = done;
            return done;
        }
    }

    private async Task<JsObj> RunImport()
    {
        var gen = generation;
        var t0 = NowMs();
        var want = await Wanted();
        var before = KeptSet();
        double added = 0, failed = 0, fetched = 0;
        foreach (var (id, hint) in want)
        {
            Going(gen);
            try
            {
                // Only what is new, or a week old (v0.7.10): an album here and read this week is kept as it is.
                if (FreshAlbumId(id) == null) { await EnsureAlbum(id, hint); fetched++; }
                if (!before.Contains(Key + id)) added++;
                Keep(id, true, Or(hint["kept_as"], "favourite"), Or(hint["kept_at"], null));
            }
            catch (Exception e)
            {
                failed++;
                Server.Log($"[{Id}] import {id}: {Said(e)}");
            }
        }
        // What is let go is decided by the id lists asked for now (v0.7.3), the
        // same lists the page reads an album's favourite off; the listing above
        // can lag a removal made moments ago in the service's own app.
        HashSet<string> drop;
        try { drop = (await WantedIds(new Ask(await Library.StateVersion()), true)).Keys.ToHashSet(StringComparer.Ordinal); }
        catch (Exception) { drop = want.Select(w => w.Id).ToHashSet(StringComparer.Ordinal); }
        Going(gen);
        double dropped = 0;
        using (var c = Db.Open())
        {
            foreach (var key in KeptSet())
            {
                if (drop.Contains(key.Length >= Key.Length ? key[Key.Length..] : "")) continue;
                Run(c, "DELETE FROM cache WHERE ns = $ns AND key = $k", ("$ns", NsKept), ("$k", key));
                dropped++;
            }
        }
        (double Playlists, double Held) pl = (0, 0);
        try { pl = await ImportPlaylists(gen); }
        catch (Exception e) { Server.Log($"[{Id}] playlists: {Said(e)}"); }
        Going(gen);
        var result = new JsObj();
        result["at"] = NowMs();
        result["albums"] = (double)want.Count;
        result["added"] = added;
        result["fetched"] = fetched;
        result["dropped"] = dropped;
        result["failed"] = failed;
        result["playlists"] = pl.Playlists;
        result["seconds"] = Js.Round((NowMs() - t0) / 1000);
        Extras.Labels.SetSetting(Id + "LastImport", result);
        Server.Log($"[{Id}] library: {want.Count} album(s) ({Js.Num(added)} new, {Js.Num(dropped)} no longer kept, {Js.Num(failed)} failed), {Js.Num(pl.Playlists)} playlist(s), in {Js.Num((double)result["seconds"]!)}s");
        await Changed();
        return result;
    }

    // ------------------------------------------------------------ the playlists

    /*
     * The service's playlists and favourite tracks as playlists here, each by
     * its name there, and "<Service> favourite tracks" (streaming.js
     * importPlaylists). The albums their tracks are from are held — known
     * here so the tracks play, off the walls unless favourites — and a
     * playlist gone from the service goes from here.
     */
    private async Task<(double Playlists, double Held)> ImportPlaylists(int gen)
    {
        var lists = new List<(string Id, string Name, List<(long AlbumId, string Path)> Items)>();
        var held = new List<string>();
        var heldSeen = new HashSet<string>(StringComparer.Ordinal);
        var albumsSeen = new Dictionary<string, long>(StringComparer.Ordinal);   // the service's album id -> the library's
        async Task<List<(long, string)>> Records(List<(string AlbumId, string TrackId)> items)
        {
            var o = new List<(long, string)>();
            foreach (var (aid, tid) in items)
            {
                if (aid.Length == 0) continue;
                Going(gen);
                try
                {
                    // Here and read this week: as it is (v0.7.10, as the import).
                    if (!albumsSeen.ContainsKey(aid)) albumsSeen[aid] = FreshAlbumId(aid) ?? await EnsureAlbum(aid);
                }
                catch (Exception e) { Server.Log($"[{Id}] playlist album {aid}: {Said(e)}"); continue; }
                if (heldSeen.Add(Key + aid)) held.Add(Key + aid);
                o.Add((albumsSeen[aid], TrackPath + tid));
            }
            return o;
        }
        List<(string AlbumId, string TrackId)> favs;
        try { favs = await ListFavouriteTracks(); } catch (Exception) { favs = []; }
        if (favs.Count > 0) lists.Add((PlFav, Name + " favourite tracks", await Records(favs)));
        List<(object? Id, object? Name, List<(string AlbumId, string TrackId)> Tracks)> pls;
        try { pls = await ListPlaylists(); } catch (Exception) { pls = []; }
        foreach (var p in pls)
        {
            if (Js.IsNullish(p.Id)) continue;
            var name = Js.Str(Or(p.Name, Name + " playlist"));
            lists.Add((PlPrefix + Js.Str(p.Id), name.Length > 80 ? name[..80] : name, await Records(p.Tracks)));
        }
        // Into the user playlists, the library read afresh first (the Node
        // server's, and so this server's copy) so the records find their rows.
        await Changed("opened");
        var s = await Library.CurrentCopy() ?? throw new JsError("The library couldn't be read");
        Going(gen);
        using var c = Db.Open();
        using var tx = c.BeginTransaction(IsolationLevel.Serializable, deferred: false);
        var v = SettingOf(c, "userPlaylists");
        if (v is Undef || !Js.Truthy(v)) v = new List<object?>();
        if (v is not List<object?> stored) throw new JsError("(this.db.setting(...) || []).filter is not a function");
        var all = stored.Where(x => Js.Truthy(x) && Js.Truthy(P(x, "id")) && Js.Truthy(P(x, "name"))).ToList();
        var keepIds = lists.Select(l => l.Id).ToHashSet(StringComparer.Ordinal);
        var outList = all.Where(x => !Js.StrictEq(ServiceOfPlaylist(x), Id) || P(x, "id") is string xid && keepIds.Contains(xid)).ToList();
        foreach (var l in lists)
        {
            var tracks = Library.ServicePlaylistTracks(c, s, l.Items);
            if (outList.FirstOrDefault(x => P(x, "id") is string xid && xid == l.Id) is JsObj was)
            {
                was["name"] = l.Name;
                was["tracks"] = tracks;
                was["updated_at"] = NowMs();
            }
            else
            {
                var made = new JsObj();
                made["id"] = l.Id;
                made["name"] = l.Name;
                made["service"] = Id;
                made["tracks"] = tracks;
                made["created_at"] = NowMs();
                made["updated_at"] = NowMs();
                outList.Add(made);
            }
        }
        Run(c, "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ("$k", "userPlaylists"), ("$v", Js.Json(outList)));
        // The held set, as it is now.
        Run(c, "DELETE FROM cache WHERE ns = $ns", ("$ns", NsHeld));
        foreach (var k in held) CachePut(c, NsHeld, k, 1.0);
        tx.Commit();
        return (lists.Count, held.Count);
    }

    // ------------------------------------------------------------ the watch

    /*
     * The favourites watched (streaming.js watch, v0.7.3): the ids the account
     * wants compared with what is kept here. A favourite added on the service
     * is brought in and kept; one removed there goes off the walls. What
     * changed, or null while an import runs or the last watch was within
     * [minAgeMs].
     */
    public Task<JsObj?> Watch(double minAgeMs = 0)
    {
        lock (importGate)
        {
            if (importing != null) return Task.FromResult<JsObj?>(null);
            if (watching != null) return watching;
            if (minAgeMs > 0 && lastWatch > 0 && NowMs() - lastWatch < minAgeMs) return Task.FromResult<JsObj?>(null);
            var run = Task.Run(RunWatch);
            var done = run.ContinueWith(t => { lock (importGate) watching = null; return t; }, TaskScheduler.Default).Unwrap();
            watching = done;
            return done;
        }
    }

    private async Task<JsObj?> RunWatch()
    {
        var gen = generation;
        // Asked now, and kept the minute as the catalogue's are: no longer than the library stays as it is.
        var want = await WantedIds(new Ask(await Library.StateVersion()), true);
        var before = KeptSet();
        double added = 0, dropped = 0, failed = 0;
        foreach (var (id, why) in want)
        {
            if (before.Contains(Key + id)) continue;
            Going(gen);
            try { await EnsureAlbum(id); Keep(id, true, why); added++; }
            catch (Exception e) { failed++; Server.Log($"[{Id}] watch {id}: {Said(e)}"); }
        }
        Going(gen);
        using (var c = Db.Open())
        {
            foreach (var key in before)
            {
                if (want.ContainsKey(key.Length >= Key.Length ? key[Key.Length..] : "")) continue;
                Run(c, "DELETE FROM cache WHERE ns = $ns AND key = $k", ("$ns", NsKept), ("$k", key));
                dropped++;
            }
        }
        lastWatch = NowMs();
        if (added > 0 || dropped > 0)
        {
            Server.Log($"[{Id}] favourites: {Js.Num(added)} added on {Name}, {Js.Num(dropped)} removed there");
            await Changed();
        }
        var o = new JsObj();
        o["added"] = added;
        o["dropped"] = dropped;
        o["failed"] = failed;
        o["changed"] = added > 0 || dropped > 0;
        return o;
    }

    // ------------------------------------------------------------ halted

    /*
     * An import or a watch under way stopped at its next album, and waited
     * for up to [most] (a backup about to be put back, Jobs.Restart): it
     * would otherwise write on across the Node server's exit and the
     * database put back, as the Node server's own never did. One started
     * after this runs as ever.
     */
    public async Task Halt(TimeSpan most)
    {
        Task[] running;
        lock (importGate)
        {
            generation++;
            running = new Task?[] { importing, watching }.OfType<Task>().ToArray();
        }
        if (running.Length > 0) await Task.WhenAny(Task.WhenAll(running).ContinueWith(_ => { }, TaskScheduler.Default), Task.Delay(most));
    }

    /* Stopped here if halted since the run began. */
    private void Going(int gen)
    {
        if (gen != generation) throw new OperationCanceledException("stopped: a backup is being put back");
    }

    // ------------------------------------------------------------ the words

    [GeneratedRegex(@"^SQLite Error \d+: '(.*)'\.$", RegexOptions.Singleline)]
    private static partial Regex SqliteSaid();

    /* An error as the Node server's e.message would say it: SQLite's own message as better-sqlite3 gives it. */
    public static string Said(Exception e) => e is SqliteException && SqliteSaid().Match(e.Message) is { Success: true } m ? m.Groups[1].Value : e.Message;
}

internal sealed partial class QobuzCatalogue
{
    protected override string[] Qualities { get; } = ["cd", "hires96", "hires192"];
    protected override string DefaultQuality => "hires192";

    /* Favourites and purchases, every one (no cap); why each is kept, and since when (Qobuz dates them in seconds). */
    protected override async Task<List<(string Id, JsObj Hint)>> Wanted()
    {
        var favsAsked = Api.FavouriteAlbums();
        var boughtAsked = Purchases();
        var favs = await favsAsked;
        var bought = await boughtAsked;
        var order = new List<string>();
        var want = new Dictionary<string, JsObj>(StringComparer.Ordinal);
        foreach (var a in favs)
        {
            if (a is not JsObj o || !Js.Truthy(o["id"])) continue;
            o["kept_as"] = "favourite";
            o["kept_at"] = Js.Truthy(o["favorited_at"]) ? Js.ToNumber(o["favorited_at"]) * 1000 : null;
            var id = Js.Str(o["id"]);
            if (!want.ContainsKey(id)) order.Add(id);
            want[id] = o;
        }
        foreach (var a in bought)
        {
            if (a is not JsObj o || !Js.Truthy(o["id"]) || want.ContainsKey(Js.Str(o["id"]))) continue;
            o["kept_as"] = "purchase";
            o["kept_at"] = Js.Truthy(o["purchased_at"]) ? Js.ToNumber(o["purchased_at"]) * 1000 : null;
            var id = Js.Str(o["id"]);
            order.Add(id);
            want[id] = o;
        }
        return order.Select(id => (id, want[id])).ToList();
    }

    /* The purchases, or none when Qobuz won't say. */
    private async Task<List<object?>> Purchases()
    {
        try { return await Api.Purchases(); }
        catch (Exception e) when (e is ServiceError or JsError) { return []; }
    }

    private static bool Listed(object? t) =>
        Js.Truthy(t) && Js.Truthy(P(t, "album")) && !Js.IsNullish(P(P(t, "album"), "id")) && !(P(t, "streamable") is false);
    private static (string, string) Record(object? t) => (Js.Str(P(P(t, "album"), "id")), Js.Str(P(t, "id")));

    protected override async Task<List<(string AlbumId, string TrackId)>> ListFavouriteTracks() =>
        (await Api.FavouriteTracks()).Where(Listed).Select(Record).ToList();

    protected override async Task<List<(object? Id, object? Name, List<(string AlbumId, string TrackId)> Tracks)>> ListPlaylists()
    {
        var o = new List<(object?, object?, List<(string, string)>)>();
        foreach (var p in await Api.Playlists())
        {
            if (!Js.Truthy(p) || Js.IsNullish(P(p, "id"))) continue;
            List<object?> tracks;
            try { tracks = await Api.PlaylistTracks(P(p, "id")); }
            catch (Exception e) when (e is ServiceError or JsError) { tracks = []; }
            o.Add((P(p, "id"), P(p, "name"), tracks.Where(Listed).Select(Record).ToList()));
        }
        return o;
    }

    protected override void Describe(JsObj o)
    {
        var u = Or(P(Or(Account(), new JsObj()), "user"), new JsObj());
        var user = new JsObj();
        user["login"] = Or(P(u, "login"), "");
        user["name"] = Or(Or(Or(P(u, "display_name"), P(u, "firstname")), P(u, "login")), "");
        user["id"] = P(u, "id");
        o["user"] = user;
        var sub = Or(P(u, "subscription"), new JsObj());
        o["subscription"] = Or(Or(Or(P(sub, "offer"), P(sub, "label")), AndP(P(u, "credential"), "label")), "");
        var prms = AndP(P(u, "credential"), "parameters");
        o["hires"] = Js.Truthy(AndP(prms, "hires_streaming"));
        o["lossless"] = Js.Truthy(AndP(prms, "lossless_streaming"));
    }
}

internal sealed partial class TidalCatalogue
{
    protected override string[] Qualities { get; } = ["cd", "hires"];
    protected override string DefaultQuality => "hires";

    /* Your favourite albums, every one (no cap), each since when you made it one. */
    protected override async Task<List<(string Id, JsObj Hint)>> Wanted()
    {
        var order = new List<string>();
        var want = new Dictionary<string, JsObj>(StringComparer.Ordinal);
        foreach (var x in await Api.FavouriteAlbums(UserId()))
        {
            var a = Js.Truthy(x) && Js.Truthy(P(x, "item")) ? P(x, "item") : x;
            if (!Js.Truthy(a) || Js.IsNullish(P(a, "id")) || a is not JsObj o) continue;
            o["kept_as"] = "favourite";
            object? at = null;
            if (Js.Truthy(x) && Js.Truthy(P(x, "created"))) { var ms = DateMs(Js.Str(P(x, "created"))); at = ms == 0 || double.IsNaN(ms) ? null : ms; }
            o["kept_at"] = at;
            var id = Js.Str(o["id"]);
            if (!want.ContainsKey(id)) order.Add(id);
            want[id] = o;
        }
        return order.Select(id => (id, want[id])).ToList();
    }

    protected override async Task<List<(string AlbumId, string TrackId)>> ListFavouriteTracks() =>
        (await Api.FavouriteTracks(UserId())).Select(x => Js.Truthy(x) && Js.Truthy(P(x, "item")) ? P(x, "item") : x)
            .Where(t => Js.Truthy(t) && Js.Truthy(P(t, "album")) && !Js.IsNullish(P(P(t, "album"), "id")) && !(P(t, "allowStreaming") is false))
            .Select(t => (Js.Str(P(P(t, "album"), "id")), Js.Str(P(t, "id")))).ToList();

    protected override async Task<List<(object? Id, object? Name, List<(string AlbumId, string TrackId)> Tracks)>> ListPlaylists()
    {
        var o = new List<(object?, object?, List<(string, string)>)>();
        foreach (var x in await Api.Playlists(UserId()))
        {
            var p = Js.Truthy(x) && Js.Truthy(P(x, "playlist")) ? P(x, "playlist") : x;
            if (!Js.Truthy(p) || !Js.Truthy(P(p, "uuid"))) continue;
            List<object?> items;
            try { items = await Api.PlaylistItems(P(p, "uuid")); }
            catch (Exception) { items = []; }
            var tracks = items.Where(i => Js.Truthy(i) && (P(i, "type") is "track" || !Js.Truthy(P(i, "type"))) && Js.Truthy(P(i, "item"))
                    && Js.Truthy(P(P(i, "item"), "album")) && !Js.IsNullish(P(P(P(i, "item"), "album"), "id")) && !(P(P(i, "item"), "allowStreaming") is false))
                .Select(i => (Js.Str(P(P(P(i, "item"), "album"), "id")), Js.Str(P(P(i, "item"), "id")))).ToList();
            o.Add((P(p, "uuid"), P(p, "title"), tracks));
        }
        return o;
    }

    protected override void Describe(JsObj o)
    {
        var a = Or(Account(), new JsObj());
        var u = Or(P(a, "user"), new JsObj());
        var user = new JsObj();
        user["login"] = Or(Or(P(u, "email"), P(u, "username")), "");
        user["name"] = Or(Or(Or(Or(P(u, "firstName"), P(u, "nickname")), P(u, "username")), P(u, "email")), "");
        user["id"] = P(a, "userId");
        user["country"] = Or(P(u, "countryCode"), "");
        o["user"] = user;
        var sub = Or(P(a, "subscription"), new JsObj());
        o["subscription"] = Or(P(sub, "type"), "");
        var hires = Js.Str(Or(P(sub, "highestSoundQuality"), "")).Contains("HI_RES", StringComparison.Ordinal) || Js.StrictEq(P(sub, "type"), "HIFI_PLUS");
        o["hires"] = hires;
        o["lossless"] = hires || Js.Str(Or(P(sub, "highestSoundQuality"), "")).Contains("LOSSLESS", StringComparison.Ordinal)
            || Regex.IsMatch(Js.Str(Or(P(sub, "type"), "")), "HIFI|PREMIUM_PLUS");
    }

    /* The settings written here: an account given CD for hi-res is asked for hi-res again there, as its own setSettings does. */
    public override Task SettingsWritten() => Library.Tell(new JsonObject { ["settings"] = Id });
}

/*
 * The import and the watch as a job handed over by the Node server ("import",
 * Jobs.cs), on index.js's timers: the first import shortly after the hand-over
 * (20 seconds, or as the Node server was set up), one every six hours, the
 * watch every two minutes; each made for a service signed in with its import
 * on, while the work is this server's.
 */
internal static class Import
{
    private static readonly object Gate = new();
    private static Timer? first, every, watch;
    private const long SixHours = 6 * 3600 * 1000;

    internal static IEnumerable<Catalogue> Services() => new Catalogue?[] { Jobs.Qobuz, Jobs.Tidal }.OfType<Catalogue>();
    /* Signed in, with the import on. */
    internal static bool Wants(Catalogue s) => s.Connected() && s.Settings().Import;

    private static long Ms(double ms) => (long)Math.Min(ms, 4294967294);

    public static void Start(JsonObject cfg)
    {
        var delay = cfg["service_sync_delay_ms"] is JsonValue d && d.TryGetValue<double>(out var dv) && dv >= 0 ? dv : 20000;
        var each = cfg["service_watch_ms"] is JsonValue w && w.TryGetValue<double>(out var wv) && wv > 0 ? wv : 120000;
        lock (Gate)
        {
            Halt();
            first = new Timer(_ => Sync(), null, Ms(delay), Timeout.Infinite);
            every = new Timer(_ => Sync(), null, SixHours, SixHours);
            watch = new Timer(_ => WatchAll(), null, Ms(each), Ms(each));
        }
    }

    public static void Stop() { lock (Gate) Halt(); }

    private static void Halt()
    {
        first?.Dispose();
        every?.Dispose();
        watch?.Dispose();
        first = every = watch = null;
    }

    /* An import made in the background, its failure logged as the Node server logged it. */
    public static void Later(Catalogue s, string said = "import") =>
        _ = s.ImportLibrary().ContinueWith(t => { if (t.Exception?.InnerException is { } e) Server.Log($"[{s.Id}] {said}: {Catalogue.Said(e)}"); }, TaskScheduler.Default);

    /*
     * index.js serviceSync: each service's import. One after the other, not
     * side by side as there: a step left to the Node server (Tidal's token)
     * writes the playlists outside any transaction, so it mustn't run while
     * the other service's import here writes them.
     */
    private static void Sync()
    {
        try
        {
            if (!Jobs.Holds("import")) return;
            var todo = Services().Where(Wants).ToList();
            if (todo.Count == 0) return;
            _ = Task.Run(async () =>
            {
                foreach (var s in todo)
                {
                    try { await s.ImportLibrary(); }
                    catch (Exception e) { Server.Log($"[{s.Id}] import: {Catalogue.Said(e)}"); }
                }
            });
        }
        catch (Exception e) { Server.Log($"[import] {e.GetType().Name}: {e.Message}"); }
    }

    /* Each service's import or watch under way stopped, and the timers (a backup about to be put back): the Node server's start after it arms them again. */
    public static async Task HaltRuns()
    {
        Stop();
        await Task.WhenAll(Services().Select(s => s.Halt(TimeSpan.FromSeconds(20))));
    }

    /* index.js serviceWatch: each service's favourites looked at. */
    private static void WatchAll()
    {
        try
        {
            if (!Jobs.Holds("import")) return;
            foreach (var s in Services())
                if (Wants(s)) _ = s.Watch().ContinueWith(t => { if (t.Exception?.InnerException is { } e) Server.Log($"[{s.Id}] watch: {Catalogue.Said(e)}"); }, TaskScheduler.Default);
        }
        catch (Exception e) { Server.Log($"[watch] {e.GetType().Name}: {e.Message}"); }
    }

    /* The watch made now, as its timer makes it (POST /internal/jobs/watch: the tests): what each service's found, or null when the work isn't here. */
    public static async Task<JsObj?> WatchNow()
    {
        if (!Jobs.Holds("import")) return null;
        var o = new JsObj();
        foreach (var s in Services().Where(Wants).ToList())
        {
            try { o[s.Id] = await s.Watch(); }
            catch (Exception e) { var err = new JsObj(); err["error"] = Catalogue.Said(e); o[s.Id] = err; }
        }
        return o;
    }

    /*
     * An import the Node server would have started itself (POST
     * /internal/jobs/import): one service's ([service], a sign-in), or each
     * signed in with its import on, one after the other ([afterRescan], as
     * api-library.js's syncServicesAfter). False when the work isn't here.
     */
    public static bool Now(string? service, bool afterRescan)
    {
        if (!Jobs.Holds("import")) return false;
        if (afterRescan)
        {
            var todo = Services().Where(Wants).ToList();
            _ = Task.Run(async () =>
            {
                foreach (var s in todo)
                {
                    try { await s.ImportLibrary(); }
                    catch (Exception e) { Server.Log($"[{s.Id}] import after rescan: {Catalogue.Said(e)}"); }
                }
            });
            return true;
        }
        if (Services().FirstOrDefault(x => x.Id == service) is not { } one) return false;
        Later(one);
        return true;
    }
}
