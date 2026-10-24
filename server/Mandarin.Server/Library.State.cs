// Library.State.cs — the library's state, this server's own (v0.8.50, stage 7
// part 1 of old/csharp-migration.md): what GET /internal/library said
// when a Node server stood behind this one, counted and read here. The
// version and the marks move with each change (Told, LibraryChanges.cs): the
// copy here is read again (Library.Copy.cs).
// The scan's state is Scans.cs's, the label rules are the settings', the day
// and the week are this clock's (the container's time zone, as the Node
// server's were), the address is the configuration's.
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Library
{
    // This run of the server (the Node server's bootId), the counters, when the copy was last read.
    private static readonly string boot = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
    public static string Boot => boot;
    private static long version, marks;
    private static double? builtAt;
    private static string? serverIp;
    private static int port;

    /* The state set up (Program.cs): the key the tests' private addresses are asked with, the address given out. */
    public static void InitAlone(string key, string? ip, int p)
    {
        serverIp = ip;
        port = p;
        Init(key);
    }

    /* The library's version now, as the Node server counted it (Services/: what is kept no longer than the library stays). */
    private static LibState LocalState()
    {
        var scan = Scans.State;
        var running = scan["running"] is JsonValue rv && rv.TryGetValue<bool>(out var r) && r;
        bool labelsOn = false;
        var depth = 0;
        try
        {
            using var c = Db.Open();
            labelsOn = Js.Truthy(Db.Setting(c, "labelsEnabled"));
            // parseInt(v, 10) || 0, kept to 0–6 (api-library.js labelRules).
            var d = Js.ParseInt(Db.Setting(c, "labelFolderDepth"));
            depth = d == int.MinValue ? 0 : (int)Math.Max(0, Math.Min(6, d));
        }
        catch (Microsoft.Data.Sqlite.SqliteException) { /* as none set */ }
        var now = DateTime.Now;
        return new LibState(boot, Interlocked.Read(ref version), Interlocked.Read(ref marks), running && (current?.Count ?? 0) == 0, scan["progress"]?.DeepClone(), labelsOn, depth, Scans.Roots())
        {
            Day = DayKey(now), DayStart = DayStart(now), Week = WeekKey(now), BaseUrl = LocalBaseUrl(), Scanning = running, BuiltAt = builtAt
        };
    }

    /* ctx.baseUrl(): the address speakers and phones are given. */
    private static string LocalBaseUrl() =>
        Playback.Hub.Current is { } hub ? hub.BaseUrl : $"http://{serverIp ?? Playback.Jv.Str(Playback.Topology.LocalIp(null, Tags.Undef.V))}:{port}";

    /* library.dayKey: the album of the day's day ("2026-10-3"), turning over at 00:01, so a minute is taken off. */
    private static string DayKey(DateTime now)
    {
        var d = now.AddMinutes(-1);
        return $"{d.Year}-{d.Month}-{d.Day}";
    }

    /* library.dayStart: when that day began, today's 00:01 (yesterday's, in the minute after midnight). */
    private static long DayStart(DateTime now)
    {
        var d = now.AddMinutes(-1);
        return new DateTimeOffset(new DateTime(d.Year, d.Month, d.Day, 0, 1, 0, DateTimeKind.Local)).ToUnixTimeMilliseconds();
    }

    /* library.weekKey: the ISO week ("2026-W41") of today's date. */
    private static string WeekKey(DateTime now)
    {
        var t = new DateTime(now.Year, now.Month, now.Day, 0, 0, 0, DateTimeKind.Utc);
        var dow = (int)t.DayOfWeek;
        t = t.AddDays(4 - (dow == 0 ? 7 : dow));
        var yStart = new DateTime(t.Year, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        return $"{t.Year}-W{(int)Math.Ceiling(((t - yStart).TotalDays + 1) / 7)}";
    }

    /*
     * POST /internal/library/changed from this machine with the front key
     * (stage 7 part 2): a test that changed the database by hand says so, and
     * the copy is read again. Before the gate, as the other /internal/
     * addresses are (Jobs.Internal.cs).
     */
    public static void UseInternal(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            if (ctx.Request.Path.Value != "/internal/library/changed") { await next(); return; }
            var from = ctx.Connection.RemoteIpAddress;
            var given = ctx.Request.Headers["X-Mandarin-Front-Key"].ToString();
            if (from == null || !System.Net.IPAddress.IsLoopback(from) || !HttpMethods.IsPost(ctx.Request.Method)
                || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(given), System.Text.Encoding.UTF8.GetBytes(frontKey)))
            {
                ctx.Response.StatusCode = 404;
                return;
            }
            JsonObject? what = null;
            try { what = await System.Net.Http.Json.HttpContentJsonExtensions.ReadFromJsonAsync<JsonObject>(new StreamContent(ctx.Request.Body)); }
            catch (System.Text.Json.JsonException) { /* no body: nothing but a word */ }
            // Told as a job's step ("background") or as a change someone waits for; then, unless a step, the copy
            // with it waited for; and the copies read so far.
            var background = Js.Truthy(what?["background"]);
            var said = await LocalTold(what ?? [], background);
            if (!background) await Fresh();
            said["reads"] = Reads;
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsync(said.ToJsonString());
        });
    }

    /*
     * A change told (the Node server's /internal/library/changed, api-library.js
     * libraryChanged): a mark moved the marks, anything else the version (the
     * copy read again), and a scan's end what follows a scan; its answer.
     * [soon], and a scan's steps: read in the background (Library.Copy.cs).
     */
    private static async Task<JsonObject> LocalTold(JsonObject what, bool soon = false)
    {
        var keys = what.Select(kv => kv.Key).ToList();
        var scan = what["scan"] as JsonObject;
        var reload = keys.Any(k => k is "edits" or "merges" or "labels" or "lookups" or "days" or "services")
            || (scan != null && (Js.Truthy(scan["progress"]) || Js.Truthy(scan["done"])));
        if (Js.Truthy(what["marks"])) Interlocked.Increment(ref marks);
        // An album edit made or dropped: album-edits.json written again (db.backupEdits), so a database that has to start over gets it back.
        if (keys.Contains("edits"))
        {
            try { using var c = Db.Open(); Admin.Backup.ExportEdits(c, Path.GetDirectoryName(Db.File) ?? "."); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or Microsoft.Data.Sqlite.SqliteException) { Server.Log($"[musicd] couldn't write album-edits.json: {e.Message}"); }
        }
        if (reload) Moved(soon || (scan != null && !Js.Truthy(scan["done"])));
        var o = new JsonObject { ["ok"] = true, ["version"] = Interlocked.Read(ref version), ["marks"] = Interlocked.Read(ref marks) };
        if (scan != null && Js.Truthy(scan["done"]))
        {
            // ctx.afterScan: the release days and today's Smart Picks; the services brought up to date after a Rescan.
            await Jobs.AfterScan();
            // After a Rescan, the services signed in with their import on are brought up to date, and named (syncServicesAfter).
            var follow = Js.Truthy(scan["services"]) && Jobs.Holds("import") ? Mandarin.Server.Services.Import.Services().Where(Mandarin.Server.Services.Import.Wants).Select(x => x.Name).ToList() : [];
            if (follow.Count > 0) Mandarin.Server.Services.Import.Now(null, afterRescan: true);
            o["count"] = (await Current())?.Item1.Count ?? 0;
            o["services"] = new JsonArray(follow.Select(n => (JsonNode?)n).ToArray());
        }
        return o;
    }
}
