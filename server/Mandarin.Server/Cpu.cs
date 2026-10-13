// Cpu.cs — the processor shared out (v0.8.13, lib/cpu.js): playback keeps a
// core of its own, two while DSP is in use, and this server keeps to the rest.
//
// Decided here since v0.8.48 (stage 5 part 4), as lib/cpu.js decided it: from
// the cores this server could use when it started and PLAYBACK_CORES /
// PLAYBACK_CORE, the DSP conversions under way counted and playback's second
// core kept ten minutes after the last. The job "cpu" (Jobs.cs).
//
// This server's own threads run on the cores playback doesn't keep, and each
// ffmpeg it starts goes where its kind belongs: a conversion a device is
// waiting for, or one made ahead of play just below it, on playback's cores;
// the phone's downloads on the others, at the lowest priority, their disk
// reads last. A conversion running when the split moves is moved with it.
// Until a split has come, and where nothing is split (not Linux, two cores,
// PLAYBACK_CORES=0), the priorities alone apply.
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

    /* The cores this server could use when it started (lib/cpu.js allowed: MANDARIN_CPUS, else its own). */
    public static readonly string Startup = Environment.GetEnvironmentVariable("MANDARIN_CPUS") is { Length: > 0 } given && Expand(given).Length > 0 ? Compact(Expand(given)) : Own();

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

    /* It didn't start again after all: the split kept to again with the next decision. */
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
    public static int Slots => SlotsFor(plan.Background);

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

    /* A split kept to: this server's threads and its conversions moved where it says. */
    private static void Keep(Split next)
    {
        if (!OperatingSystem.IsLinux()) return;
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

    // ------------------------------------------------------------ decided here (v0.8.48)

    // DSP's second core is kept this long after its last conversion (lib/cpu.js DSP_HOLD_MS); the tests' own, if said.
    private static readonly int HoldMs = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_CPU_HOLD_MS"), out var h) && h >= 0 ? h : 10 * 60 * 1000;
    private static volatile bool deciding;
    private static readonly object Deciding_ = new();
    private static int dspRunning;         // DSP conversions under way
    private static long dspUntil;          // and the second core kept until then (Environment.TickCount64)
    private static Timer? holdTimer;
    private static Split decided = new(false, [], [], []);
    private static bool decidedDsp;        // whether DSP was in use when the split was last decided
    private static readonly Lazy<bool> Raise = new(() => Tools.Value.Nice && MayRaise());

    /* The split is decided (the job "cpu" is this server's, Jobs.cs). */
    public static bool Deciding => deciding;

    /* The cores to share out: as this server started (Startup), else every core the machine has. */
    private static int[] AllCores()
    {
        var c = Expand(Startup);
        return c.Length > 0 ? c : Enumerable.Range(0, Math.Max(1, Environment.ProcessorCount)).ToArray();
    }

    /* Whether a process may be started at a higher priority here (lib/cpu.js mayRaise: nice says so, and runs it anyway, when not). */
    private static bool MayRaise()
    {
        try
        {
            var psi = new ProcessStartInfo("nice") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var a in new[] { "-n", "-10", "true" }) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi);
            if (p == null) return false;
            _ = p.StandardOutput.ReadToEndAsync();
            var err = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(5000)) { try { p.Kill(); } catch (InvalidOperationException) { /* gone */ } return false; }
            return p.ExitCode == 0 && err.Result.Trim().Length == 0;
        }
        catch (Exception) { return false; }
    }

    /*
     * lib/cpu.js decide: the split from the machine and the settings. Playback
     * takes one core, or two with DSP, leaving the rest at least two where the
     * machine has four or more; the first of playback's is the one it always
     * has (the engine's playback thread is kept to it). [env]: PLAYBACK_CORES
     * and PLAYBACK_CORE as given. Linux with taskset only.
     */
    public static (bool Split, int[] Cores, int[] Playback, int[] Background, int? Core) Decide(bool linux, bool taskset, int[] cores, string? playbackCores, string? playbackCore, bool dsp)
    {
        var none = (false, cores.ToArray(), Array.Empty<int>(), cores.ToArray(), (int?)null);
        if (!linux || !taskset) return none;
        if (playbackCores == "0" || playbackCore == "0") return none;
        var n = cores.Length;
        double? fixedN = playbackCores is { Length: > 0 } pc ? Math.Floor(Tags.Js.StringToNumber(pc)) : null;
        double? asked = playbackCore is { Length: > 0 } pk ? Tags.Js.StringToNumber(pk) : null;
        bool fixedOk = fixedN is { } f0 && double.IsFinite(f0), askedOk = asked is { } a0 && double.IsFinite(a0);
        var chosen = fixedOk || askedOk;
        if (n < 2 || (n < 3 && !chosen)) return none;
        var want = fixedOk && fixedN!.Value > 0 ? fixedN.Value : dsp ? 2 : 1;
        want = Math.Max(1, Math.Min(want, chosen || n < 4 ? n - 1 : n - 2));
        var playback = new List<int>();
        if (askedOk) { var av = asked!.Value; playback.Add(cores.Any(c => c == av) ? (int)av : cores[n - 1]); }
        for (int i = n - 1; i >= 0 && playback.Count < want; i--) if (!playback.Contains(cores[i])) playback.Add(cores[i]);
        var core = playback[0];
        playback.Sort();
        return (true, cores.ToArray(), playback.ToArray(), cores.Where(c => !playback.Contains(c)).ToArray(), core);
    }

    private static bool DspActive() => Volatile.Read(ref dspRunning) > 0 || Environment.TickCount64 < Volatile.Read(ref dspUntil);

    /* The split decided from now on, and again whenever it changes; Stop: left as it is. */
    public static void StartDeciding()
    {
        lock (Deciding_)
        {
            deciding = true;
            Recompute();
        }
    }
    public static void StopDeciding()
    {
        lock (Deciding_)
        {
            if (!deciding) return;
            deciding = false;
            holdTimer?.Dispose(); holdTimer = null;
            Volatile.Write(ref sig, "");   // the next split kept to afresh
        }
    }

    /*
     * A DSP conversion started (true) or ended (false) (lib/cpu.js dsp): while
     * any runs, and for a while after, playback has its second core.
     */
    public static void Dsp(bool on)
    {
        lock (Deciding_)
        {
            if (on) dspRunning++;
            else
            {
                dspRunning = Math.Max(0, dspRunning - 1);
                if (dspRunning == 0)
                {
                    Volatile.Write(ref dspUntil, Environment.TickCount64 + HoldMs);
                    holdTimer?.Dispose();
                    holdTimer = new Timer(_ => { lock (Deciding_) { holdTimer = null; if (deciding) Recompute(); } }, null, HoldMs + 50, Timeout.Infinite);
                }
            }
            if (deciding) Recompute();
        }
    }

    // Under Deciding_: decided again, and kept to.
    private static void Recompute()
    {
        Func<string, string?> env = Environment.GetEnvironmentVariable;
        var dsp = DspActive();
        var d = Decide(OperatingSystem.IsLinux(), Tools.Value.Taskset, AllCores(), env("PLAYBACK_CORES"), env("PLAYBACK_CORE"), dsp);
        var next = new Split(d.Split, d.Playback, d.Background, d.Cores);
        decided = next;
        decidedDsp = dsp;
        Keep(next);
    }

    /* The split as decided here (lib/cpu.js plan()), with the DSP it was decided for (not a hold just over, its split still to follow): for /api/cpu. */
    public static JsonObject Plan()
    {
        Split p; bool dsp;
        lock (Deciding_) { p = decided; dsp = deciding ? decidedDsp : DspActive(); }
        var t = Tools.Value;
        return new JsonObject
        {
            ["split"] = p.On,
            ["cores"] = new JsonArray(p.All.Select(c => (JsonNode)c).ToArray()),
            ["playback"] = new JsonArray(p.Playback.Select(c => (JsonNode)c).ToArray()),
            ["background"] = new JsonArray(p.Background.Select(c => (JsonNode)c).ToArray()),
            ["core"] = p.On && p.Playback.Length > 0 ? CoreOf(p) : null,
            ["dsp"] = dsp,
            ["raised"] = Raise.Value,
            ["tools"] = new JsonObject { ["taskset"] = t.Taskset, ["nice"] = t.Nice, ["ionice"] = t.Ionice }
        };
    }
    // The core playback always has: the one PLAYBACK_CORE asks for when it is among playback's, else the last.
    private static int CoreOf(Split p)
    {
        var asked = Environment.GetEnvironmentVariable("PLAYBACK_CORE") is { Length: > 0 } pk ? Tags.Js.StringToNumber(pk) : double.NaN;
        return double.IsFinite(asked) && p.Playback.Any(c => c == asked) ? (int)asked : p.Playback[^1];
    }

}
