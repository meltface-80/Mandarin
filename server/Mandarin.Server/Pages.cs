// Pages.cs — the page and its files (public/), moved from index.js in v0.8.3.
//
// What is a file in public/ is served here, behind the gate: the page, its
// script and stylesheets, the icons and fonts, and Shelf's page at /shelf
// (v0.8.28). Since v0.8.48 (stage 5 part 7) the rest of the Node server's
// pages too: the sign-in page (/login) and the wall display's (/display),
// sent as the files they are, and the page for any other address it opens
// (a deep link: a GET outside /api/, /stream/, /internal/ and /upnp/ that
// names no file), as its app.get("*") sent it; a folder of public/ asked for
// without its slash is sent there, as express.static sent it.
//
// The Android app's WebView gets two files of its own, as before: the page
// without viewport-fit=cover, and the stylesheet with every safe-area
// allowance at zero plus the app's own rules (public/android.css): the app
// has already made the room around the page, whatever the WebView reports.
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
        if (!Directory.Exists(publicDir)) { Server.Log($"[server] no page at {publicDir}; the Node server serves it"); return; }
        var files = new PhysicalFileProvider(publicDir);

        // The page itself, at / and /index.html.
        app.MapMethods("/", ["GET", "HEAD"], (HttpContext ctx) => SendApp(ctx, publicDir, files));
        app.MapMethods("/index.html", ["GET", "HEAD"], (HttpContext ctx) => SendApp(ctx, publicDir, files));
        // Shelf (v0.8.28), as the Node server sent it: the file as it is, for
        // the app's WebView too. The route takes /shelf/ as well (a second
        // route for it would be the same one twice, and neither would answer).
        // Switched off in Settings (v1.0.2, Features.cs), each is a page saying so.
        app.MapMethods("/shelf", ["GET", "HEAD"], (HttpContext ctx) => SendFile(ctx, files, Features.Page(Features.Shelf, "shelf.html")));
        // The sign-in page (open) and the wall display's (v0.8.48), likewise; the route takes /display/ too.
        app.MapMethods("/login", ["GET", "HEAD"], (HttpContext ctx) => SendFile(ctx, files, "login.html"));
        app.MapMethods("/display", ["GET", "HEAD"], (HttpContext ctx) => SendFile(ctx, files, Features.Page(Features.Display, "display.html")));
        Dir = publicDir;
        Files = files;

        // The Android app's stylesheet; everyone else's is the file as it is.
        app.Use(async (ctx, next) =>
        {
            if ((HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method))
                && ctx.Request.Path.Value == "/style.css" && IsApp(ctx))
            {
                string css = Path.Combine(publicDir, "style.css"), android = Path.Combine(publicDir, "android.css");
                await SendMade(ctx, "style.css", [css, android], async () =>
                {
                    var extra = "";
                    try { extra = "\n" + await File.ReadAllTextAsync(android); } catch (IOException) { /* none */ }
                    return SafeArea().Replace(await File.ReadAllTextAsync(css), "0px") + extra;
                }, "text/css; charset=utf-8");
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
                Guarded(r.Context.Response, r.File.Name);
            }
        });
    }

    private static string? Dir;
    private static IFileProvider? Files;

    /*
     * Every file of the page (v0.9.0, the audit's S2): its type as named, no
     * referrer beyond this server, and a page that acts (all but the wall
     * display, which is shown and may be framed) only in a frame of its own
     * origin, so no other site can frame it and steer clicks on it.
     */
    private static void Guarded(HttpResponse r, string name)
    {
        var h = r.Headers;
        h["X-Content-Type-Options"] = "nosniff";
        h["Referrer-Policy"] = "same-origin";
        if (name.EndsWith(".html", StringComparison.OrdinalIgnoreCase) && !name.StartsWith("display", StringComparison.OrdinalIgnoreCase))
        {
            h["Content-Security-Policy"] = "frame-ancestors 'self'";
            h["X-Frame-Options"] = "SAMEORIGIN";
        }
    }

    /*
     * After the routes are chosen (Program.cs): a request no route of this
     * server's took, answered with the page (as the Node server's app.get("*")
     * did) or a folder's redirect (express.static). Everything else goes on to
     * Pages.NotThere.cs.
     */
    public static void UseDeepLinks(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            if (Dir != null && Files != null && Unclaimed(ctx) && (HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method)))
            {
                var p = ctx.Request.Path.Value ?? "/";
                bool nodes = p == "/api" || p.StartsWith("/api/", StringComparison.Ordinal) || p.StartsWith("/stream/", StringComparison.Ordinal)
                    || p.StartsWith("/internal/", StringComparison.Ordinal) || p.StartsWith("/upnp/", StringComparison.Ordinal);
                if (!nodes)
                {
                    if (FolderWithoutSlash(p)) { await RedirectToFolder(ctx); return; }
                    await SendApp(ctx, Dir, Files);
                    return;
                }
            }
            await next();
        });
    }

    /* No route here took it (the not-found answer aside, Pages.NotThere.cs). */
    private static bool Unclaimed(HttpContext ctx) => ctx.GetEndpoint() switch
    {
        null => true,
        Microsoft.AspNetCore.Routing.RouteEndpoint re => re.RoutePattern.RawText == "/{**catch-all}",
        _ => false
    };

    /* A folder of public/, named without its last slash (serve-static sends it there). */
    private static bool FolderWithoutSlash(string p)
    {
        if (p.EndsWith('/') || p.Split('/').Any(seg => seg.StartsWith('.'))) return false;
        try
        {
            var full = Path.GetFullPath(Path.Combine(Dir!, p.TrimStart('/')));
            return full.StartsWith(Path.GetFullPath(Dir!).TrimEnd('/') + "/", StringComparison.Ordinal) && Directory.Exists(full);
        }
        catch (Exception e) when (e is ArgumentException or IOException or NotSupportedException) { return false; }
    }

    /* serve-static's redirect for a folder: 301 to the address with its slash, a short page saying so. */
    private static async Task RedirectToFolder(HttpContext ctx)
    {
        var raw = ctx.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpRequestFeature>()?.RawTarget ?? (ctx.Request.Path + ctx.Request.QueryString).ToString();
        var q = raw.IndexOf('?');
        var path = q < 0 ? raw : raw[..q];
        var loc = "/" + (path + "/").TrimStart('/') + (q < 0 ? "" : raw[q..]);
        var doc = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Redirecting</title>\n</head>\n<body>\n<pre>Redirecting to "
            + System.Net.WebUtility.HtmlEncode(loc) + "</pre>\n</body>\n</html>\n";
        var bytes = Encoding.UTF8.GetBytes(doc);
        var h = ctx.Response.Headers;
        ctx.Response.StatusCode = 301;
        h["X-Mandarin-Answered"] = "C#";
        h.ContentType = "text/html; charset=UTF-8";
        h["Content-Security-Policy"] = "default-src 'none'";
        h["X-Content-Type-Options"] = "nosniff";
        h.Location = loc;
        ctx.Response.ContentLength = bytes.Length;
        if (!HttpMethods.IsHead(ctx.Request.Method)) await ctx.Response.Body.WriteAsync(bytes);
    }

    private static async Task SendApp(HttpContext ctx, string publicDir, IFileProvider files)
    {
        ctx.Response.Headers.Vary = "User-Agent";
        if (!IsApp(ctx)) { await SendFile(ctx, files, "index.html"); return; }
        var page = Path.Combine(publicDir, "index.html");
        await SendMade(ctx, "index.html", [page], async () => ViewportFit().Replace(await File.ReadAllTextAsync(page), "", 1), "text/html; charset=utf-8");
    }

    // A page in public/ as it is on disc, as Express's sendFile sends it: its
    // size and time as a weak tag, asked after each time.
    private static async Task SendFile(HttpContext ctx, IFileProvider files, string name)
    {
        var info = files.GetFileInfo(name);
        if (!info.Exists) { ctx.Response.StatusCode = 404; return; }
        // The time to the nearest millisecond, as Node's fs.Stats gives it: send's tag, and its
        // Last-Modified (a file written at .9995 s is the next second there, so here too).
        var ms = (long)Math.Floor((info.LastModified.UtcTicks - DateTimeOffset.UnixEpoch.UtcTicks) / 10000.0 + 0.5);
        var etag = new EntityTagHeaderValue("\"" + info.Length.ToString("x", System.Globalization.CultureInfo.InvariantCulture) + "-" + ms.ToString("x", System.Globalization.CultureInfo.InvariantCulture) + "\"", isWeak: true);
        ctx.Response.Headers.ETag = etag.ToString();
        ctx.Response.Headers.LastModified = DateTimeOffset.FromUnixTimeMilliseconds(ms).ToString("R");
        ctx.Response.Headers.CacheControl = "public, max-age=0";
        ctx.Response.Headers.AcceptRanges = "bytes";
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        Guarded(ctx.Response, name);
        if (ctx.Request.Headers.IfNoneMatch.ToString().Contains(etag.Tag.ToString(), StringComparison.Ordinal)) { ctx.Response.StatusCode = 304; return; }
        ctx.Response.ContentType = "text/html; charset=UTF-8";
        ctx.Response.ContentLength = info.Length;
        if (HttpMethods.IsHead(ctx.Request.Method)) return;
        await ctx.Response.SendFileAsync(info);
    }

    // A file made for the app (Pages.Kept.cs): never kept stale by it (no-cache),
    // and a "not modified" for a copy that is still current (the app's offline copy).
    private static async Task Send(HttpContext ctx, byte[] bytes, string tag, string type)
    {
        var h = ctx.Response.Headers;
        h.CacheControl = "no-cache";
        h.Vary = "User-Agent";
        h.ETag = tag;
        h["X-Mandarin-Answered"] = "C#";
        Guarded(ctx.Response, type.StartsWith("text/html", StringComparison.Ordinal) ? "index.html" : "");
        if (ctx.Request.Headers.IfNoneMatch.ToString().Contains(tag, StringComparison.Ordinal)) { ctx.Response.StatusCode = 304; return; }
        ctx.Response.ContentType = type;
        ctx.Response.ContentLength = bytes.Length;
        if (HttpMethods.IsHead(ctx.Request.Method)) return;
        await ctx.Response.Body.WriteAsync(bytes);
    }
}
