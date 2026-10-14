namespace Mandarin.Tests;

/// <summary>
/// A program the server starts, stood in for (test/StandIns): a script at <c>path</c> that runs the
/// stand-ins program with its part, so the server starts it where it would start the real one, and what
/// the stand-in writes down lands beside it.
/// </summary>
public static class StandIn
{
    /// <summary>The stand-ins program, built beside the tests.</summary>
    public static readonly string Dll = Path.Combine(AppContext.BaseDirectory, "Mandarin.StandIns.dll");

    /// <summary>The script that plays <paramref name="part"/>, written to <paramref name="path"/>, which it returns.</summary>
    public static string Script(string part, string path)
    {
        if (!File.Exists(Dll)) Assert.Fail("the stand-ins aren't built beside the tests: " + Dll);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, $"#!/bin/sh\nexec dotnet \"{Dll}\" {part} \"$0\" \"$@\"\n");
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
        return path;
    }
}
