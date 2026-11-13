using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

public sealed partial class AutoCoversTests
{
    /// <summary>
    /// The three catalogues stood in for, on one local server (iTunes at its root, Deezer under /dz,
    /// MusicBrainz under /mb, the Cover Art Archive under /caa), answering as each does: an album
    /// known to iTunes by its title, its tracks by its id, its artwork a real JPEG. Every request
    /// written down with when it came; [Before] runs first and may answer instead (a hold, a 503).
    /// </summary>
    private sealed class Catalogue : IAsyncDisposable
    {
        public sealed record Known(int Id, string Title, string Artist, string[] Tracks);

        private readonly FakeServer srv;
        private readonly List<Known> known;
        private readonly byte[] jpeg;
        public readonly ConcurrentQueue<(long At, string Path, string Query)> Asked = new();
        public Func<HttpContext, Task<bool>>? Before;

        public string Base => srv.Base;

        private Catalogue(FakeServer srv, List<Known> known, byte[] jpeg) { this.srv = srv; this.known = known; this.jpeg = jpeg; }

        public static async Task<Catalogue> Start(byte[] jpeg, params Known[] known)
        {
            Catalogue? me = null;
            var srv = await FakeServer.Start(ctx => me!.Answer(ctx));
            me = new Catalogue(srv, [.. known], jpeg);
            return me;
        }

        /* The server's options pointing every catalogue here. */
        public Dictionary<string, object?> Options(int gapMs = 0) => new()
        {
            ["autoCovers"] = true, ["autoCoversGapMs"] = gapMs, ["itunesBaseUrl"] = Base, ["deezerBaseUrl"] = Base + "/dz",
            ["mbBaseUrl"] = Base + "/mb", ["coverartBaseUrl"] = Base + "/caa"
        };

        /* iTunes album searches, by the term each was for. */
        public List<(long At, string Term)> AlbumSearches() =>
            [.. Asked.Where(a => a.Path == "/search" && a.Query.Contains("entity=album", StringComparison.Ordinal))
                .Select(a => (a.At, Uri.UnescapeDataString(a.Query.Split("term=")[1].Split('&')[0])))];

        public int Searched(string title) => AlbumSearches().Count(a => a.Term.Contains(title, StringComparison.Ordinal));
        // The cover search's MusicBrainz lookups (the release days' are /mb/release-group/).
        public int MusicBrainz() => Asked.Count(a => a.Path == "/mb/release/");

        private async Task Answer(HttpContext ctx)
        {
            var path = ctx.Request.Path.Value ?? "";
            var query = ctx.Request.QueryString.Value ?? "";
            Asked.Enqueue((Stopwatch.GetTimestamp() * 1000 / Stopwatch.Frequency, path, query));
            if (Before != null && await Before(ctx)) return;
            if (path.StartsWith("/art/", StringComparison.Ordinal) || path == "/other.jpg")
            {
                ctx.Response.ContentType = "image/jpeg";
                await ctx.Response.Body.WriteAsync(jpeg);
                return;
            }
            JsonNode body = path switch
            {
                "/search" => new JsonObject { ["results"] = new JsonArray([.. Matching(ctx.Request.Query["term"].ToString()).Select(Collection)]) },
                "/lookup" => Lookup(ctx.Request.Query["id"].ToString()),
                "/dz/search/album" => new JsonObject { ["data"] = new JsonArray() },
                "/mb/release/" => new JsonObject { ["releases"] = new JsonArray() },
                _ => new JsonObject()
            };
            if (body is JsonObject { Count: 0 }) ctx.Response.StatusCode = 404;
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsync(body.ToJsonString());
        }

        private IEnumerable<Known> Matching(string term) => known.Where(k => term.Contains(k.Title, StringComparison.Ordinal) || k.Tracks.Any(t => term.Contains(t, StringComparison.Ordinal)));

        private JsonNode Collection(Known k) => new JsonObject
        {
            ["wrapperType"] = "collection", ["collectionId"] = k.Id, ["collectionName"] = k.Title, ["artistName"] = k.Artist,
            ["trackCount"] = k.Tracks.Length, ["artworkUrl100"] = $"{Base}/art/{k.Id}/100x100bb.jpg"
        };

        private JsonNode Lookup(string id)
        {
            var k = known.FirstOrDefault(x => x.Id.ToString(System.Globalization.CultureInfo.InvariantCulture) == id);
            if (k == null) return new JsonObject { ["results"] = new JsonArray() };
            var results = new JsonArray(Collection(k));
            foreach (var t in k.Tracks) results.Add(new JsonObject { ["wrapperType"] = "track", ["kind"] = "song", ["trackName"] = t });
            return new JsonObject { ["results"] = results };
        }

        public ValueTask DisposeAsync() => srv.DisposeAsync();
    }

    /* A JPEG of this size, made by ffmpeg. */
    private static byte[] Jpeg(string dir, int size)
    {
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, $"cover-{size}.jpg");
        var r = Fixtures.Run(["-loglevel", "error", "-y", "-f", "lavfi", "-i", $"color=c=blue:s={size}x{size}", "-frames:v", "1", file]);
        if (r.Code != 0) throw new InvalidOperationException("ffmpeg: " + r.Err);
        return File.ReadAllBytes(file);
    }

    /* A FLAC album whose tracks carry a front cover in them (and none in its folder). */
    private static void Pictured(Fixtures.Library lib)
    {
        var dir = Path.Combine(lib.Music, "Artist C", "Pictured");
        var plain = Path.Combine(lib.Root, "plain.flac");
        Fixtures.Gen(plain, tags: new Dictionary<string, object> { ["title"] = "P 1", ["artist"] = "Artist C", ["album"] = "Pictured", ["track"] = 1, ["date"] = "2001" });
        var pic = Path.Combine(lib.Root, "pic.jpg");
        File.WriteAllBytes(pic, Jpeg(Path.Combine(lib.Root, "pics"), 200));
        Directory.CreateDirectory(dir);
        var r = Fixtures.Run(["-loglevel", "error", "-y", "-i", plain, "-i", pic, "-map", "0:a", "-map", "1", "-c", "copy",
            "-disposition:v", "attached_pic", "-metadata:s:v", "comment=Cover (front)", Path.Combine(dir, "01 P 1.flac")]);
        if (r.Code != 0) throw new InvalidOperationException("ffmpeg: " + r.Err);
    }
}
