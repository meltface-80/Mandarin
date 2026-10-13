// Cpu.Place.cs — each process this server starts put where its kind belongs
// (lib/cpu.js wrap and slots), out of Cpu.cs (v0.8.50, stage 7 part 5) with
// the rule on its own, so it can be asked directly (`mandarin-server score`
// { fn: "cpu" }, RulesCommand.cs): a conversion a device is waiting for on
// playback's cores; one made ahead of play just below it, there too; the
// background's on the rest, at the lowest priority, its disk reads last; the
// engine on playback's cores, raised where the system allows.
using System.Diagnostics;

namespace Mandarin.Server;

internal static partial class Cpu
{
    /*
     * The programs put before a process of [kind] (lib/cpu.js wrap): nice and
     * ionice as [tools] has them, taskset to its cores when the split is on;
     * [raised]: the engine, nice -n -10 first.
     */
    internal static List<string> ChainFor(CpuKind kind, (bool Taskset, bool Nice, bool Ionice) tools, bool split, int[] playback, int[] background, bool raised = false)
    {
        var chain = new List<string>();
        if (raised) chain.AddRange(["nice", "-n", "-10"]);
        if (kind == CpuKind.Background)
        {
            if (tools.Nice) chain.AddRange(["nice", "-n", "19"]);
            if (tools.Ionice) chain.AddRange(["ionice", "-c", "2", "-n", "7"]);
        }
        else if (kind == CpuKind.Ahead && tools.Nice) chain.AddRange(["nice", "-n", "5"]);
        if (split && tools.Taskset) chain.AddRange(["taskset", "-c", Compact(kind == CpuKind.Background ? background : playback)]);
        return chain;
    }

    /* How many background reads at once (lib/cpu.js slots): one per core playback doesn't keep. */
    internal static int SlotsFor(int[] background) => background.Length > 0 ? background.Length : Math.Max(1, Environment.ProcessorCount - 1);

    /* An ffmpeg to be started where its kind belongs: the program and its arguments put behind the chain. */
    public static void Place(ProcessStartInfo psi, CpuKind kind)
    {
        var p = plan;
        Prefix(psi, ChainFor(kind, Tools.Value, p.On, p.Playback, p.Background));
    }

    private static void Prefix(ProcessStartInfo psi, List<string> chain)
    {
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
