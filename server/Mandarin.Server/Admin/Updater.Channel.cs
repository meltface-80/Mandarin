// Updater.Channel.cs — which builds Settings → Updates offers (item 405): Mandarin's releases, or dev's builds. Out of
// Updater.cs.
//
//   MANDARIN_CHANNEL=dev   dev's builds: the "test-server" pre-release, which every push to dev replaces with dev as it
//                          is (.github/workflows/server-dev.yml), numbered as tools/test-version.js numbers it (1.3.2-t5:
//                          after the release before it, before the next). Its version is its bundle's
//                          (musicd-server-<version>.tar.gz), its files are read from it, and they are checked as a
//                          release's are: signed with the release key, the program against its sums and its version.
//   anything else          the releases: GitHub's latest, or with none published the highest version among the tags.
// Mandarin OS sets it from the shared folder's Storage/Installer at each Reinstall Mandarin (reinstall-mandarin), Linux's
// installer from --channel. A build is offered only when it is newer than the one running, on either: going back from
// dev's builds to a release is a reinstall's, never an update's.
using System.Text.RegularExpressions;

namespace Mandarin.Server.Admin;

using Js = Mandarin.Server.Tags.Js;
using JsObj = Mandarin.Server.Tags.JsObj;

internal sealed partial class Updater
{
    /* The pre-release dev's builds are published on. */
    public const string DevTag = "test-server";

    private readonly string channel = ChannelOf(Env("MANDARIN_CHANNEL"));

    /* "dev" for dev's builds; "latest" for anything else, nothing included. */
    internal static string ChannelOf(string? said) => string.Equals(said?.Trim(), "dev", StringComparison.OrdinalIgnoreCase) ? "dev" : "latest";

    private bool Dev => channel == "dev";

    /* Where the check asks for the newest build: the latest release, or dev's pre-release. */
    private string ReleasePath() => Dev ? $"/repos/{owner}/{repo}/releases/tags/{DevTag}" : $"/repos/{owner}/{repo}/releases/latest";

    /* Where version [v]'s files are listed: its own release, or dev's pre-release (which holds one version at a time). */
    private string AssetsPath(string v) => Dev ? $"/repos/{owner}/{repo}/releases/tags/{DevTag}" : $"/repos/{owner}/{repo}/releases/tags/v{v}";

    /*
     * The release the check found, as the check reads one: the latest release as it is; dev's pre-release named by the
     * version its bundle carries ("test-server" is no version), or null where it carries none (nothing on offer).
     */
    private JsObj? OnChannel(JsObj rel)
    {
        if (!Dev) return rel;
        var version = (rel["assets"] as List<object?> ?? []).OfType<JsObj>()
            .Select(a => DevBundle().Match(Js.IsNullish(a["name"]) ? "" : Js.Str(a["name"])))
            .Where(m => m.Success && ParseVer(m.Groups[1].Value) != null).Select(m => m.Groups[1].Value).FirstOrDefault();
        if (version == null) return null;
        rel["tag_name"] = "v" + version;
        return rel;
    }

    [GeneratedRegex(@"^musicd-server-(.+)\.tar\.gz$")] private static partial Regex DevBundle();

    /* With no release published: the highest version among the tags, as a release with nothing but GitHub's source tarball. */
    private async Task<JsObj?> NewestTag()
    {
        var t = await GetJson($"/repos/{owner}/{repo}/tags?per_page=30");
        if (t.Status != 200 || t.Json is not List<object?> tags || tags.Count == 0) return null;
        JsObj? best = null;
        foreach (var tag in tags.OfType<JsObj>())
            if (ParseVer(tag["name"]) != null && (best == null || CmpVer(tag["name"], best["name"]) > 0)) best = tag;
        if (best == null) return null;
        var name = Js.Str(best["name"]);
        var rel = new JsObj();
        rel["tag_name"] = best["name"];
        rel["html_url"] = $"https://github.com/{owner}/{repo}/releases/tag/{name}";
        rel["body"] = null;
        rel["assets"] = new List<object?>();
        rel["_tarball"] = $"https://api.github.com/repos/{owner}/{repo}/tarball/{name}";
        return rel;
    }
}
