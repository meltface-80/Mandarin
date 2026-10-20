// Pages.Kept.cs — the Android app's two files kept once made (v0.9.3, the
// audit's P2, old/audit-b4-main.md): its page and its stylesheet were
// read from public/, changed (Pages.cs) and hashed for their tag every time the
// app asked, and it asks each time it opens. Each is now kept with its tag
// while the files it is made from are as they were (their size and write
// time): an update that puts new ones in place is made afresh, once.
using System.Collections.Concurrent;
using System.Text;

namespace Mandarin.Server;

internal static partial class Pages
{
    private sealed record KeptFile(string Stamp, byte[] Bytes, string Tag);
    private static readonly ConcurrentDictionary<string, KeptFile> KeptFiles = new(StringComparer.Ordinal);

    /* The files' size and write time, together: a file not there counts as such. */
    private static string Stamp(IEnumerable<string> paths) =>
        string.Join("|", paths.Select(p => new FileInfo(p) is { Exists: true } f ? f.Length + ":" + f.LastWriteTimeUtc.Ticks : "-"));

    /* `name` made from `from` by `make`, as kept while those files stand, else made now and kept. */
    private static async Task SendMade(HttpContext ctx, string name, string[] from, Func<Task<string>> make, string type)
    {
        var stamp = Stamp(from);
        if (!KeptFiles.TryGetValue(name, out var k) || k.Stamp != stamp)
        {
            var bytes = Encoding.UTF8.GetBytes(await make());
            k = new KeptFile(stamp, bytes, "W/\"" + Convert.ToHexString(Fingerprint.Sha1(bytes))[..27].ToLowerInvariant() + "\"");
            KeptFiles[name] = k;
        }
        else ctx.Response.Headers["X-Mandarin-Kept"] = "1";
        await Send(ctx, k.Bytes, k.Tag, type);
    }
}
