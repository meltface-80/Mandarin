namespace Mandarin.Tests;

/// <summary>
/// The C# suite leaves nothing in the system's temp directory (item 201; Harness/TempRun.cs): the test
/// process's temp directory is a folder of its own in it, where every fixture, server and update goes,
/// and the folder goes at the end, whatever is in it. The ports registry stays in the shared one.
/// </summary>
public sealed class TempRunTests
{
    private static string Trim(string p) => p.TrimEnd(Path.DirectorySeparatorChar);

    [Fact]
    public void The_process_temp_directory_is_a_folder_of_its_own_in_the_system_one()
    {
        var root = Environment.GetEnvironmentVariable(TempRun.RootVar);
        Assert.False(string.IsNullOrEmpty(root), TempRun.RootVar + " passed on");
        var mine = Trim(Path.GetTempPath());
        Assert.Equal(Trim(root!), Path.GetDirectoryName(mine));
        Assert.StartsWith("musicd-run-", Path.GetFileName(mine), StringComparison.Ordinal);
        var made = Directory.CreateTempSubdirectory("musicd-test-").FullName;
        Assert.Equal(mine, Path.GetDirectoryName(made));
        Assert.Equal(Trim(root!), Path.GetDirectoryName(Trim(Ports.RegistryDir)));
    }

    [Fact]
    public void Closing_a_run_folder_takes_it_and_all_in_it()
    {
        var under = Directory.CreateTempSubdirectory("tmprun-").FullName;
        var dir = TempRun.Open(under);
        Assert.True(Directory.Exists(dir));
        Directory.CreateDirectory(Path.Combine(dir, "musicd-test-x", "music", "deep"));
        File.WriteAllBytes(Path.Combine(dir, "musicd-test-x", "music", "deep", "big.bin"), new byte[1 << 20]);
        TempRun.Close(dir);
        Assert.False(Directory.Exists(dir));
        Assert.Empty(Directory.GetFileSystemEntries(under));
        TempRun.Close(dir);   // a second time: nothing to do, no complaint
    }
}
