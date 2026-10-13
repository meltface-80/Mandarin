// AdminRestoreRoutes.cs — restoring from a backup (v0.8.22; split from
// AdminRoutes.cs in v0.9.0): from a file sent as the body or from one kept
// here, the parts ticked, how things are now kept first ("Before restore"),
// then the server started again so everything reads its settings afresh.
// A sealed backup's keys (Admin/Backup.Seal.cs) only with its passphrase.
using Mandarin.Server.Admin;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private static async Task<bool> BackupRestoreUpload(HttpContext ctx, Admin.Tailscale ts)
    {
        if (Interlocked.Exchange(ref backupBusy, 1) == 1) return await JsError(ctx, 409, "A backup or restore is already running");
        var upload = TmpFile(".tar.gz");
        try
        {
            await using (var w = File.Create(upload)) await ctx.Request.Body.CopyToAsync(w);
            var q = Values(ctx, "parts");
            object? parts = q == null ? Undef.V : q.Count == 1 ? q[0] : q.Select(x => (object?)x).ToList();
            return await Finish(ctx, ts, await RestoreFile(upload, Backup.PartsOf(parts), ctx, ts, PassphraseSent(ctx)));
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
        try { return await Finish(ctx, ts, await RestoreFile(f, Backup.PartsOf(Prop(b, "include")), ctx, ts, Prop(b, "passphrase") is string { Length: > 0 } pass ? pass : null)); }
        catch (Exception e)
        {
            Front.Log($"[backup] restore: {e.Message}");
            return await JsError(ctx, e is Backup.Refused r ? r.Status : 400, e.Message);
        }
        finally { Interlocked.Exchange(ref backupBusy, 0); }
    }

    /* A sealed backup's passphrase sent with its file: X-Mandarin-Passphrase, base64 of its UTF-8. */
    private static string? PassphraseSent(HttpContext ctx)
    {
        var h = ctx.Request.Headers["X-Mandarin-Passphrase"].ToString();
        if (h.Length == 0) return null;
        try { return System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(h)); }
        catch (FormatException) { throw new Backup.Refused("The passphrase didn't arrive whole"); }
    }

    /*
     * Restore from a backup file on disk: what was restored, and the page's and
     * app's parts for the device to apply. How things are now is kept first.
     */
    private static async Task<JsObj> RestoreFile(string file, Dictionary<string, bool> include, HttpContext ctx, Admin.Tailscale ts, string? passphrase)
    {
        bool Has(string k) => include.TryGetValue(k, out var v) && v;
        var dbFile = TmpFile(".db");
        try
        {
            var (parts, hasDb) = await Task.Run(() => Backup.ReadBackup(file, dbFile));
            var m = (JsObj)parts["manifest"]!;
            if (TJs.ToNumber(m["format"]) > Backup.Format || Backup.Newer(m["version"], AppVersion))
                throw new Backup.Refused($"That backup was made by Mandarin v{TJs.Str(m["version"])}; update this server first", 409);
            // Sealed: the keys, the Tailscale identity and the whole database only with its passphrase, before anything changes.
            JsObj? sealedKeys = null;
            if ((TJs.Truthy(m["sealed"]) || parts.Has("sealed")) && (Has("keys") || (Has("database") && hasDb)))
            {
                var opened = Backup.Unseal(parts["sealed"], passphrase);
                sealedKeys = opened["keys"] as JsObj;
                if (sealedKeys != null && parts["server"] is JsObj so0) so0["keys"] = sealedKeys;
                if (opened["tailscale"] is JsObj t) parts["tailscale"] = t;
            }
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
                // Its keys back in before it is staged: a database that can't take them is never swapped in.
                if (sealedKeys != null) { Backup.CheckDatabase(dbFile); Backup.PutKeys(dbFile, sealedKeys); }
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
                await Jobs.Restart();
                if (((List<object?>)o["restored"]!).Contains("tailscale")) await ts.Start();
            });
        }
        return true;
    }
}
