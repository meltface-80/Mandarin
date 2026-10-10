// ScanRoutes.cs — Rescan, Reindex and the music folders (v0.8.32, stage 1e of
// docs/specs/csharp-migration.md), from lib/server/api-library.js, in the
// same shapes and words, once the scans are made here (Scans.cs):
//
//   POST /api/library/rescan          Rescan library, from the side menu
//   POST /api/reindex                 every file read again, waited for
//   POST /api/library/forget-folder   a missing folder, kept until now, let go
//   GET  /api/library/folders         Settings → Music folders
//   POST /api/library/folders         one added { add } or removed { remove }
//   GET  /api/library/browse          one folder's folders, for choosing one
//   GET  /api/music-mount             whether the music is there
//   GET  /api/search-status           how far the library has been read
//
// Clean up stays the Node server's: Qobuz's and Tidal's albums are its.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;

namespace Mandarin.Server;

internal static partial class Library
{
    private static readonly string[] Never = ["/proc", "/sys", "/dev", "/run", "/etc", "/boot"];
    // At the top: the system's own folders, never music — what's left is where drives are
    // (mnt, media, music, srv, home…). On a Mac that leaves Users and Volumes.
    [GeneratedRegex(@"^(bin|sbin|lib|lib32|lib64|libx32|usr|var|opt|tmp|app|lost\+found|snap|sys|proc|dev|run|etc|boot|Applications|Library|System|private|cores|nix|sw)$|\.usr-is-merged$")]
    private static partial Regex RootHide();
    private const string ScanUnderWay = "A scan is running — try again when it's done";
    private static readonly Dictionary<string, string> RescanWords = new() { ["updated"] = "rebuilt", ["unchanged"] = "fresh", ["running"] = "busy" };

    /* The scan routes: true when answered here. */
    private static async Task<bool> ScanRoute(HttpContext ctx)
    {
        if (!Scans.On) return false;
        var m = ctx.Request.Method;
        var p = ctx.Request.Path.Value ?? "";
        bool get = HttpMethods.IsGet(m) || HttpMethods.IsHead(m), post = HttpMethods.IsPost(m);
        try
        {
            return get && p == "/api/music-mount" ? await MusicMount(ctx)
                : get && p == "/api/search-status" ? await SearchStatus(ctx)
                : get && p == "/api/library/folders" ? await Folders(ctx)
                : get && p == "/api/library/browse" ? await Browse(ctx)
                : post && p == "/api/library/folders" ? await ChangeFolders(ctx)
                : post && p == "/api/library/rescan" ? await Rescan(ctx)
                : post && p == "/api/reindex" ? await Reindex(ctx)
                : post && p == "/api/library/forget-folder" && await ForgetFolder(ctx);
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            // As the Node server's wrap() answers what throws.
            Front.Log($"[scan] {p}: {e.GetType().Name}: {e.Message}");
            return await Send(ctx, new JsonObject { ["error"] = e.Message }, 500);
        }
    }

    private static Task<bool> MusicMount(HttpContext ctx)
    {
        var roots = Scans.Roots();
        return Send(ctx, new JsonObject
        {
            ["mounted"] = roots.Any(NodeFs.Exists), ["path"] = Scans.MusicDir,
            ["paths"] = new JsonArray(roots.Select(r => (JsonNode)r).ToArray())
        });
    }

    private static async Task<bool> SearchStatus(HttpContext ctx)
    {
        if (await Current() is not var (s, st)) return false;
        var state = Scans.State;
        var running = Js.Truthy(state["running"]);
        var o = new JsonObject
        {
            ["indexed"] = s.Count, ["building"] = running, ["progress"] = state["progress"]?.DeepClone(),
        };
        // library.builtAt: left out while there's none.
        if (st.BuiltAt is { } built) o["builtAt"] = built;
        o["ready"] = s.Count > 0 || !running;
        o["count"] = s.Count;
        return await Send(ctx, o);
    }

    /* The music folders as Settings shows them (api-library.js folderList). */
    private static JsonArray FolderList(Scanner sc)
    {
        var dflt = NodePath.Resolve(Scans.MusicDir);
        return new JsonArray(sc.Roots().Select(d => (JsonNode)new JsonObject
        {
            ["path"] = d, ["name"] = NodePath.Basename(d) is { Length: > 0 } b ? b : d,
            ["exists"] = NodeFs.Exists(d), ["readable"] = Scans.Readable(d),
            ["tracks"] = sc.CountUnder(d), ["default"] = d == dflt
        }).ToArray());
    }

    private static Task<bool> Folders(HttpContext ctx)
    {
        var mounts = Mounts.MusicMounts(Scans.DataDir);
        var docker = Scans.InDocker;
        JsonArray folders;
        using (var db = Scans.OpenDb()) folders = FolderList(Scans.Scanner(db));
        foreach (var f in folders.OfType<JsonObject>())
            f["hint"] = Mounts.HintFor(Js.Str(f["path"]), mounts, Js.Truthy(f["exists"]) ? 1 : 0, docker);
        // The drives and shares this server can see — where to start looking.
        return Send(ctx, new JsonObject
        {
            ["folders"] = folders, ["mounts"] = new JsonArray(mounts.Select(x => (JsonNode)x.ToJson()).ToArray()),
            ["music_dir"] = Scans.MusicDir, ["docker"] = docker, ["scanning"] = Scans.Running
        });
    }

    // localeCompare(b, undefined, { sensitivity: "base", numeric: true })
    private static int BaseNumeric(string a, string b) => Math.Sign(Collation.Compare(a, b,
        CompareOptionsBase | System.Globalization.CompareOptions.NumericOrdering));
    private const System.Globalization.CompareOptions CompareOptionsBase =
        System.Globalization.CompareOptions.IgnoreCase | System.Globalization.CompareOptions.IgnoreNonSpace
        | System.Globalization.CompareOptions.IgnoreKanaType | System.Globalization.CompareOptions.IgnoreWidth;

    private static Task<bool> Browse(HttpContext ctx)
    {
        var d = NodePath.Resolve(Q(ctx, "path") is { Length: > 0 } q ? q : "/");
        List<Entry> entries;
        try { entries = NodeFs.ReadDir(d); }
        catch (IOException e) { return Send(ctx, new JsonObject { ["error"] = "Can't open " + d + (e.Message.StartsWith("EACCES", StringComparison.Ordinal) ? " — no permission" : "") }, 400); }
        var dirs = new List<(string Name, string Path)>();
        foreach (var e in entries)
        {
            if (e.Name.StartsWith('.')) continue;
            var full = NodePath.Join(d, e.Name);
            var isDir = e.Type == EntryType.Dir;
            if (!isDir && e.Type == EntryType.Link) isDir = NodeFs.TryStat(full, follow: true, out var st) && st.IsDirectory;
            if (isDir && !Never.Contains(full) && !(d == "/" && RootHide().IsMatch(e.Name))) dirs.Add((e.Name, full));
        }
        dirs = dirs.OrderBy(x => x.Name, Comparer<string>.Create(BaseNumeric)).ToList();
        return Send(ctx, new JsonObject
        {
            ["path"] = d, ["parent"] = d == "/" ? null : NodePath.Dirname(d),
            ["dirs"] = new JsonArray(dirs.Take(1000).Select(x => (JsonNode)new JsonObject { ["name"] = x.Name, ["path"] = x.Path }).ToArray()),
            ["watched"] = new JsonArray(Scans.Roots().Select(r => (JsonNode)r).ToArray()),
            ["hint"] = Mounts.HintFor(d, Mounts.MusicMounts(Scans.DataDir), entries.Count(x => !x.Name.StartsWith('.')), Scans.InDocker)
        });
    }

    private static async Task<bool> ChangeFolders(HttpContext ctx)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var now = Scans.Roots();
        if (Js.Truthy(b["add"]))
        {
            var d = NodePath.Resolve(Scans.StringOf(b["add"]));
            if (d == "/" || Never.Any(n => d == n || d.StartsWith(n + "/", StringComparison.Ordinal)))
                return await Send(ctx, new JsonObject { ["error"] = "Not that folder — choose the one your music is in" }, 400);
            var data = NodePath.Resolve(Scans.DataDir);
            if (data == d || d.StartsWith(data + "/", StringComparison.Ordinal))
                return await Send(ctx, new JsonObject { ["error"] = "That's Mandarin's own data folder" }, 400);
            if (!Scans.Readable(d))
                return await Send(ctx, new JsonObject { ["error"] = "Can't read " + d + (File.Exists("/.dockerenv") ? " — is it mounted into the container?" : "") }, 400);
            var outer = now.FirstOrDefault(r => d == r || d.StartsWith(r + "/", StringComparison.Ordinal));
            if (outer != null) return await Send(ctx, new JsonObject { ["error"] = "Already in the library, as part of " + outer }, 400);
            // A folder around ones already watched takes their place: the same files, the same paths.
            var next = now.Where(r => !r.StartsWith(d + "/", StringComparison.Ordinal)).Append(d).ToList();
            SetFolders(next);
        }
        else if (Js.Truthy(b["remove"]))
        {
            var d = NodePath.Resolve(Scans.StringOf(b["remove"]));
            if (!now.Contains(d)) return await Send(ctx, new JsonObject { ["error"] = "Not one of the music folders" }, 404);
            if (now.Count == 1) return await Send(ctx, new JsonObject { ["error"] = "It's the only music folder — add another first" }, 400);
            if (Scans.Running) return await Send(ctx, new JsonObject { ["error"] = ScanUnderWay }, 409);
            SetFolders(now.Where(r => r != d).ToList());
            int n;
            JsonArray folders;
            using (var db = Scans.OpenDb())
            {
                var sc = Scans.Scanner(db);
                n = sc.RemoveUnder(d);
                folders = FolderList(sc);
            }
            var count = await Scans.Changed();
            return await Send(ctx, new JsonObject { ["ok"] = true, ["removed"] = n, ["folders"] = folders, ["count"] = count ?? await CountNow() });
        }
        else return await Send(ctx, new JsonObject { ["error"] = "add or remove" }, 400);
        // Read the new folder now (after a scan already going); its albums appear as the scan goes.
        static async Task Kick()
        {
            while (Scans.On && Scans.Running) await Task.Delay(5000);
            try { await Scans.Run(false, true); } catch (Exception e) { Front.Log("[scan] " + e.Message); }
        }
        _ = Kick();
        JsonArray list;
        using (var db = Scans.OpenDb()) list = FolderList(Scans.Scanner(db));
        return await Send(ctx, new JsonObject { ["ok"] = true, ["folders"] = list, ["scanning"] = true });
    }

    private static void SetFolders(List<string> folders)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$k", "music_folders");
        cmd.Parameters.AddWithValue("$v", Tags.Js.Json(folders.Cast<object?>().ToList())!);
        cmd.ExecuteNonQuery();
    }

    /* library.count, should the Node server not have said it. */
    private static async Task<double> CountNow() => await Current() is var (s, _) ? s.Count : 0;

    /*
     * Rescan library, from the side menu, answered in the page's words: "rebuilt"
     * (something changed), "fresh" (nothing had), "scanning" (still going after
     * 8 s — the page then waits on /api/status), "busy" (a scan was already
     * running), "no-music".
     */
    private static async Task<bool> Rescan(HttpContext ctx)
    {
        if (Scans.Running) return await Send(ctx, new JsonObject { ["status"] = "busy", ["progress"] = Scans.State["progress"]?.DeepClone() });
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var run = Scans.Run(Js.Truthy(b["force"]), true);
        // A big first scan takes minutes: answered at once, and the page polls.
        if (await Task.WhenAny(run, Task.Delay(8000)) != run)
        {
            _ = run.ContinueWith(t => { if (t.IsFaulted) Front.Log("[scan] " + t.Exception!.GetBaseException().Message); }, TaskScheduler.Default);
            return await Send(ctx, new JsonObject { ["status"] = "scanning", ["progress"] = Scans.State["progress"]?.DeepClone() });
        }
        var (r, count) = await run;
        var o = (JsonObject)r.DeepClone();
        var status = Js.Str(r["status"]);
        o["status"] = RescanWords.TryGetValue(status, out var w) ? w : r["status"]?.DeepClone();
        o["count"] = count ?? await CountNow();
        o["scan_status"] = r["status"]?.DeepClone();
        return await Send(ctx, o);
    }

    private static async Task<bool> Reindex(HttpContext ctx)
    {
        var (r, count) = await Scans.Run(true, true);
        var o = new JsonObject { ["ok"] = true, ["indexed"] = count ?? await CountNow() };
        foreach (var (k, v) in r) o[k] = v?.DeepClone();
        return await Send(ctx, o);
    }

    /* A missing music folder, kept until now: forgotten (scanner.js forget), its albums gone. */
    private static async Task<bool> ForgetFolder(HttpContext ctx)
    {
        if (Scans.Running) return await Send(ctx, new JsonObject { ["error"] = ScanUnderWay }, 409);
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var d = NodePath.Resolve(Js.Truthy(b["dir"]) ? Scans.StringOf(b["dir"]) : "");
        int n;
        bool present;
        try
        {
            if (!Scans.Roots().Any(r => d == r || NodePath.Dirname(d) == r)) throw new ScanError("Not one of the music folders");
            try { present = NodeFs.ReadDir(d).Any(e => !e.Name.StartsWith('.')); } catch (IOException) { present = false; }
            using var db = Scans.OpenDb();
            n = Scans.Scanner(db).RemoveUnder(d, present ? (p => !NodeFs.Exists(p)) : null);
        }
        catch (Exception e) when (e is ScanError or Microsoft.Data.Sqlite.SqliteException)
        {
            return await Send(ctx, new JsonObject { ["error"] = e.Message }, 400);
        }
        Front.Log($"[scan] forgot {d}{(present ? " (files no longer there)" : "")}: {n} tracks removed");
        var count = await Scans.Changed(d);
        return await Send(ctx, new JsonObject { ["ok"] = true, ["removed"] = n, ["count"] = count ?? await CountNow() });
    }
}
