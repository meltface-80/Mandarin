using System.Runtime.CompilerServices;

namespace Mandarin.Tests;

/// <summary>
/// A test, as the suite runs one: given five minutes at most (the Node suite's --test-timeout), so a
/// server that never answers fails its test, naming it, rather than holding the run.
/// </summary>
public sealed class TestAttribute : FactAttribute
{
    /// <summary>The suite's allowance for one test.</summary>
    public const int Allowance = 300_000;

    /// <summary>A test with the suite's allowance (where it is written, for the runner's report).</summary>
    public TestAttribute([CallerFilePath] string? sourceFilePath = null, [CallerLineNumber] int sourceLineNumber = -1)
        : base(sourceFilePath, sourceLineNumber) { Timeout = Allowance; }
}

/// <summary>What a test needs of the machine, said once: a test without it skips, saying why.</summary>
public static class Needs
{
    /// <summary>The C# server built (server/build.sh).</summary>
    public static void Server() { if (ServerProcess.NotBuilt is { } why) Missing(why); }

    /// <summary>ffmpeg on the PATH (or FFMPEG_PATH): the fixture library is made with it.</summary>
    public static void Ffmpeg() { if (!Fixtures.HaveFfmpeg) Missing("ffmpeg is not installed"); }

    /* Missing here: a skip, but on CI, which builds the server and installs ffmpeg before the tests, a failure, so a run where they went missing can't pass with them skipped. */
    private static void Missing(string why)
    {
        if (Environment.GetEnvironmentVariable("CI") is { Length: > 0 }) Assert.Fail(why + " (CI sets this up before the tests)");
        Assert.Skip(why);
    }

    /// <summary>Mandarin's audio engine, which plays through ALSA on Linux and Core Audio on a Mac (item 155).</summary>
    public static void Engine() { if (!OperatingSystem.IsLinux() && !OperatingSystem.IsMacOS()) Assert.Skip("Mandarin's audio engine plays on Linux and a Mac"); }
}
