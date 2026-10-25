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
//
// One that couldn't be had is kept in mind ten minutes: asked again (the phone
// does, seconds later), an empty 404 at once, not the files read and ffmpeg run
// again for it; and the phone told not to ask again for five minutes.
using System.Collections.Concurrent;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static class Images
{
    private static readonly int[] Steps = [120, 200, 300, 400, 600, 800, 1200];
    private static string artDir = "", labelDir = "";
    public static string ArtDir => artDir;

    // The covers missed, by image key: when. A few thousand at most, all forgotten past that.
    private static readonly ConcurrentDictionary<string, long> Misses = new(StringComparer.Ordinal);
    private const long MissMs = 10 * 60 * 1000;
    private const int MostMisses = 4096;

    /* artwork.snap: the size drawn for the size asked. */
    public static int Snap(string? size)
    {
        var n = Library.Num(size);
        var s = Math.Max(64, Math.Min(1200, double.IsNaN(n) || n == 0 ? 400 : n));
        foreach (var x in Steps) if (x >= s) return x;
        return 1200;
    }

    /* Where a cover's size is kept: <data>/art/<key>@<size>.jpg, the key's safe letters. */
    public static string KeptFile(string key, int size)
    {
        var safe = new string(key.Where(ch => char.IsAsciiLetterOrDigit(ch) || ch == '_' || ch == '-').ToArray());
        if (safe.Length > 200) safe = safe[..200];
        return Path.Combine(artDir, $"{safe}@{size}.jpg");
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
                    if (await Answer(ctx, p[11..])) return;
                    // A speaker asking by its own address for a cover there isn't (v0.8.49): 404, as the Node server's route answered past its gate.
                    if (Playback.Hub.Holds && !ctx.Response.HasStarted && await FromSpeaker(ctx)) { ctx.Response.StatusCode = 404; return; }
                }
                // Absent, as the Node server answered a cover it couldn't draw.
                catch (Exception e) when (!ctx.Response.HasStarted) { Server.Log($"[art] {p}: {e.GetType().Name}: {e.Message}"); Absent(ctx); return; }
            }
            await next();
        });
    }

    // HMAC-SHA256 of the path under the install's secret, base64url, 22 characters (auth.js, sig),
    // checked as the Node server's gate checked it (Playback/Signing.cs): the path as the request
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

    private static async Task<bool> Answer(HttpContext ctx, string key)
    {
        bool may;
        using (var c = Db.Open()) may = Signed(ctx, c) || Auth.Through(ctx, c);
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
        var cached = KeptFile(key, Snap(size));
        // Not drawn yet (nor ahead, Covers.Ahead.cs): drawn here — the album's own cover, else its placeholder,
        // or a picture from elsewhere (v0.8.34); where sharp drew otherwise, Covers.cs says.
        if (!File.Exists(cached))
        {
            // Missed a moment ago: missed still, without the work, marked as kept.
            if (Missed(key)) { ctx.Response.Headers["X-Mandarin-Kept"] = "1"; return NotHad(ctx); }
            Covers.Drawn how;
            if (album != null) how = await Covers.DrawAlbum(album, cached, Snap(size));
            // Not to be had (NoCover): absent too, as the Node server answered it.
            else if (Covers.ForeignUrl(key) is { } url) how = await Covers.DrawForeign(url, cached, Snap(size));
            else return Absent(ctx);
            if (how != Covers.Drawn.Yes) { Miss(key); return NotHad(ctx); }
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

    /* A cover there was work to look for and none: absent, and not to be asked again for five minutes. */
    private static bool NotHad(HttpContext ctx)
    {
        ctx.Response.Headers.CacheControl = "max-age=300";
        return Absent(ctx);
    }

    private static bool Missed(string key)
    {
        if (!Misses.TryGetValue(key, out var at)) return false;
        if (Environment.TickCount64 - at < MissMs) return true;
        Misses.TryRemove(key, out _);
        return false;
    }

    private static void Miss(string key)
    {
        if (Misses.Count >= MostMisses) Misses.Clear();
        Misses[key] = Environment.TickCount64;
    }

    /* The covers missed forgotten: the library read again (a scan, an edit) may have them now. */
    public static void ForgetMisses() => Misses.Clear();

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
