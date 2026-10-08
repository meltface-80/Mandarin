// AdminRoutes.cs — Backup & restore and built-in Tailscale (v0.8.22), from
// lib/server/api-backup.js and lib/server/api-tailscale.js, in the same shapes:
//
//   GET    /api/backup                 the parts, the database's size, and the backups kept here
//   POST   /api/backup/file            a backup, streamed back as a file (the Android app saves it)
//   POST   /api/backup/save            a backup kept on the server (a browser's)
//   GET    /api/backup/download/:id    one kept here, as a file
//   DELETE /api/backup/:id             one kept here, deleted
//   POST   /api/backup/restore         restore from a backup file sent as the body
//   POST   /api/backup/restore/:id     restore from one kept here
//   GET    /api/tailscale              how it is: state, sign-in link, address
//   POST   /api/tailscale/login        a sign-in link (open it, sign in, done)
//   POST   /api/tailscale/logout       this server leaves the tailnet
//   POST   /api/tailscale/enable       {on}: built-in Tailscale on or off
//
// Answered here once the Node server has handed Tailscale over (Jobs.cs),
// which a Node server new enough to be restarted from here does. Restoring
// keeps a backup of how things were first ("Before restore"), then the Node
// server starts again so everything reads its settings afresh (and swaps in a
// whole database, staged for it); this server, and Tailscale with it, stays up.
// From home or away; Tailscale's switches from home only.
using System.Text;
using Mandarin.Server.Admin;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private static int backupBusy;

    private static string DataDir => Path.GetDirectoryName(Db.File) ?? ".";
    private static Backup.Store Backups => new(DataDir);

    /* The backup and Tailscale routes: true when answered here. */
    private static async Task<bool> AdminRoute(HttpContext ctx)
    {
        var p = ctx.Request.Path.Value ?? "";
        if (!p.StartsWith("/api/backup", StringComparison.Ordinal) && !p.StartsWith("/api/tailscale", StringComparison.Ordinal)) return false;
        if (Jobs.Tailscale is not { } ts || !Jobs.Holds("tailscale")) return false;
        var m = ctx.Request.Method;
        var parts = p.Split('/');   // "", "api", "backup", …
        string? Id(int at) => parts.Length == at + 1 && parts[at].Length > 0 ? Uri.UnescapeDataString(parts[at]) : null;
        try
        {
            switch (m)
            {
                case "GET" when p == "/api/backup": return await BackupList(ctx);
                case "POST" when p == "/api/backup/file": return BodyFits(ctx) && await BackupFile(ctx, ts);
                case "POST" when p == "/api/backup/save": return BodyFits(ctx) && await BackupSave(ctx, ts);
                case "GET" when parts.Length == 5 && p.StartsWith("/api/backup/download/", StringComparison.Ordinal) && Id(4) is { } dl: return await BackupDownload(ctx, dl);
                case "DELETE" when parts.Length == 4 && parts[2] == "backup" && Id(3) is { } del:
                {
                    var o = new JsObj();
                    o["ok"] = Backups.Remove(del);
                    return await SendJs(ctx, o);
                }
                case "POST" when p == "/api/backup/restore": return await BackupRestoreUpload(ctx, ts);
                case "POST" when parts.Length == 5 && p.StartsWith("/api/backup/restore/", StringComparison.Ordinal) && Id(4) is { } rid: return BodyFits(ctx) && await BackupRestoreKept(ctx, ts, rid);
                case "GET" when p == "/api/tailscale": return await SendJs(ctx, ts.Status());
                case "POST" when p is "/api/tailscale/login" or "/api/tailscale/logout" or "/api/tailscale/enable": return BodyFits(ctx) && await TailscaleSwitch(ctx, ts, p);
            }
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            Front.Log($"[admin] {p}: {e.GetType().Name}: {e.Message}");
            return await JsError(ctx, e is Backup.Refused r ? r.Status : 500, e.Message);
        }
        return false;
    }

    // ------------------------------------------------------------ Tailscale

    private static async Task<bool> TailscaleSwitch(HttpContext ctx, Admin.Tailscale ts, string p)
    {
        var (b, answered) = await JsBody(ctx);
        if (answered) return true;
        // From home only: away, the way you're reaching the server is the thing these would change.
        if (Auth.IsAway(ctx)) return await JsError(ctx, 403, "Change this from home — away, it's how you're connected");
        try
        {
            var st = p switch
            {
                "/api/tailscale/login" => await ts.Login(),
                "/api/tailscale/logout" => await ts.Logout(),
                _ => await ts.SetEnabled(TJs.Truthy(Prop(b, "on")))
            };
            return await SendJs(ctx, st);
        }
        catch (Exception e) { return await JsError(ctx, e is Backup.Refused r ? r.Status : 500, e.Message); }
    }

    // ------------------------------------------------------------ making one

    private static (string Name, string? Phone) Who(HttpContext ctx)
    {
        using var c = Db.Open();
        var dev = Auth.DeviceOf(ctx, c);
        return (dev?.Name is { Length: > 0 } n ? n : "A browser", dev?.Kind == "android" ? "PHONE_" + dev.Id : null);
    }

    private static string TmpFile(string ext)
    {
        var d = Path.Combine(DataDir, "backups", "tmp");
        Directory.CreateDirectory(d);
        return Path.Combine(d, $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Environment.ProcessId}-{Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(6)).ToLowerInvariant()}{ext}");
    }
    private static void Rm(string? f) { try { if (f != null) File.Delete(f); } catch (Exception) { /* gone */ } }

    private static string StateFile(Admin.Tailscale ts) => Path.Combine(ts.Dir, "tailscaled.state");

    /*
     * A backup of [include] (and the page's and app's parts sent along) to
     * [output]: its manifest, as written. The database is copied first; then
     * everything is written in one go.
     */
    private static async Task<JsObj> Build(Stream output, Dictionary<string, bool> include, object? app, object? page, double? created, HttpContext ctx, Admin.Tailscale ts, Action? beforeWriting = null)
    {
        bool Has(string k) => include.TryGetValue(k, out var v) && v;
        var parts = Backup.ServerParts.Where(Has).ToList();
        var (name, phone) = Who(ctx);
        var manifest = new JsObj();
        manifest["app"] = "mandarin";
        manifest["format"] = (double)Backup.Format;
        manifest["version"] = AppVersion;
        manifest["created"] = created ?? (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var from = new JsObj();
        from["name"] = name;
        from["kind"] = phone != null ? "android" : "browser";
        manifest["from"] = from;
        manifest["phone"] = phone;
        var manifestParts = parts.Select(x => (object?)x).ToList();
        manifest["parts"] = manifestParts;
        var entries = new List<Backup.Entry>();
        if (parts.Count > 0)
        {
            using var c = Db.Open();
            entries.Add(Backup.JsonEntry("server.json", Backup.Snapshot(c, parts.ToHashSet())));
        }
        // The server's Tailscale identity with the keys: restored onto a fresh install, the same node on your tailnet.
        if (Has("keys"))
        {
            byte[]? state = null;
            try { state = File.ReadAllBytes(StateFile(ts)); } catch (Exception) { /* none */ }
            if (state != null)
            {
                var t = new JsObj();
                t["state"] = Convert.ToBase64String(state);
                entries.Add(Backup.JsonEntry("tailscale.json", t));
                manifest["tailscale"] = true;
            }
        }
        if (TJs.IsObject(app) && app is not null) { entries.Add(Backup.JsonEntry("app.json", app)); manifestParts.Add("app"); }
        if (TJs.IsObject(page) && page is not null) { entries.Add(Backup.JsonEntry("page.json", page)); manifestParts.Add("page"); }
        string? dbCopy = null;
        try
        {
            if (Has("database"))
            {
                dbCopy = TmpFile(".db");
                Backup.CopyDatabase(dbCopy);
                entries.Add(new Backup.Entry("musicd.db", File: dbCopy));
                manifestParts.Add("database");
            }
            entries.Insert(0, Backup.JsonEntry("manifest.json", manifest));
            beforeWriting?.Invoke();
            await Backup.WriteBackup(output, entries);
        }
        finally { Rm(dbCopy); }
        return manifest;
    }

    /* A backup kept on the server: its record. */
    private static async Task<JsObj> SaveHere(Dictionary<string, bool> include, object? app, object? page, HttpContext ctx, Admin.Tailscale ts, string kind, object? label)
    {
        var store = Backups;
        var id = store.NewId(kind);
        var file = store.PathFor(id);
        JsObj manifest;
        await using (var f = File.Create(file)) manifest = await Build(f, include, app, page, null, ctx, ts);
        var meta = new JsObj();
        meta["id"] = id;
        meta["kind"] = kind;
        meta["label"] = TJs.Truthy(label) ? label : ((JsObj)manifest["from"]!)["name"];
        meta["created"] = manifest["created"];
        meta["version"] = manifest["version"];
        meta["parts"] = manifest["parts"];
        meta["bytes"] = (double)new FileInfo(file).Length;
        return store.Record(meta);
    }

    private static async Task<bool> BackupList(HttpContext ctx)
    {
        double dbBytes = 0;
        try { dbBytes = new FileInfo(Db.File).Length; } catch (Exception) { /* none */ }
        var o = new JsObj();
        o["version"] = AppVersion;
        o["parts"] = Backup.Parts.Select(x => (object?)x).ToList();
        o["db_bytes"] = dbBytes;
        o["backups"] = Backups.List().Select(x => (object?)x).ToList();
        return await SendJs(ctx, o);
    }

    private static async Task<bool> BackupFile(HttpContext ctx, Admin.Tailscale ts)
    {
        var (b, answered) = await JsBody(ctx);
        if (answered) return true;
        var include = Backup.PartsOf(Prop(b, "include"));
        bool Has(string k) => include.TryGetValue(k, out var v) && v;
        var name = $"mandarin-backup-{Backup.Stamp()}.tar.gz";
        var created = (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        // What the file will hold, up front: the app lists the file with it.
        var parts = Backup.ServerParts.Where(Has).Select(x => (object?)x).ToList();
        var app = Prop(b, "app");
        var page = Prop(b, "page");
        if (TJs.IsObject(app)) parts.Add("app");
        if (TJs.IsObject(page)) parts.Add("page");
        if (Has("database")) parts.Add("database");
        var said = new JsObj();
        said["version"] = AppVersion;
        said["created"] = created;
        said["parts"] = parts;
        said["from"] = Who(ctx).Name;
        try
        {
            await Build(ctx.Response.Body, include, app, page, created, ctx, ts, beforeWriting: () =>
            {
                var h = ctx.Response.Headers;
                h["X-Mandarin-Answered"] = "C#";
                h.ContentType = "application/gzip";
                h.ContentDisposition = $"attachment; filename=\"{name}\"";
                h["X-Mandarin-Backup"] = TJs.Json(said);
                ctx.Response.StatusCode = 200;
            });
        }
        catch (Exception e)
        {
            Front.Log($"[backup] {e.Message}");
            if (!ctx.Response.HasStarted) return await JsError(ctx, e is Backup.Refused r ? r.Status : 400, e.Message);
            ctx.Abort();
        }
        return true;
    }

    private static async Task<bool> BackupSave(HttpContext ctx, Admin.Tailscale ts)
    {
        var (b, answered) = await JsBody(ctx);
        if (answered) return true;
        if (Interlocked.Exchange(ref backupBusy, 1) == 1) return await JsError(ctx, 409, "A backup or restore is already running");
        try
        {
            var meta = await SaveHere(Backup.PartsOf(Prop(b, "include")), Prop(b, "app"), Prop(b, "page"), ctx, ts, "manual", Prop(b, "label"));
            var o = new JsObj();
            o["ok"] = true;
            o["backup"] = meta;
            return await SendJs(ctx, o);
        }
        catch (Exception e) { return await JsError(ctx, e is Backup.Refused r ? r.Status : 400, e.Message); }
        finally { Interlocked.Exchange(ref backupBusy, 0); }
    }

    private static async Task<bool> BackupDownload(HttpContext ctx, string id)
    {
        if (Backups.File(id) is not { } f) return await JsError(ctx, 404, "No such backup");
        var info = new FileInfo(f);
        var h = ctx.Response.Headers;
        h["X-Mandarin-Answered"] = "C#";
        h.ContentType = "application/gzip";
        h.ContentDisposition = $"attachment; filename=\"mandarin-backup-{System.Text.RegularExpressions.Regex.Replace(id, "-[0-9a-f]{6}$", "")}.tar.gz\"";
        h.AcceptRanges = "bytes";
        h.CacheControl = "public, max-age=0";
        h.LastModified = info.LastWriteTimeUtc.ToString("R");
        ctx.Response.ContentLength = info.Length;
        await ctx.Response.SendFileAsync(f);
        return true;
    }

    // ------------------------------------------------------------ restoring

    private static async Task<bool> BackupRestoreUpload(HttpContext ctx, Admin.Tailscale ts)
    {
        if (Interlocked.Exchange(ref backupBusy, 1) == 1) return await JsError(ctx, 409, "A backup or restore is already running");
        var upload = TmpFile(".tar.gz");
        try
        {
            await using (var w = File.Create(upload)) await ctx.Request.Body.CopyToAsync(w);
            var q = Values(ctx, "parts");
            object? parts = q == null ? Undef.V : q.Count == 1 ? q[0] : q.Select(x => (object?)x).ToList();
            return await Finish(ctx, ts, await RestoreFile(upload, Backup.PartsOf(parts), ctx, ts));
        }
        catch (Exception e)
        {
            Front.Log($"[backup] restore: {e.Message}");
            return await JsError(ctx, e is Backup.Refused r ? r.Status : 400, e.Message);
        }
        finally { Rm(upload); Interlocked.Exchange(ref backupBusy, 0); }
    }

    private static async Task<bool> BackupRestoreKept(HttpContext ctx, Admin.Tailscale ts, string id)
    {
        var (b, answered) = await JsBody(ctx);
        if (answered) return true;
        if (Backups.File(id) is not { } f) return await JsError(ctx, 404, "No such backup");
        if (Interlocked.Exchange(ref backupBusy, 1) == 1) return await JsError(ctx, 409, "A backup or restore is already running");
        try { return await Finish(ctx, ts, await RestoreFile(f, Backup.PartsOf(Prop(b, "include")), ctx, ts)); }
        catch (Exception e)
        {
            Front.Log($"[backup] restore: {e.Message}");
            return await JsError(ctx, e is Backup.Refused r ? r.Status : 400, e.Message);
        }
        finally { Interlocked.Exchange(ref backupBusy, 0); }
    }

    /*
     * Restore from a backup file on disk: what was restored, and the page's and
     * app's parts for the device to apply. How things are now is kept first.
     */
    private static async Task<JsObj> RestoreFile(string file, Dictionary<string, bool> include, HttpContext ctx, Admin.Tailscale ts)
    {
        bool Has(string k) => include.TryGetValue(k, out var v) && v;
        var dbFile = TmpFile(".db");
        try
        {
            var (parts, hasDb) = await Task.Run(() => Backup.ReadBackup(file, dbFile));
            var m = (JsObj)parts["manifest"]!;
            if (TJs.ToNumber(m["format"]) > Backup.Format || Backup.Newer(m["version"], AppVersion))
                throw new Backup.Refused($"That backup was made by Mandarin v{TJs.Str(m["version"])}; update this server first", 409);
            var map = new Dictionary<string, string>();
            var phone = Who(ctx).Phone;
            if (TJs.Truthy(m["phone"]) && phone != null && !TJs.StrictEq(m["phone"], phone)) map[TJs.Str(m["phone"])] = phone;
            var restored = new List<object?>();
            var wantServer = Backup.ServerParts.Any(p => Has(p) && TJs.Truthy(parts["server"])) || (Has("database") && hasDb);
            if (wantServer)
            {
                // How things are now, first: Undo is restoring this one.
                var all = new Dictionary<string, bool> { ["settings"] = true, ["devices"] = true, ["collection"] = true, ["keys"] = true };
                await SaveHere(all, null, null, ctx, ts, "auto", "Before restore");
            }
            if (Has("database") && hasDb)
            {
                Backup.StageDatabase(dbFile, Db.File, DataDir, map);
                restored.Add("database");
            }
            else if (parts["server"] is var server && TJs.Truthy(server))
            {
                using var c = Db.Open();
                var done = server is JsObj so ? Backup.Apply(c, so, include.Where(kv => kv.Value).Select(kv => kv.Key).ToHashSet(), map) : [];
                restored.AddRange(done);
                try { Backup.ExportEdits(c, DataDir); } catch (Exception e) { Front.Log($"[musicd] couldn't write album-edits.json: {e.Message}"); }
            }
            // The Tailscale identity, with the keys or the whole database: the node the backup was made on, not a new one.
            if ((Has("keys") || (Has("database") && hasDb)) && parts["tailscale"] is JsObj tsPart && tsPart["state"] is string state)
            {
                var buf = Convert.FromBase64String(state);
                if (buf.Length > 0)
                {
                    try
                    {
                        ts.Stop();   // the engine lets go of the file; it starts again with the server
                        Directory.CreateDirectory(ts.Dir);
                        File.WriteAllBytes(StateFile(ts), buf);
                        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(StateFile(ts), UnixFileMode.UserRead | UnixFileMode.UserWrite);
                        restored.Add("tailscale");
                    }
                    catch (Exception e) { Front.Log($"[backup] tailscale identity: {e.Message}"); }
                }
            }
            var o = new JsObj();
            o["ok"] = true;
            o["restored"] = restored;
            o["version"] = m["version"];
            o["created"] = m["created"];
            if (Has("page") && TJs.Truthy(parts["page"])) { o["page"] = parts["page"]; restored.Add("page"); }
            if (Has("app") && TJs.Truthy(parts["app"])) { o["app"] = parts["app"]; restored.Add("app"); }
            o["restarting"] = restored.Any(x => !TJs.StrictEq(x, "page") && !TJs.StrictEq(x, "app"));
            return o;
        }
        finally { Rm(dbFile); }
    }

    /* The answer, then (when anything of the server's came back) the Node server started again; Tailscale too, here. */
    private static async Task<bool> Finish(HttpContext ctx, Admin.Tailscale ts, JsObj o)
    {
        await SendJs(ctx, o);
        if (TJs.Truthy(o["restarting"]))
        {
            Front.Log($"[backup] restored {string.Join(", ", ((List<object?>)o["restored"]!).Select(x => TJs.Str(x)))}; restarting");
            _ = Task.Run(async () =>
            {
                await Task.Delay(500);
                await Jobs.RestartNode();
                if (((List<object?>)o["restored"]!).Contains("tailscale")) await ts.Start();
            });
        }
        return true;
    }
}
