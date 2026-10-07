// Images.cs — album covers and record labels' logos (v0.8.5), from the
// /api/image route of lib/server/api-library.js.
//
// Every size of every cover is drawn once by the Node server (lib/library/
// artwork.js: from the album's folder or its tracks, with sharp) and kept in
// <data>/art; after each scan the tile size of every album is drawn ahead. So
// nearly every cover asked for is already a file, and those are sent from
// here. One not drawn yet is passed to the Node server, which draws and keeps
// it, and the next ask for it is answered here.
//
// Who may see one: a signed-in device, or an address the Node server signed
// (a cover handed to a speaker). Anything else is passed on as it came: the
// Node server knows the speakers, which fetch covers by their own address.
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static class Images
{
    private static readonly int[] Steps = [120, 200, 300, 400, 600, 800, 1200];
    private static string artDir = "", labelDir = "";

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
                try { if (await Answer(ctx, p, p[11..])) return; }
                catch (Exception e) when (!ctx.Response.HasStarted) { Front.Log($"[art] {p}: {e.GetType().Name}: {e.Message}; passed to the Node server"); }
            }
            await next();
        });
    }

    // HMAC-SHA256 of the path under the install's secret, base64url, 22 characters (auth.js, sig).
    public static bool Signed(HttpContext ctx, SqliteConnection c, string path)
    {
        var s = ctx.Request.Query["s"].ToString();
        if (s.Length != 22 || !s.All(ch => char.IsAsciiLetterOrDigit(ch) || ch == '-' || ch == '_')) return false;
        if (Db.Setting(c, "authSecret") is not { } sv || Js.Str(sv) is not { Length: > 0 } secret) return false;
        var mac = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(path));
        var want = Convert.ToBase64String(mac).TrimEnd('=').Replace('+', '-').Replace('/', '_')[..22];
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(s), Encoding.ASCII.GetBytes(want));
    }

    private static async Task<bool> Answer(HttpContext ctx, string path, string key)
    {
        using (var c = Db.Open())
            if (!Signed(ctx, c, path) && Auth.DeviceOf(ctx, c) == null) return false;   // the Node server's to decide

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
        if (key.StartsWith("al-", StringComparison.Ordinal))
        {
            int dash = key.IndexOf('-', 3);
            if (dash > 3 && key[3..dash].All(char.IsAsciiDigit) && long.TryParse(key[3..dash], out var id))
            {
                if (await Library.CurrentCopy() is not { } s) return false;
                if (s.ById.TryGetValue(id, out var al) && al.ImageKey != key) { key = al.ImageKey; current = false; }
            }
        }
        var size = ctx.Request.Query["size"].ToString() is { Length: > 0 } sz ? sz : ctx.Request.Query["width"].ToString() is { Length: > 0 } w ? w : null;
        var safe = new string(key.Where(ch => char.IsAsciiLetterOrDigit(ch) || ch == '_' || ch == '-').ToArray());
        if (safe.Length > 200) safe = safe[..200];
        var cached = Path.Combine(artDir, $"{safe}@{Snap(size)}.jpg");
        if (!File.Exists(cached)) return false;   // not drawn yet: the Node server draws it
        await SendFile(ctx, cached, "image/jpeg", current ? "public, max-age=604800, immutable" : "no-cache");
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
