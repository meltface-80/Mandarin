// Updater.Signature.cs — the program downloaded for an update checked against its release's sums and, where Mandarin's
// release key is built in (ReleaseKey.cs, item 371), its signature. Out of Updater.cs.
using System.Text.RegularExpressions;

namespace Mandarin.Server.Admin;

using Js = Mandarin.Server.Tags.Js;
using JsObj = Mandarin.Server.Tags.JsObj;

internal sealed partial class Updater
{
    /* [name]'s sum in a sums file ("<sha256>  <name>" a line), or null where it has none. */
    private static string? SumFor(string text, string name)
    {
        foreach (var l in text.Split('\n'))
        {
            var parts = SumLine().Split(Js.Trim(l));
            if (parts.Length >= 2 && parts[1] == name && Hex64().IsMatch(parts[0])) return parts[0];
        }
        return null;
    }

    /* [file] (the release's [name], of v[v]) signed with the release key, where one is built in; nothing to check where not. */
    private async Task CheckSigned(List<JsObj> assets, string name, string file, string v)
    {
        if (ReleaseKey.Current is not { } key) return;
        var sig = assets.FirstOrDefault(a => Js.StrictEq(a["name"], name + ".sig")) ?? throw new UpdateError($"release v{v} carries no signature for {name}");
        var sigFile = file + ".sig";
        try
        {
            await Download(Js.Str(sig["browser_download_url"]), sigFile);
            if (!ReleaseKey.Verify(key, await File.ReadAllBytesAsync(file), await File.ReadAllBytesAsync(sigFile)))
                throw new UpdateError($"{name} isn't signed with Mandarin's release key");
        }
        finally { try { File.Delete(sigFile); } catch (IOException) { /* gone */ } }
    }

    [GeneratedRegex(@"\s+\*?")] private static partial Regex SumLine();
    [GeneratedRegex(@"^[0-9a-f]{64}$", RegexOptions.IgnoreCase)] private static partial Regex Hex64();
}
