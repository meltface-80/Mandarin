using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The C# program's rules asked directly from a test, through `mandarin-server score`
/// (server/Mandarin.Server/Identify/ScoreCommand.cs lists them): a job in, its answer out
/// (test/score.js, in C#).
/// </summary>
public static class Score
{
    /// <summary>The job's answer; the program must end cleanly and answer without an error.</summary>
    public static async Task<JsonNode> Run(object job, IDictionary<string, string>? env = null)
    {
        Needs.Server();
        var psi = new ProcessStartInfo(ServerProcess.Bin) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        psi.ArgumentList.Add("score");
        foreach (var (k, v) in env ?? new Dictionary<string, string>()) psi.Environment[k] = v;
        using var p = Process.Start(psi)!;
        var output = p.StandardOutput.ReadToEndAsync();
        var err = p.StandardError.ReadToEndAsync();
        await p.StandardInput.WriteLineAsync(Http.Json(job));
        p.StandardInput.Close();
        await p.WaitForExitAsync();
        Assert.True(p.ExitCode == 0, await err);
        var o = JsonNode.Parse((await output).Split('\n')[0])!;
        Assert.True(o["error"] == null, (string?)o["error"]);
        return o;
    }
}
