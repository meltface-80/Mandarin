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
