[assembly: AssemblyFixture(typeof(Mandarin.Tests.TempRun))]

namespace Mandarin.Tests;

/// <summary>
/// The test process's temp directory, a folder of its own (item 201; test/tmp-run.js's way, in C#): made
/// in the system's temp directory before any test runs, given to the process as TMPDIR (so every
/// fixture, server, stand-in and update it starts writes there too), and taken away at the end with all
/// that is in it. The suite's libraries, servers and update bundles stayed in the system's temp
/// directory, run after run. The system's temp directory is passed on as <see cref="RootVar"/>, for what
/// test processes share (the ports registry, <see cref="Ports"/>).
/// </summary>
public sealed class TempRun : IDisposable
{
    /// <summary>The variable that names the system's temp directory, for what test processes share.</summary>
    public const string RootVar = "MANDARIN_TEST_TMP_ROOT";

    /// <summary>This process's temp folder.</summary>
    public string Dir { get; }

    /// <summary>Made before the suite's first test, by xUnit: the folder, and TMPDIR pointed at it.</summary>
    public TempRun()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(RootVar)))
            Environment.SetEnvironmentVariable(RootVar, Path.GetTempPath());
        Dir = Open(Path.GetTempPath());
        foreach (var k in new[] { "TMPDIR", "TMP", "TEMP" }) Environment.SetEnvironmentVariable(k, Dir);
        // Should the process end without the suite's end (a run cancelled), the folder goes all the same.
        AppDomain.CurrentDomain.ProcessExit += (_, _) => Close(Dir);
    }

    /// <summary>A new run folder, musicd-run-…, in <paramref name="under"/>.</summary>
    public static string Open(string under)
    {
        var dir = Path.Combine(under, "musicd-run-" + Path.GetRandomFileName().Replace(".", "", StringComparison.Ordinal));
        Directory.CreateDirectory(dir);
        return dir;
    }

    /// <summary>A run folder taken away with all in it; one already gone is left so.</summary>
    public static void Close(string dir)
    {
        for (int tries = 0; Directory.Exists(dir); tries++)
        {
            try { Directory.Delete(dir, recursive: true); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                if (tries >= 3) { Console.Error.WriteLine($"TempRun: couldn't remove {dir}: {e.Message}"); return; }
                Thread.Sleep(100);
            }
        }
    }

    /// <summary>The suite's end.</summary>
    public void Dispose() => Close(Dir);
}
