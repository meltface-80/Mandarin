using System.Diagnostics;

namespace Mandarin.Tests;

/// <summary>
/// One of the program's own commands run to its end (`mandarin-server config`, `db`, `update` …): what
/// it printed and how it ended, as the Node suite's spawnSync of the binary had it.
/// </summary>
public static class ServerCommand
{
    /// <summary>How it ended and what it printed.</summary>
    public sealed record Result(int Code, string Out, string Err);

    /// <summary>
    /// The program run with <paramref name="args"/>; <paramref name="env"/> laid over the suite's own
    /// environment once <paramref name="without"/>'s names are taken out of it; <paramref name="stdin"/>
    /// written to it, then closed.
    /// </summary>
    public static async Task<Result> Run(IEnumerable<string> args, IDictionary<string, string>? env = null, IEnumerable<string>? without = null, string? stdin = null, string? cwd = null)
    {
        Needs.Server();
        var psi = new ProcessStartInfo(ServerProcess.Bin) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        if (cwd != null) psi.WorkingDirectory = cwd;
        foreach (var a in args) psi.ArgumentList.Add(a);
        foreach (var k in without ?? []) psi.Environment.Remove(k);
        foreach (var (k, v) in env ?? new Dictionary<string, string>()) psi.Environment[k] = v;
        using var p = Process.Start(psi)!;
        var output = p.StandardOutput.ReadToEndAsync();
        var err = p.StandardError.ReadToEndAsync();
        if (stdin != null) await p.StandardInput.WriteAsync(stdin);
        p.StandardInput.Close();
        await p.WaitForExitAsync();
        return new Result(p.ExitCode, await output, await err);
    }
}
