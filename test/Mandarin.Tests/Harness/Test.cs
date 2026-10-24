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
    public static void Server() { if (ServerProcess.NotBuilt is { } why) Assert.Skip(why); }

    /// <summary>ffmpeg on the PATH (or FFMPEG_PATH): the fixture library is made with it.</summary>
    public static void Ffmpeg() { if (!Fixtures.HaveFfmpeg) Assert.Skip("ffmpeg is not installed"); }

    /// <summary>Mandarin's audio engine, which plays through ALSA: Linux's alone until it plays through Core Audio.</summary>
    public static void Engine() { if (!OperatingSystem.IsLinux()) Assert.Skip("Mandarin's audio engine plays through ALSA, on Linux only"); }
}
