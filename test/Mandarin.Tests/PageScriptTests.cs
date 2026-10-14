using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// The page's script made from its parts (v1.0.5, docs/specs/page-modules.md): /app.js is the parts
/// public/app/parts.txt names, in its order, each headed by its name and parted by a lone ";"
/// (server/Mandarin.Server/Pages.Script.cs), and the Android app's own copy is joined the same way
/// (android/app/build.gradle.kts). Held here:
///   - the server sends exactly that join, and says it has it still;
///   - every part named is there, once, a plain file of the page;
///   - every script in public/app/ is named: one left out would never run;
///   - each part compiles alone, and so does the join (in Chromium, the browser they are written for);
///   - the app's join is the server's (its separator, its heading, its list).
/// (test/page-script.test.js, in C#.)
/// </summary>
public sealed class PageScriptTests
{
    private static readonly string Pub = Path.Combine(ServerProcess.Root, "public");

    private static string Read(string f) => File.ReadAllText(Path.Combine(ServerProcess.Root, f));

    /// <summary>The parts, as the server reads the list.</summary>
    private static List<string> Parts() =>
        [.. Read("public/app/parts.txt").Split('\n').Select(l => l.Trim())
            .Where(l => l.Length > 0 && !l.StartsWith('#') && l.EndsWith(".js", StringComparison.Ordinal) && !l.StartsWith('/') && !l.Contains('\\')
                && l.Split('/').All(s => s.Length > 0 && s != "." && s != ".."))];

    private static string Join(IEnumerable<string> list) => string.Join("\n;\n", list.Select(p => "// " + p + "\n" + File.ReadAllText(Path.Combine(Pub, p))));

    [Test]
    public void Every_part_named_is_there_once_and_every_script_in_public_app_is_named()
    {
        var list = Parts();
        Assert.True(list.Count > 0, "the list names the parts");
        Assert.True(list.Distinct().Count() == list.Count, "no part twice: " + string.Join(", ", list));
        foreach (var p in list)
        {
            Assert.True(File.Exists(Path.Combine(Pub, p)), p + " is there");
            Assert.True(File.ReadAllBytes(Path.Combine(Pub, p)) is not [0xEF, ..], p + " has no byte-order mark (the app's join would keep it)");
        }
        foreach (var s in Directory.GetFiles(Path.Combine(Pub, "app"), "*.js").Select(f => "app/" + Path.GetFileName(f)))
            Assert.True(list.Contains(s), s + " is named in public/app/parts.txt, or it never runs");
    }

    // One script, as the browser reads it: a part cut mid-statement, or two parts declaring one name
    // (let, const, class), stops the whole page before any of it runs.
    [Test]
    public async Task The_parts_joined_are_one_script_that_compiles_as_each_part_alone_does()
    {
        Browser.Need();
        await using var b = await Browser.Launch();
        var page = await b.Page("about:blank");
        async Task Compiles(string source, string name)
        {
            var r = await page.Send("Runtime.compileScript", new { expression = source, sourceURL = name, persistScript = false });
            var e = r?["exceptionDetails"];
            Assert.True(e == null, name + " compiles: " + ((string?)e?["exception"]?["description"] ?? (string?)e?["text"]));
        }
        var list = Parts();
        foreach (var p in list) await Compiles(File.ReadAllText(Path.Combine(Pub, p)), p);
        await Compiles(Join(list), "app.js");
    }

    [Test]
    public void The_Android_apps_copy_is_joined_as_the_server_joins_it()
    {
        var cs = Read("server/Mandarin.Server/Pages.Script.cs");
        var gradle = Read("android/app/build.gradle.kts");
        Assert.Matches(@"PartsJoin = ""\\n;\\n"";", cs);
        Assert.Matches(@"PartsList = ""app/parts\.txt"";", cs);
        Assert.True(Regex.IsMatch(cs, @"""// "" \+ p \+ ""\\n"" \+"), "each part headed by its name");
        Assert.True(Regex.IsMatch(gradle, @"joinToString\(""\\n;\\n""\) \{ ""// \$it\\n"" \+ File\(pageDir, it\)\.readText\(\) \}"), "the same join in build.gradle.kts");
        Assert.True(Regex.IsMatch(gradle, @"File\(pageDir, ""app/parts\.txt""\)"), "from the same list");
    }

    [Test]
    public async Task App_js_is_the_parts_joined_kept_while_they_stand()
    {
        await using var s = await Session.Started();
        var r = await Http.Get(s.Base + "/app.js", s.H);
        Assert.Equal(200, r.Status);
        Assert.Matches("^text/javascript; charset=utf-8$", r.Header("content-type") ?? "");
        Assert.True(r.Header("cache-control") == "no-cache", "asked after each time, so an update is seen at once");
        Assert.True(r.Text == Join(Parts()), "exactly the parts, joined");
        var again = await Http.Get(s.Base + "/app.js", new Dictionary<string, string>(s.H) { ["If-None-Match"] = r.Header("etag") ?? "" });
        Assert.True(again.Status == 304, "a copy still current: not modified");
        Assert.True((await Http.Get(s.Base + "/app.js")).Status == 401, "behind the gate, as every file of the page");
    }
}
