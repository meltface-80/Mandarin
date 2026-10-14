using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>The version is the same everywhere it is shown (test/version.test.js, in C#).</summary>
public sealed class VersionTests
{
    private static string Read(string f) => File.ReadAllText(Path.Combine(ServerProcess.Root, f));

    [Test]
    public void The_version_is_the_same_everywhere_it_is_shown()
    {
        var v = (string)JsonNode.Parse(Read("package.json"))!["version"]!;
        Assert.True(v == (string?)JsonNode.Parse(Read("package-lock.json"))!["version"], "package-lock.json");
        Assert.True(Regex.IsMatch(Read("README.md"), "^# Mandarin — v" + Regex.Escape(v) + "$", RegexOptions.Multiline), "README title");
        Assert.True(Read("docs/index.html").Contains($"<span class=\"badge\">v{v}</span>", StringComparison.Ordinal), "Pages badge");
        Assert.True(Read("android/app/build.gradle.kts").Contains($"versionName = \"{v}\"", StringComparison.Ordinal), "Android versionName");
        Assert.True(Read("CHANGELOG.md").Contains($"## v{v}", StringComparison.Ordinal), "CHANGELOG entry");
    }
}
