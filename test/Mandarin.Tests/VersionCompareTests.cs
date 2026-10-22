using System.Diagnostics;

namespace Mandarin.Tests;

/// <summary>
/// Release candidates (v0.6.0-RC1): the server's updater must move forward through them and on to the
/// release, never sideways or back (Admin/Updater.cs; test/version-compare.test.js, in C#).
/// </summary>
public sealed class VersionCompareTests
{
    private static async Task<int> Cmp(string a, string b) => (await Score.Run(new { fn = "versions", pairs = new[] { new[] { a, b } } }))["cmp"]![0]!.GetValue<int>();

    [Test]
    public async Task Release_candidates_order_before_their_release_and_by_number()
    {
        Assert.Equal(1, await Cmp("0.6.0-RC1", "0.5.58"));
        Assert.Equal(1, await Cmp("0.6.0", "0.6.0-RC1"));
        Assert.Equal(-1, await Cmp("0.6.0-RC1", "0.6.0"));
        Assert.Equal(1, await Cmp("0.6.0-RC2", "0.6.0-RC1"));
        Assert.Equal(1, await Cmp("0.6.0-RC10", "0.6.0-RC2"));
        Assert.Equal(0, await Cmp("v0.6.0-RC1", "0.6.0-rc1"));
        Assert.Equal(1, await Cmp("0.6.1", "0.6.0"));
    }

    /// <summary>
    /// Test builds (bug list item 141): dev's builds are the next release with -tN. One is newer than the last release,
    /// so it isn't offered that; the next counts up from it (t10 after t9); and the release itself is newer than all of
    /// them, so the updater offers it. The server knows itself as the test build it was built as, its -t whole.
    /// </summary>
    [Test]
    public async Task A_test_build_comes_after_the_last_release_and_before_its_own()
    {
        Assert.Equal(1, await Cmp("1.1.4-t1", "1.1.3"));
        Assert.Equal(1, await Cmp("1.1.4-t2", "1.1.4-t1"));
        Assert.Equal(1, await Cmp("1.1.4-t10", "1.1.4-t9"));
        Assert.Equal(1, await Cmp("1.1.4", "1.1.4-t7"));
        Assert.Equal(-1, await Cmp("1.1.4-t7", "v1.1.4"));
        var built = (await Score.Run(new { fn = "versions", builds = new object?[] { new[] { "1.1.4-t7+1a2b3c4d", "1.1.4.0" }, new[] { "1.1.3", "1.1.3.0" }, new[] { null, "1.1.3.0" }, new[] { "nonsense", "1.1.3.0" } } }))["built"]!;
        Assert.Equal(["1.1.4-t7", "1.1.3", "1.1.3", "1.1.3"], built.AsArray().Select(x => x!.GetValue<string>()).ToArray());
    }

    [Test]
    public async Task An_update_unpacks_into_a_folder_whose_path_has_a_space_in_it()
    {
        var root = Directory.CreateTempSubdirectory("musicd update ").FullName;
        try
        {
            var src = Path.Combine(root, "src dir", "mandarin-1.0.0");
            Directory.CreateDirectory(src);
            await File.WriteAllTextAsync(Path.Combine(src, "index.js"), "// new");
            var tgz = Path.Combine(root, "down load.tgz");
            using (var tar = Process.Start("tar", ["-czf", tgz, "-C", Path.Combine(root, "src dir"), "mandarin-1.0.0"])) await tar.WaitForExitAsync();
            var output = Path.Combine(root, "ex tract");
            Directory.CreateDirectory(output);
            var r = await Score.Run(new { fn = "versions", extracts = new[] { new[] { tgz, output } } });
            Assert.True(r["extracted"]![0]!.GetValue<bool>(), "tar was given the paths whole");
            Assert.Equal("// new", await File.ReadAllTextAsync(Path.Combine(output, "mandarin-1.0.0", "index.js")));
        }
        finally { Directory.Delete(root, true); }
    }
}
