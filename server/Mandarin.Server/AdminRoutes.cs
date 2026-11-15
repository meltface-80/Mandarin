// AdminRoutes.cs — Backup & restore and built-in Tailscale (v0.8.22), from
// lib/server/api-backup.js and lib/server/api-tailscale.js, in the same shapes:
//
//   GET    /api/backup                 the parts, the database's size, and the backups kept here
//   POST   /api/backup/file            a backup, streamed back as a file (the Android app saves it)
//   POST   /api/backup/save            a backup kept on the server (a browser's)
//   GET    /api/backup/download/:id    one kept here, as a file
//   DELETE /api/backup/:id             one kept here, deleted (a copy of the database too)
//   POST   /api/backup/restore         restore from a backup file sent as the body
//   POST   /api/backup/restore/:id     restore from one kept here, or from a copy of the database
//                                      kept before a restore or a switch of builds (GET's copies)
//   GET    /api/tailscale              how it is: state, sign-in link, address
//   POST   /api/tailscale/login        a sign-in link (open it, sign in, done)
//   POST   /api/tailscale/logout       this server leaves the tailnet
//   POST   /api/tailscale/enable       {on}: built-in Tailscale on or off
//
// Restoring keeps a backup of how things were first ("Before restore"), then
// the server starts again in place so everything reads its settings afresh
// (and a whole database, staged, is swapped in as it starts).
// From home or away; Tailscale's switches from home only. Restoring is in
// AdminRestoreRoutes.cs; a backup sealed with a passphrase, Admin/Backup.Seal.cs.
using Mandarin.Server.Admin;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private static int backupBusy;

    private static string DataDir => Path.GetDirectoryName(Db.File) ?? ".";
    private static Backup.Store Backups => new(DataDir);
    private static Backup.Copies Copies => new(DataDir);

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
                    o["ok"] = Backups.Remove(del) || Copies.Remove(del);
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
            Server.Log($"[admin] {p}: {e.GetType().Name}: {e.Message}");
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

    private static string TmpFile(string ext) => Backup.TmpFile(DataDir, ext);
    private static void Rm(string? f) { try { if (f != null) File.Delete(f); } catch (Exception) { /* gone */ } }

    private static string StateFile(Admin.Tailscale ts) => Path.Combine(ts.Dir, "tailscaled.state");

    /* Where a backup is made here, and who asked for it (Admin/Backup.Make.cs makes it). */
    private static Backup.Maker Maker(Admin.Tailscale ts) => new(DataDir, AppVersion, StateFile(ts));
    private static Backup.From From(HttpContext ctx) { var (name, phone) = Who(ctx); return new(name, phone); }

    internal static FileStream Private(string file) => Backup.Private(file);

    /* A backup kept on the server: its record. */
    private static Task<JsObj> SaveHere(Dictionary<string, bool> include, object? app, object? page, HttpContext ctx, Admin.Tailscale ts, string kind, object? label, string? passphrase = null) =>
        Backup.Keep(Maker(ts), From(ctx), include, app, page, kind, label, passphrase);

    private static async Task<bool> BackupList(HttpContext ctx)
    {
        double dbBytes = 0;
        try { dbBytes = new FileInfo(Db.File).Length; } catch (Exception) { /* none */ }
        var o = new JsObj();
        o["version"] = AppVersion;
        o["parts"] = Backup.Parts.Select(x => (object?)x).ToList();
        o["db_bytes"] = dbBytes;
        o["backups"] = Backups.List().Select(x => (object?)x).ToList();
        // The database as it was before a restore or a switch of builds, the database alone (Admin/Backup.Copies.cs).
        o["copies"] = Copies.List().Select(x => (object?)x).ToList();
        return await SendJs(ctx, o);
    }

    private static async Task<bool> BackupFile(HttpContext ctx, Admin.Tailscale ts)
    {
        var (b, answered) = await JsBody(ctx);
        if (answered) return true;
        var include = Backup.PartsOf(Prop(b, "include"));
        bool Has(string k) => include.TryGetValue(k, out var v) && v;
        var passphrase = Backup.Passphrase(Prop(b, "passphrase"));
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
        if (Backup.Seals(include, passphrase)) said["sealed"] = true;
        try
        {
            await Backup.Make(ctx.Response.Body, Maker(ts), From(ctx), include, app, page, created, passphrase, beforeWriting: () =>
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
            Server.Log($"[backup] {e.Message}");
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
            var meta = await SaveHere(Backup.PartsOf(Prop(b, "include")), Prop(b, "app"), Prop(b, "page"), ctx, ts, "manual", Prop(b, "label"), Backup.Passphrase(Prop(b, "passphrase")));
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
        // The time to the nearest millisecond first, as Node's fs.Stats gives it (Pages.cs).
        h.LastModified = DateTimeOffset.FromUnixTimeMilliseconds((long)Math.Floor((new DateTimeOffset(info.LastWriteTimeUtc).UtcTicks - DateTimeOffset.UnixEpoch.UtcTicks) / 10000.0 + 0.5)).ToString("R");
        ctx.Response.ContentLength = info.Length;
        await ctx.Response.SendFileAsync(f);
        return true;
    }
}
