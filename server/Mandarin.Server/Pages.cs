// Pages.cs — the page and its files (public/), moved from index.js in v0.8.3.
//
// Only what is a file in public/ is served here, behind the gate: the page,
// its script and stylesheets, the icons and fonts. Every other address still
// goes to the Node server, which has routes outside /api (/login, /display,
// the streams) and opens the page itself for any deep link.
//
// The Android app's WebView gets two files of its own, as before: the page
// without viewport-fit=cover, and the stylesheet with every safe-area
// allowance at zero plus the app's own rules (public/android.css): the app
// has already made the room around the page, whatever the WebView reports.
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Net.Http.Headers;

namespace Mandarin.Server;

internal static partial class Pages
{
    [GeneratedRegex(@",\s*viewport-fit=cover")]
    private static partial Regex ViewportFit();
    [GeneratedRegex(@"env\(safe-area-inset-(top|bottom|left|right)\)")]
    private static partial Regex SafeArea();
    [GeneratedRegex(@"\.(html|js|css|json)$")]
    private static partial Regex Fresh();

    private static bool IsApp(HttpContext ctx) => ctx.Request.Headers.UserAgent.ToString().Contains("MusicDAndroid/", StringComparison.Ordinal);

    public static void Use(WebApplication app, string publicDir)
    {
        if (!Directory.Exists(publicDir)) { Front.Log($"[server] no page at {publicDir}; the Node server serves it"); return; }
        var files = new PhysicalFileProvider(publicDir);

        // The page itself, at / and /index.html.
        app.MapMethods("/", ["GET", "HEAD"], (HttpContext ctx) => SendApp(ctx, publicDir, files));
        app.MapMethods("/index.html", ["GET", "HEAD"], (HttpContext ctx) => SendApp(ctx, publicDir, files));

        // The Android app's stylesheet; everyone else's is the file as it is.
        app.Use(async (ctx, next) =>
        {
            if ((HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method))
                && ctx.Request.Path.Value == "/style.css" && IsApp(ctx))
            {
                var css = await File.ReadAllTextAsync(Path.Combine(publicDir, "style.css"));
                var extra = "";
                try { extra = "\n" + await File.ReadAllTextAsync(Path.Combine(publicDir, "android.css")); } catch (IOException) { /* none */ }
                await Send(ctx, SafeArea().Replace(css, "0px") + extra, "text/css; charset=utf-8");
                return;
            }
            await next();
        });

        // Every other file in public/, as the Node server served them: an
        // hour's cache, but the page's own files (html, js, css, json) asked
        // after each time, so an update is seen at once.
        var types = new FileExtensionContentTypeProvider();
        types.Mappings[".webmanifest"] = "application/manifest+json";
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = files,
            ContentTypeProvider = types,
            ServeUnknownFileTypes = false,
            OnPrepareResponse = r =>
            {
                var h = r.Context.Response.Headers;
                h.CacheControl = Fresh().IsMatch(r.File.Name) ? "no-cache" : "public, max-age=3600";
                var t = r.Context.Response.ContentType ?? "";
                if ((t.StartsWith("text/", StringComparison.Ordinal) || t.Contains("javascript") || t.Contains("json")) && !t.Contains("charset"))
                    r.Context.Response.ContentType = t + "; charset=utf-8";
                h["X-Mandarin-Answered"] = "C#";
            }
        });
    }

    private static async Task SendApp(HttpContext ctx, string publicDir, IFileProvider files)
    {
        ctx.Response.Headers.Vary = "User-Agent";
        var file = Path.Combine(publicDir, "index.html");
        if (!IsApp(ctx))
        {
            var info = files.GetFileInfo("index.html");
            if (!info.Exists) { ctx.Response.StatusCode = 404; return; }
            var etag = new EntityTagHeaderValue("\"" + info.Length.ToString("x") + "-" + info.LastModified.ToUnixTimeMilliseconds().ToString("x") + "\"", isWeak: true);
            ctx.Response.Headers.ETag = etag.ToString();
            ctx.Response.Headers.LastModified = info.LastModified.ToString("R");
            ctx.Response.Headers.CacheControl = "public, max-age=0";
            ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
            if (ctx.Request.Headers.IfNoneMatch.ToString().Contains(etag.Tag.ToString(), StringComparison.Ordinal)) { ctx.Response.StatusCode = 304; return; }
            ctx.Response.ContentType = "text/html; charset=utf-8";
            ctx.Response.ContentLength = info.Length;
            if (HttpMethods.IsHead(ctx.Request.Method)) return;
            await ctx.Response.SendFileAsync(info);
            return;
        }
        var html = await File.ReadAllTextAsync(file);
        await Send(ctx, ViewportFit().Replace(html, "", 1), "text/html; charset=utf-8");
    }

    // A file made for this request: never kept stale (no-cache), and a
    // "not modified" for a copy that is still current (the app's offline copy).
    private static async Task Send(HttpContext ctx, string body, string type)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        var tag = "W/\"" + Convert.ToHexString(SHA1.HashData(bytes))[..27].ToLowerInvariant() + "\"";
        var h = ctx.Response.Headers;
        h.CacheControl = "no-cache";
        h.Vary = "User-Agent";
        h.ETag = tag;
        h["X-Mandarin-Answered"] = "C#";
        if (ctx.Request.Headers.IfNoneMatch.ToString().Contains(tag, StringComparison.Ordinal)) { ctx.Response.StatusCode = 304; return; }
        ctx.Response.ContentType = type;
        ctx.Response.ContentLength = bytes.Length;
        if (HttpMethods.IsHead(ctx.Request.Method)) return;
        await ctx.Response.Body.WriteAsync(bytes);
    }
}
