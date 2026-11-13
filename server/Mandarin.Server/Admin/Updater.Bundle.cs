// Updater.Bundle.cs — the release's bundle checked before it is unpacked (the security audit's I-H3). Out of Updater.cs.
//
// The bundle (musicd-server-<v>.tar.gz) is the page, package.json and SQ-tool's Python the server runs: as much the
// server's code as its program. Where Mandarin's release key is built in (ReleaseKey.cs), it is the release's own file of
// that name, signed with the key (<name>.sig beside it, .github/sign.sh), or nothing: never another tarball among the
// release's files, nor GitHub's source tarball, which no one signs. It is checked whether or not the program is updated
// with it (MANDARIN_SERVER_UPDATE=0). Where no key is built in, the check's download, as before.
namespace Mandarin.Server.Admin;

using Js = Mandarin.Server.Tags.Js;
using JsObj = Mandarin.Server.Tags.JsObj;

internal sealed partial class Updater
{
    /* The files of release v[v] (GitHub's /releases/tags/v<v>, or dev's pre-release: Updater.Channel.cs), read once for the bundle and the program. */
    private async Task<List<JsObj>> ReleaseAssets(string v)
    {
        var r = await GetJson(AssetsPath(v));
        if (r.Status != 200 || r.Json is not JsObj rel) throw new UpdateError($"release v{v} not found (HTTP {r.Status})");
        return [.. (rel["assets"] as List<object?> ?? []).OfType<JsObj>()];
    }

    /*
     * The bundle of v[v] downloaded to [file], and signed with the release key where one is built in; refused, and
     * the download deleted, before anything unpacks it where not. [fallback]: what the check found to download, taken
     * only where there is no key. The release's files, for the program (null where there is no key and none were had).
     */
    private async Task<List<JsObj>?> FetchBundle(string v, string fallback, string file)
    {
        var name = $"{PackageName}-{v}.tar.gz";
        var keyed = ReleaseKey.Current != null;
        List<JsObj>? assets;
        try { assets = await ReleaseAssets(v); }
        catch (UpdateError) when (!keyed) { assets = null; }
        var bundle = assets?.FirstOrDefault(a => Js.StrictEq(a["name"], name));
        if (bundle == null && keyed) throw new UpdateError($"release v{v} carries no {name}");
        var url = bundle != null ? Js.Str(bundle["browser_download_url"]) : fallback;
        Debug("downloading " + url);
        await Download(url, file);
        if (assets == null) return null;
        try { await CheckSigned(assets, name, file, v); }
        catch (UpdateError)
        {
            try { File.Delete(file); } catch (IOException) { /* gone */ }
            throw;
        }
        return assets;
    }
}
