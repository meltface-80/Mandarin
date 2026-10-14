// Pages.Script.cs — the page's script, /app.js, made from its parts (v1.0.5,
// docs/specs/page-modules.md). public/app.js grew to one file of 19,600
// lines; it is carved into parts under public/app/, each a file of its own,
// and served joined, in the order public/app/parts.txt lists them: one
// script, one request, run exactly as the one file ran.
//
// Only the parts the list names are joined, never whatever lies in the
// folder: an update lays the new files over the old (Admin/Updater.cs) and
// removes nothing, so a part since renamed or merged may still be there.
// Each part is headed by its name (a line comment) and parted from the next
// by a lone ";", so no two parts can run on into one statement. The Android
// app's own copy is joined the same way (android/app/build.gradle.kts,
// bundleSite); test/page-script.test.js holds the three together.
// Without the list (a page from before v1.0.5), public/app.js is sent as it is.
namespace Mandarin.Server;

internal static partial class Pages
{
    /// <summary>The list of the page script's parts, from public/.</summary>
    public const string PartsList = "app/parts.txt";

    /// <summary>What lies between two parts of the page's script.</summary>
    public const string PartsJoin = "\n;\n";

    /// <summary>The parts of the page's script, in order, as paths from public/; null without the list.</summary>
    public static List<string>? ScriptParts(string publicDir)
    {
        var list = Path.Combine(publicDir, PartsList);
        if (!File.Exists(list)) return null;
        var parts = new List<string>();
        foreach (var raw in File.ReadAllLines(list))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            // A part of the page, by its path from public/, and nothing outside it.
            if (!line.EndsWith(".js", StringComparison.Ordinal) || line.StartsWith('/') || line.Contains('\\') || line.Split('/').Any(s => s is "" or "." or "..")) continue;
            parts.Add(line);
        }
        return parts;
    }

    /// <summary>The page's script made from its parts, as the browser runs it.</summary>
    public static async Task<string> JoinScript(string publicDir, List<string> parts)
    {
        var texts = new List<string>(parts.Count);
        foreach (var p in parts) texts.Add("// " + p + "\n" + await File.ReadAllTextAsync(Path.Combine(publicDir, p)));
        return string.Join(PartsJoin, texts);
    }

    /* GET /app.js: the parts joined (kept while none of them, nor the list, changes). False without the list. */
    private static async Task<bool> SendScript(HttpContext ctx, string publicDir)
    {
        var parts = ScriptParts(publicDir);
        if (parts == null) return false;
        var from = parts.Select(p => Path.Combine(publicDir, p)).Prepend(Path.Combine(publicDir, PartsList)).ToArray();
        await SendMade(ctx, "app.js", from, () => JoinScript(publicDir, parts), "text/javascript; charset=utf-8");
        return true;
    }
}
