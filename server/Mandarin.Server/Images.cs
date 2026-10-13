// Images.cs — album covers and record labels' logos (v0.8.5), from the
// /api/image route of lib/server/api-library.js.
//
// Every size of every cover is drawn once and kept in <data>/art, and sent
// from there. One not drawn yet is drawn here (Covers.cs, v0.8.22) from the
// album's own cover; an album with none gets its drawn one, and a picture from
// elsewhere (a "u-" key) is fetched and drawn, here too (CoversDrawn.cs,
// v0.8.34). One that can't be drawn is an empty 404.
//
// Who may see one: a signed-in device, a signed address (a cover handed to a
// speaker), or a speaker asking by its own address (v0.8.48).
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static class Images
{
    private static readonly int[] Steps = [120, 200, 300, 400, 600, 800, 1200];
    private static string artDir = "", labelDir = "";
    public static string ArtDir => artDir;

    /* artwork.snap: the size drawn for the size asked. */
    public static int Snap(string? size)
    {
        var n = Library.Num(size);
        var s = Math.Max(64, Math.Min(1200, double.IsNaN(n) || n == 0 ? 400 : n));
        foreach (var x in Steps) if (x >= s) return x;
        return 1200;
    }

    public static void Use(WebApplication app, string dataDir)
    {
        artDir = Path.Combine(dataDir, "art");
        labelDir = Path.Combine(dataDir, "labels");
        app.Use(async (ctx, next) =>
        {
            var p = ctx.Request.Path.Value ?? "";
            var m = ctx.Request.Method;
            if ((HttpMethods.IsGet(m) || HttpMethods.IsHead(m)) && p.StartsWith("/api/image/", StringComparison.Ordinal) && p.Length > 11 && p.IndexOf('/', 11) < 0)
            {
                try
                {
                    if (await Answer(ctx, p, p[11..])) return;
                    // A speaker asking by its own address for a cover there isn't, once this server holds playback (v0.8.49): 404, as the Node server's route
                    // answered past its gate — the Node server no longer knows the speakers, and would turn the request away as unsigned.
                    if (Playback.Hub.Holds && !ctx.Response.HasStarted && await FromSpeaker(ctx)) { ctx.Response.StatusCode = 404; return; }
                }
                catch (Exception e) when (!ctx.Response.HasStarted) { Front.Log($"[art] {p}: {e.GetType().Name}: {e.Message}; passed to the Node server"); }
            }
            await next();
        });
    }

    // HMAC-SHA256 of the path under the install's secret, base64url, 22 characters (auth.js, sig),
    // checked as the Node server's gate checks it (Playback/Signing.cs): the path as the request
    // wrote it, not decoded, and s as Express reads the query. Where that can't be said here, not.
    public static bool Signed(HttpContext ctx, SqliteConnection c)
    {
        if (Db.Setting(c, "authSecret") is not { } sv || Js.Str(sv) is not { Length: > 0 } secret) return false;
        var raw = ctx.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpRequestFeature>()?.RawTarget;
        return Playback.Signing.Gate(secret, raw) == true;
    }

    /* auth.js speakerIps(): a request from one of the speakers' own addresses, as the hub knows them (v0.8.49). */
    public static Task<bool> FromSpeaker(HttpContext ctx) =>
        Task.FromResult(Playback.Hub.Current is { } hub && hub.SpeakerHosts.Contains(Auth.ClientIp(ctx)));

    private static async Task<bool> Answer(HttpContext ctx, string path, string key)
    {
        bool may;
        using (var c = Db.Open()) may = Signed(ctx, c) || Auth.DeviceOf(ctx, c) != null;
        if (!may && !await FromSpeaker(ctx)) return false;

        // A record label's logo, as kept: its address changes with it.
        if (key.StartsWith("label-", StringComparison.Ordinal))
        {
            var lk = new string(key[6..].Where(ch => ch is >= 'a' and <= 'z' or >= '0' and <= '9').ToArray());
            string? file = null, type = null;
            using (var c = Db.Open())
            {
                using var cmd = c.CreateCommand();
                cmd.CommandText = "SELECT file, type FROM label_logos WHERE key = $k";
                cmd.Parameters.AddWithValue("$k", lk);
                using var r = cmd.ExecuteReader();
                if (r.Read()) { file = r.GetString(0); type = r.GetString(1); }
            }
            if (file == null) return false;
            var full = Path.GetFullPath(Path.Combine(labelDir, file));
            if (!full.StartsWith(Path.GetFullPath(labelDir) + "/", StringComparison.Ordinal) || !File.Exists(full)) return false;
            await SendFile(ctx, full, type!, "public, max-age=604800, immutable");
            return true;
        }

        // An album's address changes with its cover. One from before a change
        // is answered with the album's current cover, and not kept.
        bool current = true;
        Album? album = null;
        if (key.StartsWith("al-", StringComparison.Ordinal))
        {
            int dash = key.IndexOf('-', 3);
            if (dash > 3 && key[3..dash].All(char.IsAsciiDigit) && long.TryParse(key[3..dash], out var id))
            {
                if (await Library.CurrentCopy() is not { } s) return false;
                if (s.ById.TryGetValue(id, out var al))
                {
                    album = al;
                    if (al.ImageKey != key) { key = al.ImageKey; current = false; }
                }
            }
        }
        var size = ctx.Request.Query["size"].ToString() is { Length: > 0 } sz ? sz : ctx.Request.Query["width"].ToString() is { Length: > 0 } w ? w : null;
        var safe = new string(key.Where(ch => char.IsAsciiLetterOrDigit(ch) || ch == '_' || ch == '-').ToArray());
        if (safe.Length > 200) safe = safe[..200];
        var cached = Path.Combine(artDir, $"{safe}@{Snap(size)}.jpg");
        // Not drawn yet: drawn here — the album's own cover, else its placeholder,
        // or a picture from elsewhere (v0.8.34); what only sharp would draw the
        // same is the Node server's.
        if (!File.Exists(cached))
        {
            Covers.Drawn how;
            if (album != null)
            {
                how = await Covers.Draw(album, cached, Snap(size));
                if (how == Covers.Drawn.NoCover) how = await Covers.DrawPlaceholder(album, cached, Snap(size));
            }
            else if (Covers.ForeignUrl(key) is { } url)
            {
                how = await Covers.DrawForeign(url, cached, Snap(size));
                // Not to be had: absent, as the Node server answers it.
                if (how == Covers.Drawn.NoCover) { ctx.Response.Headers["X-Mandarin-Answered"] = "C#"; ctx.Response.StatusCode = 404; return true; }
            }
            else return Absent(ctx);
            if (how != Covers.Drawn.Yes) return Absent(ctx);
        }
        await SendFile(ctx, cached, "image/jpeg", current ? "public, max-age=604800, immutable" : "no-cache");
        return true;
    }

    /*
     * A cover that can't be had, nor drawn: answered as api-library.js did when artwork.get gave nothing (sharp
     * failing, a key of no album): an empty 404.
     */
    private static bool Absent(HttpContext ctx)
    {
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        ctx.Response.StatusCode = 404;
        return true;
    }

    /* res.sendFile, as Express sends one: its weak ETag and Last-Modified, and "not modified". */
    private static async Task SendFile(HttpContext ctx, string file, string type, string cache)
    {
        var info = new FileInfo(file);
        var mtime = new DateTimeOffset(info.LastWriteTimeUtc);
        // The time to the nearest millisecond, as Node's fs.Stats gives it.
        var ms = (long)Math.Floor((mtime.UtcTicks - DateTimeOffset.UnixEpoch.UtcTicks) / 10000.0 + 0.5);
        var tag = $"W/\"{info.Length:x}-{ms:x}\"";
        var h = ctx.Response.Headers;
        h.CacheControl = cache;
        h.ETag = tag;
        h.LastModified = DateTimeOffset.FromUnixTimeMilliseconds(ms).ToString("R");
        h.AcceptRanges = "bytes";
        h["X-Mandarin-Answered"] = "C#";
        var inm = ctx.Request.Headers.IfNoneMatch.ToString();
        if (inm.Length > 0 ? inm.Contains(tag, StringComparison.Ordinal)
            : DateTimeOffset.TryParse(ctx.Request.Headers.IfModifiedSince.ToString(), out var since) && ms / 1000 <= since.ToUnixTimeSeconds())
        {
            ctx.Response.StatusCode = 304;
            return;
        }
        ctx.Response.ContentType = type;
        ctx.Response.ContentLength = info.Length;
        if (HttpMethods.IsHead(ctx.Request.Method)) return;
        await ctx.Response.SendFileAsync(file);
    }
}
