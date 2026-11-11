// Watcher.cs — the music folders followed as they change (lib/library/watch.js; item 356): a folder's changes read by the
// ordinary scan, so a flood of them costs one scan.
//
//   - Heard: each folder with the file system's own notifications (inotify; FSEvents on a Mac), recursively.
//   - Looked at: a folder whose changes the file system doesn't report here — a network share (SMB, NFS: a change made
//     from another machine is never told), a FUSE folder (mergerfs, rclone: a change made under it isn't either), or one
//     whose notifications couldn't be had (more folders than the system's limit) — has its folders' times looked at every
//     [pollMs], and any that moved is a change.
//   - When: once the changes have been quiet for [quietMs] (an album deleted, read a moment later); while they keep coming
//     (a long copy, album after album) no later than [maxWaitMs] after the first, so each album shows as it is copied in,
//     not when the whole copy ends; never sooner than [minGapMs] after the last scan began.
//
// Before item 356 the wait began again with every change, so a copy that never paused for twenty seconds was read only
// once it had ended, and a network share's changes waited for the six-hourly scan or Rescan library.
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal sealed partial class Watcher(Func<List<string>> roots, Func<Task> onChange, Action<string> log,
    int quietMs = Watcher.QuietMs, int minGapMs = Watcher.GapMs, int maxWaitMs = Watcher.GapMs, int pollMs = Watcher.PollMs, bool notify = true)
{
    /* The waits as they are unless the tests set their own: quiet, the least between scans, and the folders looked at. */
    public const int QuietMs = 5000, GapMs = 30000, PollMs = 30000;

    private readonly object gate = new();
    private readonly Dictionary<string, FileSystemWatcher> watchers = new(StringComparer.Ordinal);
    // The folders looked at, and what their folders' times came to when last looked at (null: not yet).
    private readonly Dictionary<string, long?> looked = new(StringComparer.Ordinal);
    private Timer? timer, poll, remount;
    // The drives mounted in the music folders when last read (null: not yet): one mounted or let go since is heard anew.
    private string? mountsThen;
    private long lastRun, firstPending;
    private int pending, polling;
    private bool running, stopped;
    private readonly HashSet<string> unheard = new(StringComparer.Ordinal);
    private (string Dir, string Name)? last;

    [GeneratedRegex(@"(^|/)(\.|@eaDir|#recycle|\.Trash)")]
    private static partial Regex Ignored();

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /* Every music folder that exists followed; folders gone let go. */
    public void Refresh()
    {
        List<string> want;
        try { want = roots().Where(d => PosixFs.TryStat(d, follow: true, out var st) && st.IsDirectory).ToList(); }
        catch (Exception e) when (e is IOException or SqliteException) { return; }
        var mounts = Mounts.Read();
        lock (gate)
        {
            if (stopped) return;
            foreach (var (dir, w) in watchers.ToList())
            {
                if (want.Contains(dir)) continue;
                w.Dispose();
                watchers.Remove(dir);
            }
            foreach (var dir in looked.Keys.ToList()) if (!want.Contains(dir)) looked.Remove(dir);
            unheard.RemoveWhere(d => !want.Contains(d));
            // A drive mounted in a music folder after it was followed (the machine slower than the server at a start):
            // what was heard was the empty folder under it. Each folder heard again, looked at afresh, and read now.
            var now = string.Join("\n", mounts.Where(m => want.Any(d => m.Point.StartsWith(d.TrimEnd('/') + "/", StringComparison.Ordinal)))
                .Select(m => m.Point + " " + m.Type).Order(StringComparer.Ordinal));
            if (mountsThen != null && now != mountsThen)
            {
                log("[watch] a drive mounted or let go in the music folders: heard again, and read");
                foreach (var dir in want.Where(watchers.ContainsKey).ToList()) { watchers[dir].Dispose(); watchers.Remove(dir); }
                foreach (var dir in looked.Keys.ToList()) looked[dir] = null;
                pending++; last = null; if (firstPending == 0) firstPending = Now(); Arm();
            }
            mountsThen = now;
            foreach (var dir in want)
            {
                if (notify && !watchers.ContainsKey(dir) && !unheard.Contains(dir)) Add(dir);
                var why = !notify ? "looked at" : unheard.Contains(dir) ? "its changes can't be heard here" : Mounts.Unheard(mounts, dir);
                if (why != null && !looked.ContainsKey(dir)) { looked[dir] = null; log($"[watch] looking at {dir} every {pollMs / 1000.0:0.#} s ({why})"); }
            }
            if (looked.Count > 0 && poll == null) poll = new Timer(_ => Look(), null, 0, pollMs);
            if (looked.Count == 0) { poll?.Dispose(); poll = null; }
            remount ??= new Timer(_ => Refresh(), null, pollMs, pollMs);   // the mounts read again, as often as a share is looked at
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
                lock (gate) { if (watchers.Remove(dir)) w.Dispose(); unheard.Add(dir); }
                Refresh();   // looked at instead
            };
            w.EnableRaisingEvents = true;
        }
        catch (Exception e) when (e is IOException or ArgumentException or PlatformNotSupportedException or UnauthorizedAccessException)
        {
            // Not offered everywhere (a file system without notifications, too many folders for the system's limit): looked at.
            log($"[watch] not hearing {dir}: {e.Message}");
            unheard.Add(dir);
            return;
        }
        watchers[dir] = w;
        log($"[watch] watching {dir}");
    }

    // The folders looked at: each one's folders' times summed up, a change where the sum moved.
    private void Look()
    {
        if (Interlocked.Exchange(ref polling, 1) == 1) return;   // the last look still going (a slow share)
        try
        {
            List<string> dirs;
            lock (gate) { if (stopped) return; dirs = looked.Keys.ToList(); }
            foreach (var dir in dirs)
            {
                var sum = Sum(dir);
                lock (gate)
                {
                    if (!looked.TryGetValue(dir, out var was)) continue;
                    looked[dir] = sum;
                    if (was != null && was != sum) { pending++; last = (dir, ""); if (firstPending == 0) firstPending = Now(); Arm(); }
                }
            }
        }
        finally { Volatile.Write(ref polling, 0); }
    }

    /* What [root]'s folders' times come to: every folder under it, its path and its time (a file added, removed or renamed
       moves its folder's time); folders the watcher ignores left out. */
    internal static long Sum(string root)
    {
        long sum = 17;
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var d = stack.Pop();
            if (!PosixFs.TryStat(d, follow: true, out var st) || !st.IsDirectory) continue;
            sum = unchecked(sum * 31 + StringComparer.Ordinal.GetHashCode(d) ^ (long)st.MtimeMs);
            IEnumerable<string> subs;
            try { subs = Directory.EnumerateDirectories(d).ToList(); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { continue; }
            foreach (var s in subs.Order(StringComparer.Ordinal))
                if (!Ignored().IsMatch(Path.GetFileName(s))) stack.Push(s);
        }
        return sum;
    }

    private void Saw(string dir, string? name)
    {
        var rel = name ?? "";
        if (rel.Length > 0 && Ignored().IsMatch(rel)) return;
        lock (gate)
        {
            if (stopped) return;
            // Partial files being written (a copy under way) still count: read again once they are whole.
            pending++;
            last = (dir, rel);
            if (firstPending == 0) firstPending = Now();
            Arm();
        }
    }

    // Under gate: the scan set for once the changes are quiet, or have waited long enough, and the gap is over.
    private void Arm()
    {
        timer?.Dispose();
        var now = Now();
        var due = Math.Max(lastRun + minGapMs, Math.Min(now + quietMs, firstPending + maxWaitMs));
        timer = new Timer(_ => Fire(), null, Math.Max(0, due - now), Timeout.Infinite);
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
            firstPending = 0;
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
            poll?.Dispose();
            poll = null;
            remount?.Dispose();
            remount = null;
            foreach (var w in watchers.Values) w.Dispose();
            watchers.Clear();
        }
    }
}

/* The machine's mounts (Mounts.cs), to tell a folder whose changes the file system won't report here (item 356). */
internal static partial class Mounts
{
    // Network file systems: a change made from another machine is never told here.
    private static readonly HashSet<string> Network = new(StringComparer.Ordinal)
        { "cifs", "smb3", "smbfs", "nfs", "nfs4", "9p", "ceph", "glusterfs", "davfs", "afs", "coda", "ncpfs", "virtiofs" };

    /* Each mount point and what is mounted there last (mounted over: the last is what's seen), the deepest first; none
       where the machine doesn't say (a Mac). */
    public static List<(string Point, string Type)> Read()
    {
        string text;
        // MANDARIN_MOUNTINFO: another mount table in its place, for the tests (a drive can't be mounted there).
        try { text = File.ReadAllText(Environment.GetEnvironmentVariable("MANDARIN_MOUNTINFO") is { Length: > 0 } f ? f : "/proc/self/mountinfo"); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return []; }
        var at = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var m in Parse(text)) at[m.Point] = m.Type;
        return at.Select(kv => (kv.Key, kv.Value)).OrderByDescending(m => m.Key.Length).ToList();
    }

    /* Why [dir]'s changes can't all be heard here (its file system named), or null where they can. */
    public static string? Unheard(List<(string Point, string Type)> mounts, string dir)
    {
        static string? Why(string type) =>
            Network.Contains(type) ? $"a network share ({type})" : type.StartsWith("fuse", StringComparison.Ordinal) && type != "fuseblk" ? $"a FUSE folder ({type})" : null;
        var full = NodePath.Resolve(dir);
        // A share mounted inside it (a local /mnt with a NAS at /mnt/nas): its changes aren't heard either.
        foreach (var (point, type) in mounts)
            if (point.StartsWith(full.TrimEnd('/') + "/", StringComparison.Ordinal) && Why(type) is { } inside) return inside + " in it, at " + point;
        foreach (var (point, type) in mounts)
            if (full == point || point == "/" || full.StartsWith(point.TrimEnd('/') + "/", StringComparison.Ordinal)) return Why(type);
        return null;
    }
}
