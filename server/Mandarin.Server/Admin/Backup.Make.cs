// Backup.Make.cs — a backup made, and one kept on the server (out of AdminRoutes.cs, item 405): the same file whether the
// page asks for it (AdminRoutes.cs), a restore keeps one first (AdminRestoreRoutes.cs), or Mandarin OS's Reinstall
// Mandarin makes one before it moves Mandarin between its releases and dev's builds (BackupCommand.cs).
using Mandarin.Server.Tags;

namespace Mandarin.Server.Admin;

using Js = Mandarin.Server.Tags.Js;

internal static partial class Backup
{
    /* Where a backup is made, and by what: the data folder, the program's version, the Tailscale engine's state file. */
    public sealed record Maker(string DataDir, string Version, string TailscaleState);

    /* What a backup says it is from: a device's name, and "PHONE_<id>" where that device is a phone. */
    public sealed record From(string Name, string? Phone);

    /* A file in the data folder's backups/tmp, of [ext], named so no two are alike. */
    public static string TmpFile(string dataDir, string ext)
    {
        var d = Path.Combine(dataDir, "backups", "tmp");
        Directory.CreateDirectory(d);
        return Path.Combine(d, $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Environment.ProcessId}-{Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(6)).ToLowerInvariant()}{ext}");
    }

    /* A file made readable by the server's own user alone (a backup holds the services' keys): never another's on the machine. */
    public static FileStream Private(string file)
    {
        var o = new FileStreamOptions { Mode = FileMode.Create, Access = FileAccess.ReadWrite };
        if (!OperatingSystem.IsWindows()) o.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        return new FileStream(file, o);
    }

    /*
     * A backup of [include] (and the page's and app's parts sent along) to [output]: its manifest, as written. The
     * database is copied first; then everything is written in one go. With a passphrase, the keys and the Tailscale
     * identity go sealed (Backup.Seal.cs).
     */
    public static async Task<JsObj> Make(Stream output, Maker by, From from, Dictionary<string, bool> include, object? app, object? page, double? created,
        string? passphrase, Action? beforeWriting = null)
    {
        bool Has(string k) => include.TryGetValue(k, out var v) && v;
        var parts = ServerParts.Where(Has).ToList();
        var manifest = new JsObj();
        manifest["app"] = "mandarin";
        manifest["format"] = (double)Format;
        manifest["version"] = by.Version;
        manifest["created"] = created ?? (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var fromObj = new JsObj();
        fromObj["name"] = from.Name;
        fromObj["kind"] = from.Phone != null ? "android" : "browser";
        manifest["from"] = fromObj;
        manifest["phone"] = from.Phone;
        var manifestParts = parts.Select(x => (object?)x).ToList();
        manifest["parts"] = manifestParts;
        var entries = new List<Entry>();
        var seal = Seals(include, passphrase) ? new JsObj() : null;
        if (parts.Count > 0 || seal != null)
        {
            using var c = Db.Open();
            if (seal != null) seal["keys"] = KeysOf(c);
            if (parts.Count > 0)
            {
                var snap = Snapshot(c, parts.ToHashSet());
                if (seal != null) snap["keys"] = Undef.V;
                entries.Add(JsonEntry("server.json", snap));
            }
        }
        // The server's Tailscale identity with the keys: restored onto a fresh install, the same node on your tailnet.
        if (Has("keys"))
        {
            byte[]? state = null;
            try { state = File.ReadAllBytes(by.TailscaleState); } catch (Exception) { /* none */ }
            if (state != null)
            {
                var t = new JsObj();
                t["state"] = Convert.ToBase64String(state);
                if (seal != null) seal["tailscale"] = t; else entries.Add(JsonEntry("tailscale.json", t));
                manifest["tailscale"] = true;
            }
        }
        if (Js.IsObject(app) && app is not null) { entries.Add(JsonEntry("app.json", app)); manifestParts.Add("app"); }
        if (Js.IsObject(page) && page is not null) { entries.Add(JsonEntry("page.json", page)); manifestParts.Add("page"); }
        if (seal != null) { entries.Add(JsonEntry("sealed.json", Seal(seal, passphrase!))); manifest["sealed"] = true; }
        string? dbCopy = null;
        try
        {
            if (Has("database"))
            {
                dbCopy = TmpFile(by.DataDir, ".db");
                CopyDatabase(dbCopy);
                if (seal != null) ScrubForSeal(dbCopy);
                entries.Add(new Entry("musicd.db", File: dbCopy));
                manifestParts.Add("database");
            }
            entries.Insert(0, JsonEntry("manifest.json", manifest));
            beforeWriting?.Invoke();
            await WriteBackup(output, entries);
        }
        finally { try { if (dbCopy != null) File.Delete(dbCopy); } catch (Exception) { /* gone */ } }
        return manifest;
    }

    /* A backup kept on the server, in its backups folder ([kind] "manual" or "auto", each kept to its own number): its record. */
    public static async Task<JsObj> Keep(Maker by, From from, Dictionary<string, bool> include, object? app, object? page, string kind, object? label, string? passphrase = null)
    {
        var store = new Store(by.DataDir);
        var id = store.NewId(kind);
        var file = store.PathFor(id);
        JsObj manifest;
        await using (var f = Private(file)) manifest = await Make(f, by, from, include, app, page, null, passphrase);
        var meta = new JsObj();
        meta["id"] = id;
        meta["kind"] = kind;
        meta["label"] = Js.Truthy(label) ? label : ((JsObj)manifest["from"]!)["name"];
        meta["created"] = manifest["created"];
        meta["version"] = manifest["version"];
        meta["parts"] = manifest["parts"];
        meta["bytes"] = (double)new FileInfo(file).Length;
        if (Js.Truthy(manifest["sealed"])) meta["sealed"] = true;
        return store.Record(meta);
    }
}
