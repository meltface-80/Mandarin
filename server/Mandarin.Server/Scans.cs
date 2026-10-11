// Scans.cs — the library scans, made here in the Node server's place (v0.8.34,
// stage 1e of docs/specs/csharp-migration.md): when they run, from index.js
// and lib/library/watch.js, and the scan itself, as lib/library/scanner.js
// scanByProgram started it.
//
//   - the scan: this program again, as `mandarin-server scan` (Scan/), on the
//     cores playback doesn't keep, at the lowest priority, its reads last;
//   - when: half a second after the work is taken over, then every
//     SCAN_INTERVAL_HOURS (six), and whenever the music folders change on
//     disk — the changes gathered until they have been quiet for twenty
//     seconds, and not more than once a minute (watch.js);
//   - Rescan, Reindex and the music folders' routes (ScanRoutes.cs).
//
// The Node server keeps its own copy of the library, which playback reads, so
// it is told how a scan is going (POST /internal/library/changed, { scan }):
// its state about once a second, for the pages that still ask it; the albums
// found so far, to read again as they land; and the end, after which it does
// what followed a scan there (the library read again, the covers drawn ahead,
// the tag check, the release days and Smart Picks asked of this server), and
// after a Rescan brings Qobuz and Tidal up to date, as before.
//
// Taken over only when the Node server says so (Jobs.cs: "scan"), which it
// doesn't when told to read the tags itself (TAG_READER=node).
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Scans
{
    private static string dataDir = "", musicDir = "/music";
    private static double massRemoval = 500, scanHours = 6;
    private static readonly object Gate = new();
    private static int gen;           // the scan under way, or last made
    private static Process? proc;
    private static JsonObject state = Idle(null);
    private static Timer? first, every;
    private static Watcher? watcher;
    private static volatile bool on, stopping;

    /* The scans are made here. */
    public static bool On => on;
    /* One is under way (until it has said how it ended). */
    public static bool Running { get { lock (Gate) return state["running"] is JsonValue v && v.TryGetValue<bool>(out var r) && r; } }
    /* How it is going, as scanner.state is ({ running, progress, files, … lastResult }). */
    public static JsonObject State { get { lock (Gate) return (JsonObject)state.DeepClone(); } }
    public static string MusicDir => musicDir;
    public static string DataDir => dataDir;

    private static JsonObject Idle(JsonNode? last) => new()
    {
        ["running"] = false, ["progress"] = 0, ["files"] = 0, ["parsed"] = 0, ["errors"] = 0,
        ["startedAt"] = null, ["finishedAt"] = null, ["lastResult"] = last?.DeepClone()
    };

    private static double NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static string? Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 ? s : null;
    private static double Num(JsonNode? n, double d) => n is JsonValue v && v.TryGetValue<double>(out var x) && x > 0 ? x : d;

    /* Taken over (Jobs.cs): the Node server's settings, then the timer and the watching. A Node server started again: a scan now, as one started with it. */
    public static void Start(JsonObject cfg, string data)
    {
        dataDir = data;
        musicDir = Text(cfg["music_dir"]) ?? (Environment.GetEnvironmentVariable("MUSIC_DIR") is { Length: > 0 } m ? m : "/music");
        massRemoval = Num(cfg["mass_removal"], 500);
        scanHours = Num(cfg["scan_hours"], 6);
        stopping = false;
        if (on) { Kick(); return; }
        on = true;
        var period = TimeSpan.FromMilliseconds(Math.Min(scanHours * 3600 * 1000, uint.MaxValue - 1d));
        first = new Timer(_ => Kick(), null, 500, Timeout.Infinite);
        every = new Timer(_ => Kick(), null, period, period);
        watcher = new Watcher(Roots, () => Run(false, false), Front.Log,
            Ms("MANDARIN_WATCH_QUIET_MS", 20000), Ms("MANDARIN_WATCH_GAP_MS", 60000));
        watcher.Refresh();
        Front.Log($"[scan] the library scans are made here (every {scanHours.ToString(System.Globalization.CultureInfo.InvariantCulture)} h, and when the music folders change)");
    }

    // The watching's waits: the tests' own, else watch.js's.
    private static int Ms(string name, int d) => int.TryParse(Environment.GetEnvironmentVariable(name), out var v) && v >= 0 ? v : d;

    /* No longer made here (a Node server put back that makes them itself), or the server stopping: a scan under way ended. */
    public static void Stop()
    {
        on = false;
        stopping = true;
        first?.Dispose(); every?.Dispose();
        first = every = null;
        watcher?.Stop();
        watcher = null;
        Halt();
    }

    /* A scan under way ended now (a backup about to be put back). */
    public static void Halt()
    {
        Process? p;
        lock (Gate) p = proc;
        try { p?.Kill(); } catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { /* gone */ }
    }

    /* A scan, as the timer starts one: one already under way is left to it. */
    public static void Kick()
    {
        if (!on) return;
        _ = Run(false, false).ContinueWith(t => { if (t.IsFaulted) Front.Log("[scan] " + t.Exception!.GetBaseException().Message); }, TaskScheduler.Default);
    }

    // ---------------------------------------------------------------- the folders

    /* The music folders (index.js musicFolders, scanner.js roots()): absolute, each once, none inside another. */
    public static List<string> Roots()
    {
        JsonNode? v = null;
        try { using var c = Db.Open(); v = Db.Setting(c, "music_folders"); }
        catch (SqliteException) { /* as none chosen */ }
        var given = v is JsonArray a && a.Count > 0 ? a.Where(Js.Truthy).Select(StringOf).ToList() : [musicDir];
        var list = given.Where(r => r.Length > 0).Select(r => NodePath.Resolve(r)).Distinct(StringComparer.Ordinal).ToList();
        list.Sort(string.CompareOrdinal);
        return list.Where(r => !list.Any(o => o != r && NodePath.IsInside(r, o))).ToList();
    }

    /* String(x), for what a setting or a request holds. */
    public static string StringOf(JsonNode? n) => n switch
    {
        null => "null",
        JsonValue v when v.TryGetValue<string>(out var s) => s,
        JsonValue v when v.TryGetValue<bool>(out var b) => b ? "true" : "false",
        JsonValue v when v.TryGetValue<double>(out var d) => Tags.Js.Str(d),
        JsonArray a => string.Join(",", a.Select(x => x == null ? "" : StringOf(x))),
        _ => "[object Object]"
    };

    /* The database as the scan opens it: deleting a track takes its tags and loudness with it. */
    public static SqliteConnection OpenDb() => ScanCommand.OpenDb(dataDir);

    /* The scanner's own rules for the folders (Scan/Scanner.cs), on this database. */
    public static Scanner Scanner(SqliteConnection db) => new(db, musicDir, Roots(), massRemoval, Cpu.Slots, Front.Log);

    // ---------------------------------------------------------------- the scan

    /* What a scan came to (scanner.js scan's result), and how many albums the Node server's library has after it. */
    public sealed record Scanned(JsonObject Result, double? Count);

    /*
     * [body] (tracks taken away: a folder removed or let go) with no scan able to
     * start meanwhile, the timer's or the watcher's included (Run takes the same
     * lock): false, and nothing done, while one is under way.
     */
    public static bool WhileNoScan(Action body)
    {
        lock (Gate)
        {
            if (Running) return false;
            body();
            return true;
        }
    }

    /* A scan (scanner.js scan): { status: "running" } when one is under way; [services]: Qobuz and Tidal brought up to date after, as after Rescan. */
    public static Task<Scanned> Run(bool force, bool services)
    {
        lock (Gate)
        {
            if (Running) return Task.FromResult(new Scanned(new JsonObject { ["status"] = "running" }, null));
            var g = ++gen;
            state = Idle(state["lastResult"]);
            state["running"] = true;
            state["startedAt"] = NowMs();
            return Task.Run(() => Scan(force, services, g));
        }
    }

    /* The scan's state as it says it (the last result kept until there's a new one); only while it is the one under way. */
    private static void Mirror(JsonNode? st, int g)
    {
        if (st is not JsonObject o) return;
        lock (Gate)
        {
            if (g != gen) return;
            var last = o["lastResult"] is JsonObject lr ? lr.DeepClone() : state["lastResult"]?.DeepClone();
            var next = (JsonObject)o.DeepClone();
            next["lastResult"] = last;
            state = next;
        }
    }

    private static void Ended(int g) { lock (Gate) if (g == gen) state["running"] = false; }

    /* The Node server told how the scan is going; its answer (null when it wasn't told). */
    private static async Task<JsonObject?> Tell(JsonObject scan) => stopping ? null : await Library.Told(new JsonObject { ["scan"] = scan }, quiet: true);

    private static async Task<Scanned> Scan(bool force, bool services, int g)
    {
        // Told at once, so /api/status says so before the scan's first word.
        await Tell(new JsonObject { ["state"] = State });
        var self = Environment.ProcessPath;
        if (string.IsNullOrEmpty(self)) throw new InvalidOperationException("this program's own file isn't known");
        var psi = new ProcessStartInfo(self) { RedirectStandardInput = true, RedirectStandardOutput = true, UseShellExecute = false };
        psi.ArgumentList.Add("scan");
        Cpu.Place(psi, CpuKind.Background);
        var job = new JsonObject
        {
            ["dataDir"] = dataDir, ["root"] = musicDir,
            ["roots"] = new JsonArray(Roots().Select(r => (JsonNode)r).ToArray()),
            ["massRemoval"] = massRemoval, ["force"] = force, ["slots"] = Cpu.Slots
        };
        Process p;
        try { p = Process.Start(psi)!; }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            Ended(g);
            await Tell(new JsonObject { ["state"] = State });
            throw new InvalidOperationException("the scan didn't start: " + e.Message);
        }
        using var _p = p;
        lock (Gate) if (g == gen) proc = p;
        Cpu.Adopt(p, CpuKind.Background);
        JsonObject? result = null;
        string? error = null;
        try
        {
            try
            {
                await p.StandardInput.WriteAsync(job.ToJsonString());
                p.StandardInput.Close();
            }
            catch (IOException) { /* it has gone: said below */ }
            var lastTold = 0L;
            string? line;
            while ((line = await p.StandardOutput.ReadLineAsync()) != null)
            {
                // Nothing after the result counts (a late "running" would hold the next scan back).
                if (result != null || error != null || line.Trim().Length == 0) continue;
                JsonObject? m;
                try { m = JsonNode.Parse(line) as JsonObject; } catch (JsonException) { m = null; }
                if (m == null) { Front.Log("[scan] " + line); continue; }
                switch (Text(m["type"]))
                {
                    case "log":
                        Front.Log(Js.Str(m["line"]));
                        break;
                    case "state":
                        Mirror(m["state"], g);
                        if (Environment.TickCount64 - lastTold >= 1000)
                        {
                            lastTold = Environment.TickCount64;
                            await Tell(new JsonObject { ["state"] = State });
                        }
                        break;
                    case "progress":
                        Mirror(m["state"], g);
                        lastTold = Environment.TickCount64;
                        await Tell(new JsonObject { ["state"] = State, ["progress"] = true });
                        break;
                    case "result":
                        Mirror(m["state"], g);
                        Ended(g);
                        result = m["result"] as JsonObject ?? [];
                        break;
                    case "error":
                        Ended(g);
                        error = Js.Str(m["message"]);
                        break;
                }
            }
            await p.WaitForExitAsync();
        }
        finally
        {
            // Something here went wrong while it ran: it isn't left running unread.
            try { if (!p.HasExited) p.Kill(); } catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { /* gone */ }
            lock (Gate) if (proc == p) proc = null;
            Cpu.Forget(p);
            Ended(g);
        }
        if (error == null && result == null)
        {
            // Ended before it said: killed (the server stopping, a backup put back), or fallen over.
            var killed = p.ExitCode is 0 or 137 || stopping;
            if (killed) result = new JsonObject { ["status"] = "stopped" };
            else error = "the scan stopped (" + p.ExitCode + ")";
        }
        if (error != null)
        {
            await Tell(new JsonObject { ["state"] = State });
            throw new ScanError(error);
        }
        var told = await Tell(new JsonObject { ["state"] = State, ["done"] = true, ["services"] = services });
        if (services) result!["services"] = told?["services"]?.DeepClone() ?? new JsonArray();
        watcher?.Refresh();
        return new Scanned(result!, told?["count"] is JsonValue cv && cv.TryGetValue<double>(out var count) ? count : null);
    }

    /* Tracks were taken away here (a folder let go, or removed): the Node server reads the library again and does what follows a scan; its count. */
    public static async Task<double?> Changed(string? forgot = null)
    {
        var scan = new JsonObject { ["done"] = true };
        if (forgot != null) scan["forgot"] = forgot;
        var told = await Tell(scan);
        if (forgot != null)
        {
            lock (Gate)
            {
                if (state["lastResult"] is JsonObject last && last["offline_dirs"] is JsonArray off)
                    last["offline_dirs"] = new JsonArray(off.Where(x => NodePath.Resolve(Js.Str(x?["dir"])) != NodePath.Resolve(forgot)).Select(x => x!.DeepClone()).ToArray());
            }
        }
        return told?["count"] is JsonValue cv && cv.TryGetValue<double>(out var count) ? count : null;
    }

    // ---------------------------------------------------------------- the file system

    [LibraryImport("libc", EntryPoint = "access", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial int Access(string path, int mode);

    /* fs.accessSync(d, R_OK | X_OK) and a folder (api-library.js readable). */
    public static bool Readable(string d)
    {
        try { if (Access(d, 4 | 1) != 0) return false; }
        catch (Exception e) when (e is EntryPointNotFoundException or DllNotFoundException) { /* as .NET sees it */ }
        return NodeFs.TryStat(d, follow: true, out var st) && st.IsDirectory;
    }

    /* fs.existsSync("/.dockerenv") || !!process.env.DOCKER */
    public static bool InDocker => File.Exists("/.dockerenv") || Environment.GetEnvironmentVariable("DOCKER") is { Length: > 0 };
}

internal sealed class ScanError(string message) : Exception(message);

/*
 * The music folders watched for changes as they happen (lib/library/watch.js):
 * each folder with the file system's own notifications (inotify on Linux,
 * FSEvents on a Mac), recursively. Events are gathered, and a scan starts once
 * they have been quiet for [quietMs] (and at most once every [minGapMs]). The
 * scan is the ordinary one, so a flood of events costs one scan. What the file
 * system doesn't report (a change on a network share made from another
 * machine) still waits for the timer or Rescan library.
 */
internal sealed partial class Watcher(Func<List<string>> roots, Func<Task> onChange, Action<string> log, int quietMs = 20000, int minGapMs = 60000)
{
    private readonly object gate = new();
    private readonly Dictionary<string, FileSystemWatcher> watchers = new(StringComparer.Ordinal);
    private Timer? timer;
    private long lastRun;
    private int pending;
    private bool running, unsupported, stopped;
    private (string Dir, string Name)? last;

    [GeneratedRegex(@"(^|/)(\.|@eaDir|#recycle|\.Trash)")]
    private static partial Regex Ignored();

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /* Every music folder that exists watched; folders gone let go. */
    public void Refresh()
    {
        List<string> want;
        try { want = roots().Where(d => NodeFs.TryStat(d, follow: true, out var st) && st.IsDirectory).ToList(); }
        catch (Exception e) when (e is IOException or SqliteException) { return; }
        lock (gate)
        {
            if (stopped) return;
            foreach (var (dir, w) in watchers.ToList())
            {
                if (want.Contains(dir)) continue;
                w.Dispose();
                watchers.Remove(dir);
            }
            foreach (var dir in want) if (!watchers.ContainsKey(dir)) Add(dir);
        }
    }

    private void Add(string dir)
    {
        FileSystemWatcher w;
        try
        {
            w = new FileSystemWatcher(dir) { IncludeSubdirectories = true, InternalBufferSize = 64 * 1024 };
            w.Created += (_, e) => Saw(dir, e.Name);
            w.Changed += (_, e) => Saw(dir, e.Name);
            w.Deleted += (_, e) => Saw(dir, e.Name);
            w.Renamed += (_, e) => Saw(dir, e.Name);
            w.Error += (_, e) =>
            {
                // Too many changes at once for the buffer: some were missed, so read anyway.
                if (e.GetException() is InternalBufferOverflowException) { Saw(dir, null); return; }
                log($"[watch] {dir}: {e.GetException().Message}");
                lock (gate) { if (watchers.Remove(dir)) w.Dispose(); }
            };
            w.EnableRaisingEvents = true;
        }
        catch (Exception e) when (e is IOException or ArgumentException or PlatformNotSupportedException or UnauthorizedAccessException)
        {
            // Not offered everywhere (a file system without notifications, too many folders for the
            // system's limit): the timer and Rescan library remain.
            if (!unsupported) { unsupported = true; log($"[watch] not watching {dir}: {e.Message}"); }
            return;
        }
        watchers[dir] = w;
        log($"[watch] watching {dir}");
    }

    private void Saw(string dir, string? name)
    {
        var rel = name ?? "";
        if (rel.Length > 0 && Ignored().IsMatch(rel)) return;
        lock (gate)
        {
            if (stopped) return;
            // Partial files being written (a copy under way) still count: the scan waits for quiet.
            pending++;
            last = (dir, rel);
            Arm();
        }
    }

    private void Arm()
    {
        timer?.Dispose();
        var wait = Math.Max(quietMs, minGapMs - (Now() - lastRun));
        timer = new Timer(_ => Fire(), null, wait, Timeout.Infinite);
    }

    private void Fire()
    {
        int n;
        (string Dir, string Name)? l;
        lock (gate)
        {
            timer?.Dispose();
            timer = null;
            if (stopped) return;
            if (running) { Arm(); return; }
            n = pending;
            pending = 0;
            lastRun = Now();
            running = true;
            l = last;
        }
        log($"[watch] {n} change{(n == 1 ? "" : "s")} in the music folders{(l is { Name.Length: > 0 } x ? $" (last: {NodePath.Join(x.Dir, x.Name)})" : "")}: reading");
        _ = Task.Run(async () =>
        {
            try { await onChange(); }
            catch (Exception e) { log("[watch] " + e.Message); }
            lock (gate)
            {
                running = false;
                if (pending > 0 && !stopped) Arm();
            }
        });
    }

    public void Stop()
    {
        lock (gate)
        {
            stopped = true;
            timer?.Dispose();
            timer = null;
            foreach (var w in watchers.Values) w.Dispose();
            watchers.Clear();
        }
    }
}
