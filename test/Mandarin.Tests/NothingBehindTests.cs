using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;

namespace Mandarin.Tests;

/// <summary>
/// What the C# server used to hand to the Node server behind it, answered here (v0.9.0, stage 7 part 7):
///  - the album editor's cover from an address: a picture ffmpeg can't read, an address a browser would
///    read (a space in it), one past the 64 MB this reads, and redirects, followed here;
///  - a JSON body sent without a length (chunked), read to the 2 MB limit;
///  - a library write that fails (the database held by another writer): 500 and why;
///  - a label merge let go by a key of any shape: "Not a merged label".
/// (test/nothing-behind.test.js, in C#.)
/// </summary>
public sealed class NothingBehindTests
{
    private static async Task<(int, JsonNode?)> Answer(Task<Http.Answer> r) { var a = await r; return (a.Status, a.Json); }

    private static void Same((int Status, JsonNode? Json) got, int status, string json)
    {
        Assert.True(got.Status == status, $"{got.Status} {got.Json?.ToJsonString()}");
        JsonAssert.Same(json, got.Json);
    }

    // A body sent as it is written, with no length: chunked.
    private sealed class Chunked(string[] parts) : HttpContent
    {
        protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context)
        {
            foreach (var p in parts) { await stream.WriteAsync(Encoding.UTF8.GetBytes(p)); await stream.FlushAsync(); }
        }
        protected override bool TryComputeLength(out long length) { length = 0; return false; }
    }

    [Test]
    public async Task The_album_editors_cover_from_an_address_redirects_followed_a_browsers_address_read_a_picture_that_cant_be_read_refused()
    {
        await using var s = await Session.Started();
        var one = (await s.Album("Album One"))!;
        var cover = await File.ReadAllBytesAsync(Path.Combine(s.Lib.Music, "Artist A", "Album One", "cover.jpg"));
        // A web server with a cover, the ways to it, and pictures that aren't.
        FakeServer? web = null;
        await using var w = web = await FakeServer.Start(async ctx =>
        {
            var u = ctx.Features.Get<IHttpRequestFeature>()!.RawTarget;
            var res = ctx.Response;
            switch (u)
            {
                case "/cover.jpg" or "/a%20cover.jpg": res.ContentType = "image/jpeg"; await res.Body.WriteAsync(cover); return;
                case "/moved": res.StatusCode = 301; res.Headers.Location = "/moved-again"; return;
                case "/moved-again": res.StatusCode = 302; res.Headers.Location = web!.Base + "/cover.jpg"; return;
                case "/round": res.StatusCode = 302; res.Headers.Location = "/round"; return;
                // A JPEG's first bytes, then nothing a reader can make a picture of.
                case "/broken.jpg":
                    res.ContentType = "image/jpeg";
                    await res.Body.WriteAsync((byte[])[0xff, 0xd8, 0xff, 0xe0, .. Enumerable.Repeat((byte)7, 4000)]);
                    return;
                // 65 MB, sent without a length.
                case "/huge.jpg":
                    res.ContentType = "image/jpeg";
                    var chunk = new byte[1 << 20];
                    try { for (int i = 0; i < 65; i++) await res.Body.WriteAsync(chunk, ctx.RequestAborted); } catch (OperationCanceledException) { }
                    return;
                default: res.StatusCode = 404; return;
            }
        });
        var W = web.Base;
        Task<(int, JsonNode?)> Edit(string artUrl) => Answer(s.Api("album/edit", new { offset = one.Num("offset"), art_url = artUrl }));

        // Moved twice, then the cover: kept.
        var (status, body) = await Edit(W + "/moved");
        Assert.True(status == 200, body?.ToJsonString());
        Assert.Equal((true, W + "/moved"), (body?["art"].Bool("found") ?? false, body?["art"].Str("source")));
        // Moved for ever: as the Node server's fetch gave up.
        Same(await Edit(W + "/round"), 502, """{"error":"Couldn't download that image (fetch failed)"}""");
        // A space in the address, as a browser reads it.
        (status, body) = await Edit(W + "/a cover.jpg");
        Assert.True(status == 200, body?.ToJsonString());
        // A picture that can't be read, and one too big to read.
        Same(await Edit(W + "/broken.jpg"), 422, """{"error":"Couldn't read that image"}""");
        Same(await Edit(W + "/huge.jpg"), 502, """{"error":"Couldn't download that image (too large)"}""");
    }

    [Test]
    public async Task A_JSON_body_sent_without_a_length_is_read_to_the_2_MB_limit()
    {
        await using var s = await Session.Started();
        var one = (await s.Album("Album One"))!;
        Task<(int, JsonNode?)> Send(params string[] parts)
        {
            var c = new Chunked(parts);
            c.Headers.ContentType = new("application/json");
            return Answer(Http.Send(HttpMethod.Post, s.Base + "/api/album/edit", c, s.H));
        }
        var (status, body) = await Send(Http.Json(new { offset = one.Num("offset"), year = 2001 }));
        Assert.True(status == 200, body?.ToJsonString());
        Assert.Equal(2001, body.Num("year"));
        var big = Http.Json(new { offset = one.Num("offset"), title = new string('x', 3 << 20) });
        Same(await Send(big[..(1 << 20)], big[(1 << 20)..]), 413, """{"error":"request entity too large"}""");
    }

    [Test]
    public async Task A_library_write_that_fails_says_why_a_merged_label_let_go_by_a_key_of_any_shape()
    {
        await using var s = await Session.Started();
        Task<(int, JsonNode?)> Delete(string p) => Answer(Http.Send(HttpMethod.Delete, s.Base + p, null, s.H));
        Same(await Delete("/api/labels/merge/not-a-key"), 404, """{"error":"Not a merged label"}""");
        // The database held by another writer, past the server's wait for it.
        s.Server.Exec("BEGIN IMMEDIATE");
        bool held = true;
        try
        {
            var (status, body) = await Delete("/api/labels/merge/abc");
            Assert.True(status == 500, body?.ToJsonString());
            Assert.Matches("database is locked", body.Str("error"));
            (status, body) = await Answer(s.Api("settings/labels", new { enabled = true }));
            Assert.True(status == 500, body?.ToJsonString());
            Assert.Matches("database is locked", body.Str("error"));
            s.Server.Exec("ROLLBACK");
            held = false;
            Same(await Answer(s.Api("settings/labels", new { enabled = true })), 200, """{"ok":true,"enabled":true}""");
        }
        finally { if (held) s.Server.Exec("ROLLBACK"); }
    }
}
