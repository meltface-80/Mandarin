// Cpu.cs — the processor shared out as the Node server decided it (v0.8.13,
// lib/cpu.js): playback keeps a core of its own, two while DSP is in use, and
// this server keeps to the rest.
//
// The split comes with the library's state (Library.cs, every five seconds
// at most). This server's own threads then run on the cores playback doesn't
// keep, and each ffmpeg it starts goes where its kind belongs: a conversion a
// device is waiting for, or one made ahead of play just below it, on
// playback's cores; the phone's downloads on the others, at the lowest
// priority, their disk reads last. A conversion running when the split moves
// is moved with it. Until the split has come, and where nothing is split (not
// Linux, two cores, PLAYBACK_CORES=0), the priorities alone apply.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal enum CpuKind { Playback, Ahead, Background }

internal static partial class Cpu
{
    private sealed record Split(bool On, int[] Playback, int[] Background, int[] All);

    private static volatile Split plan = new(false, [], [], []);
    private static string sig = "";
    private static readonly object Moving = new();
    private static readonly ConcurrentDictionary<int, (CpuKind Kind, int[] Cores)> Children = new();
    // On a Mac (v0.8.29), nice alone, asked as lib/cpu.js asks it: BSD's has no --version.
    private static readonly Lazy<(bool Taskset, bool Nice, bool Ionice)> Tools = new(() =>
        OperatingSystem.IsLinux() ? (Have("taskset"), Have("nice"), Have("ionice"))
        : OperatingSystem.IsMacOS() ? (false, Have("nice", "-n", "0", "true"), false)
        : (false, false, false));

    /* The cores this server could use when it started, for the Node server it starts (lib/cpu.js). */
    public static readonly string Startup = Own();

    /*
     * Back on the cores it started with, as it starts again in this same
     * process (Front.StartAgain, v0.8.31): execv keeps a process's cores, and
     * the program starting again counts the machine by its own (Startup).
     * Kept to the rest of a split, it counted those alone: one core fewer
     * after every update (4, then 3 with 1 for playback, then 2 with none).
     */
    public static void Restore()
    {
        var all = Expand(Startup);
        if (all.Length > 0) PinProcess(Environment.ProcessId, all);
    }

    /* It didn't start again after all: the split kept to again with the next word of it (Follow). */
    public static void Resume() => Volatile.Write(ref sig, "");

    /* "0-2,5" → [0, 1, 2, 5] (lib/cpu.js expand). */
    public static int[] Expand(string list)
    {
        var cores = new List<int>();
        foreach (var part in (list ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var ab = part.Split('-');
            if (!int.TryParse(ab[0], NumberStyles.None, CultureInfo.InvariantCulture, out var a)) continue;
            var b = a;
            if (ab.Length > 1 && !int.TryParse(ab[1], NumberStyles.None, CultureInfo.InvariantCulture, out b)) continue;
            for (int c = a; c <= b && c < 1024; c++) cores.Add(c);
        }
        return cores.Distinct().Order().ToArray();
    }

    [LibraryImport("libc", EntryPoint = "sched_setaffinity", SetLastError = true)]
    private static unsafe partial int SetAffinity(int pid, nuint size, byte* mask);

    [LibraryImport("libc", EntryPoint = "setpriority", SetLastError = true)]
    private static partial int SetPriority(int which, int who, int prio);

    [LibraryImport("libc", EntryPoint = "gettid")]
    private static partial int GetTid();

    [LibraryImport("libc", EntryPoint = "syscall", SetLastError = true)]
    private static partial long Syscall(long number, long a, long b, long c);

    /* How many background reads at once: one per core playback doesn't keep (lib/cpu.js slots). */
    public static int Slots
    {
        get
        {
            var p = plan;
            if (p.Background.Length > 0) return p.Background.Length;
            return Math.Max(1, Environment.ProcessorCount - 1);
        }
    }

    /*
     * The calling thread at the lowest priority, its disk reads last (a
     * thread of its own, for the scan's reads: on Linux both are the
     * thread's, not the process's).
     */
    public static void LowerThisThread()
    {
        if (!OperatingSystem.IsLinux()) return;
        try
        {
            int tid = GetTid();
            SetPriority(0, tid, 19);
            // ioprio_set(IOPRIO_WHO_PROCESS, tid, best effort, level 7)
            long nr = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture switch
            {
                System.Runtime.InteropServices.Architecture.X64 => 251,
                System.Runtime.InteropServices.Architecture.Arm64 => 30,
                _ => -1
            };
            if (nr > 0) Syscall(nr, 1, tid, (2 << 13) | 7);
        }
        catch (Exception e) when (e is EntryPointNotFoundException or DllNotFoundException) { /* not Linux's libc */ }
    }

    private static string Own()
    {
        try
        {
            foreach (var line in File.ReadLines("/proc/self/status"))
                if (line.StartsWith("Cpus_allowed_list:", StringComparison.Ordinal)) return line["Cpus_allowed_list:".Length..].Trim();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* not Linux */ }
        return "";
    }

    private static bool Have(string bin, params string[] ask)
    {
        try
        {
            var psi = new ProcessStartInfo(bin) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var a in ask.Length > 0 ? ask : ["--version"]) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi);
            if (p == null) return false;
            _ = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(5000)) { try { p.Kill(); } catch (InvalidOperationException) { /* gone */ } return false; }
            return p.ExitCode == 0;
        }
        catch (Exception) { return false; }
    }

    /* [0, 1, 2, 5] → "0-2,5" (lib/cpu.js compact). */
    public static string Compact(IEnumerable<int> cores)
    {
        var s = cores.Distinct().Order().ToArray();
        var parts = new List<string>();
        for (int i = 0; i < s.Length; i++)
        {
            int j = i;
            while (j + 1 < s.Length && s[j + 1] == s[j] + 1) j++;
            parts.Add(j > i ? $"{s[i]}-{s[j]}" : s[i].ToString(CultureInfo.InvariantCulture));
            i = j;
        }
        return string.Join(",", parts);
    }

    private static string Span(int[] c) => c.Length == 1 ? "core " + c[0] : "cores " + Compact(c).Replace('-', '–');

    private static int[] Cores(JsonNode? n) =>
        n is JsonArray a ? a.Select(x => x is JsonValue v && v.TryGetValue<double>(out var d) && d >= 0 && d < 4096 && d == Math.Floor(d) ? (int)d : -1).Where(x => x >= 0).ToArray() : [];

    /* The split as the Node server sent it (/internal/library "cpu"); kept to from now on. */
    public static void Follow(JsonNode? cpu)
    {
        if (cpu is not JsonObject o || !OperatingSystem.IsLinux()) return;
        var on = o["split"] is JsonValue sv && sv.TryGetValue<bool>(out var b) && b;
        var next = new Split(on, Cores(o["playback"]), Cores(o["background"]), Cores(o["cores"]));
        if (next.On && (next.Playback.Length == 0 || next.Background.Length == 0)) return;
        var s = next.On + "|" + Compact(next.Playback) + "|" + Compact(next.Background) + "|" + Compact(next.All);
        // Asked with every request: nothing to do unless the split changed.
        if (s == Volatile.Read(ref sig)) return;
        lock (Moving)
        {
            if (s == sig) return;
            bool first = sig.Length == 0;
            Volatile.Write(ref sig, s);
            plan = next;
            // This server's own threads on the rest (all of them when nothing is split); a thread started later inherits it.
            var own = next.On ? next.Background : next.All;
            int moved = own.Length > 0 ? PinProcess(Environment.ProcessId, own) : 0;
            if (next.On && moved > 0) Front.Log($"[cpu] {Span(next.Playback)} kept for playback, {Span(next.Background)} for this server and everything else");
            else if (next.On && first) Front.Log("[cpu] couldn't move this server off playback's cores; playback comes first by priority alone");
            // A conversion running outside its cores now is moved to them.
            foreach (var (pid, c) in Children)
            {
                if (!OursStill(pid)) { Children.TryRemove(pid, out _); continue; }
                var want = next.On ? CoresFor(c.Kind) : next.All;
                if (want.Length == 0 || c.Cores.Length > 0 && c.Cores.All(x => want.Contains(x))) continue;
                if (PinProcess(pid, want) > 0) Children[pid] = (c.Kind, want);
            }
        }
    }

    private static int[] CoresFor(CpuKind kind) => kind == CpuKind.Background ? plan.Background : plan.Playback;

    /* Still running, and still this server's child (a process id is used again once it is free). */
    private static bool OursStill(int pid)
    {
        try
        {
            var stat = File.ReadAllText($"/proc/{pid}/stat");
            var rest = stat[(stat.LastIndexOf(')') + 2)..].Split(' ');
            return rest.Length > 1 && rest[0] != "Z" && int.TryParse(rest[1], out var ppid) && ppid == Environment.ProcessId;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentOutOfRangeException) { return false; }
    }

    /* Every thread of a process onto these cores; how many were moved. */
    private static unsafe int PinProcess(int pid, int[] cores)
    {
        int moved = 0;
        try
        {
            var mask = stackalloc byte[128];
            for (int i = 0; i < 128; i++) mask[i] = 0;
            foreach (var c in cores) if (c >= 0 && c < 1024) mask[c / 8] |= (byte)(1 << (c % 8));
            foreach (var dir in Directory.EnumerateDirectories($"/proc/{pid}/task"))
            {
                if (int.TryParse(Path.GetFileName(dir), out var tid) && SetAffinity(tid, 128, mask) == 0) moved++;
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or EntryPointNotFoundException or DllNotFoundException) { /* gone, or not Linux */ }
        return moved;
    }

    /*
     * An ffmpeg to be started where its kind belongs: the program and its
     * arguments put behind nice, ionice and taskset (lib/cpu.js wrap).
     */
    public static void Place(ProcessStartInfo psi, CpuKind kind)
    {
        var t = Tools.Value;
        var p = plan;
        var chain = new List<string>();
        if (kind == CpuKind.Background)
        {
            if (t.Nice) chain.AddRange(["nice", "-n", "19"]);
            if (t.Ionice) chain.AddRange(["ionice", "-c", "2", "-n", "7"]);
        }
        else if (kind == CpuKind.Ahead && t.Nice) chain.AddRange(["nice", "-n", "5"]);
        if (p.On && t.Taskset) chain.AddRange(["taskset", "-c", Compact(CoresFor(kind))]);
        if (chain.Count == 0) return;
        var args = psi.ArgumentList.ToList();
        psi.ArgumentList.Clear();
        foreach (var a in chain.Skip(1)) psi.ArgumentList.Add(a);
        psi.ArgumentList.Add(psi.FileName);
        foreach (var a in args) psi.ArgumentList.Add(a);
        psi.FileName = chain[0];
    }

    /* A process done with: no longer followed. */
    public static void Forget(Process proc)
    {
        try { Children.TryRemove(proc.Id, out _); } catch (Exception e) when (e is InvalidOperationException or ObjectDisposedException) { /* never started, or let go */ }
    }

    /* A process started after Place, followed so it moves when the split does. */
    public static void Adopt(Process proc, CpuKind kind)
    {
        int pid;
        try { pid = proc.Id; } catch (Exception e) when (e is InvalidOperationException or ObjectDisposedException) { return; }
        // Where nice isn't there to start it lower: lowered now (its first thread, at least).
        if (kind != CpuKind.Playback && !Tools.Value.Nice && OperatingSystem.IsLinux())
        {
            try { SetPriority(0, pid, kind == CpuKind.Background ? 19 : 5); } catch (Exception) { /* not allowed here */ }
        }
        var p = plan;
        Children[pid] = (kind, p.On ? CoresFor(kind) : []);
        try
        {
            proc.EnableRaisingEvents = true;
            proc.Exited += (_, _) => Children.TryRemove(pid, out _);
            if (proc.HasExited) Children.TryRemove(pid, out _);
        }
        catch (Exception e) when (e is InvalidOperationException or ObjectDisposedException) { Children.TryRemove(pid, out _); }
    }
}
