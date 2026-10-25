using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// One way in and one way out for every route (v0.9.2, the audit's Q1; server/Mandarin.Server/Http.cs):
/// a body turned down alike wherever it is sent (not JSON, or not an object or an array, a 400; a
/// charset that isn't a UTF one a 415; past 2 MB a 413, with a length or without); and a JSON answer
/// as res.json sent it, with its weak tag, "not modified" for a copy still current, no body to a HEAD
/// (test/http-body.test.js, in C#). Item 173: only a body typed as JSON read as JSON, a name given twice
/// its last value (never a 500), and a renderer's event (before the gate) read to 1 MB at most.
/// </summary>
public sealed class HttpBodyTests
{
    [Test]
    public async Task A_body_turned_down_alike_by_every_route_that_reads_one()
    {
        await using var s = await Session.Started();
        var big = "[" + string.Concat(Enumerable.Repeat("1,", 1100000)) + "1]";
        // [body (null: the big one in chunks, no length), content type, status, error]
        var bodies = new (string? Body, string Type, int Status, string Error)[]
        {
            ("{not json", "application/json", 400, "Bad JSON"),
            ("\"a string\"", "application/json; charset=utf-8", 400, "Bad JSON"),
            ("{}", "application/json; charset=latin1", 415, "unsupported charset \"LATIN1\""),
            (big, "application/json", 413, "request entity too large"),
            (null, "application/json", 413, "request entity too large")
        };
        // Each way a route read one: the settings' and playback's (Auth.Body), the library's (JsBody), the
        // services' and a device's (put back for a route after them), and no route's (Pages.NotThere).
        var routes = new[] { ("POST", "/api/settings/display"), ("POST", "/api/control"), ("POST", "/api/share/encode"),
            ("POST", "/api/library/cleanup"), ("PATCH", "/api/audio-devices/nobody"), ("POST", "/api/nothing") };
        foreach (var (method, p) in routes)
        {
            foreach (var (body, type, status, error) in bodies)
            {
                HttpContent content = body != null
                    ? new ByteArrayContent(Encoding.UTF8.GetBytes(body))
                    : new StreamContent(new MemoryStream(Encoding.UTF8.GetBytes(big))); // no length: sent in chunks
                content.Headers.ContentType = MediaTypeHeaderValue.Parse(type);
                if (body == null) content.Headers.ContentLength = null;
                var r = await Http.Send(new HttpMethod(method), s.Base + p, content, s.H);
                var what = body == null ? "2 MB in chunks" : body[..Math.Min(12, body.Length)];
                Assert.Equal($"{method} {p} {what} {status} C# {error}", $"{method} {p} {what} {r.Status} {r.Header("x-mandarin-answered")} {r.J.Str("error")}");
                Assert.Single(r.J.AsObject());
            }
        }
    }

    [Test]
    public async Task Every_JSON_answer_as_res_json_sent_it_its_tag_not_modified_while_current_no_body_to_a_HEAD()
    {
        await using var s = await Session.Started();
        // Sign-in's, playback's, the library's, a download's and no route's, each once with its own writer.
        foreach (var (p, status) in new[] { ("/api/auth/devices", 200), ("/api/zones", 200), ("/api/settings/display", 200), ("/api/download/t987654", 404), ("/api/nothing", 404) })
        {
            var r = await Http.Get(s.Base + p, s.H);
            Assert.True(r.Status == status, p + " " + r.Text);
            Assert.Matches("^application/json; charset=utf-8$", r.Header("content-type"));
            var tag = r.Header("etag");
            Assert.True(tag != null && Regex.IsMatch(tag, "^W/\"[0-9a-f]+-[A-Za-z0-9+/]{27}\"$"), p + ": the etag package's weak tag: " + tag);
            var again = await Http.Get(s.Base + p, new Dictionary<string, string>(s.H) { ["If-None-Match"] = tag! });
            Assert.True(again.Status == (status == 200 ? 304 : status), p + ": a copy still current");
            if (status != 200) continue;
            var head = await Http.Send(HttpMethod.Head, s.Base + p, null, s.H);
            Assert.Equal((200, tag, ""), (head.Status, head.Header("etag"), head.Text));
        }
    }

    [Test]
    public async Task Only_a_body_typed_as_JSON_is_read_as_JSON_not_one_that_merely_says_json_somewhere()
    {
        await using var s = await Session.Started();
        // "text/plain; x=json" is a type a page on any site may send here without asking first (CORS's
        // safelist): read as JSON, a cross-site form could have written through every route (item 173).
        var routes = new[] { ("POST", "/api/settings/display"), ("POST", "/api/control"), ("POST", "/api/share/encode"),
            ("POST", "/api/library/cleanup"), ("PATCH", "/api/audio-devices/nobody"), ("POST", "/api/nothing") };
        var json = new[] { "application/json", "Application/JSON; charset=utf-8", "application/vnd.api+json", "application/merge-patch+json; charset=utf-8" };
        var notJson = new[] { "text/plain; x=json", "text/plain; charset=json", "text/json", "application/jsonx", "application/x-json-stream", "multipart/form-data; boundary=json" };
        foreach (var (method, p) in routes)
        {
            async Task<Http.Answer> Sent(string type)
            {
                var content = new ByteArrayContent(Encoding.UTF8.GetBytes("{not json"));
                content.Headers.TryAddWithoutValidation("Content-Type", type);
                return await Http.Send(new HttpMethod(method), s.Base + p, content, s.H);
            }
            foreach (var type in json)
            {
                var r = await Sent(type);
                Assert.Equal($"{method} {p} [{type}] 400 Bad JSON", $"{method} {p} [{type}] {r.Status} {r.J.Str("error")}");
            }
            var plain = await Sent("text/plain");
            foreach (var type in notJson)
            {
                var r = await Sent(type);
                Assert.Equal($"{method} {p} [{type}] {plain.Status} {plain.Text}", $"{method} {p} [{type}] {r.Status} {r.Text}");
            }
        }
    }

    [Test]
    public async Task A_name_given_twice_in_a_body_is_read_as_JSON_parse_reads_it_the_last_one_kept_never_a_500()
    {
        await using var s = await Session.Started();
        var once = await Http.Post(s.Base + "/api/auth/challenge", new { username = Session.User });
        Assert.Equal(200, once.Status);
        // The account's salt for its name; a name that isn't one has a made-up salt of its own (Auth.Decoy).
        foreach (var body in new[] { $$"""{"username":"nobody","username":"{{Session.User}}"}""",
            $$"""{"username":"{{Session.User}}","kind":{"a":1,"a":2},"kind":"android"}""",
            $$"""{"x":[{"a":1,"a":2}],"username":"{{Session.User}}"}""" })
        {
            var r = await Http.Send(HttpMethod.Post, s.Base + "/api/auth/challenge", new StringContent(body, Encoding.UTF8, "application/json"));
            Assert.Equal($"{body} 200 {once.J.Str("salt")}", $"{body} {r.Status} {(r.Json is { } j ? j.Str("salt") : r.Text)}");
        }
        var other = await Http.Send(HttpMethod.Post, s.Base + "/api/auth/challenge", new StringContent("""{"username":"tester","username":"nobody"}""", Encoding.UTF8, "application/json"));
        Assert.Equal(200, other.Status);
        // The last one kept, as JSON.parse keeps it: the made-up salt, not the account's.
        Assert.NotEqual(once.J.Str("salt"), other.J.Str("salt"));
    }

    [Test]
    public async Task A_renderers_event_past_1_MB_is_refused_with_a_413_with_a_length_or_without_one_within_it_taken()
    {
        await using var s = await Session.Started();
        var gena = new Dictionary<string, string> { ["NT"] = "upnp:event", ["NTS"] = "upnp:propchange", ["SID"] = "uuid:x" };
        var notify = new HttpMethod("NOTIFY");
        // Read whole into memory before the gate, a body of any size from anyone who reached the port could
        // have taken the server's memory (item 173): no more than 1 MB is read.
        var big = Encoding.UTF8.GetBytes("<e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\">" + new string(' ', 3 * 1024 * 1024) + "</e:propertyset>");
        foreach (var chunked in new[] { false, true })
        {
            HttpContent content = chunked ? new StreamContent(new MemoryStream(big)) : new ByteArrayContent(big);
            content.Headers.ContentType = MediaTypeHeaderValue.Parse("text/xml; charset=utf-8");
            if (chunked) content.Headers.ContentLength = null;
            var r = await Http.Send(notify, s.Base + "/upnp/event/uuid:nobody", content, gena);
            Assert.Equal($"chunked={chunked} 413 C#", $"chunked={chunked} {r.Status} {r.Header("x-mandarin-answered")}");
        }
        var small = Encoding.UTF8.GetBytes("<e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\">" + new string(' ', 1024 * 1024 - 200) + "</e:propertyset>");
        foreach (var chunked in new[] { false, true })
        {
            HttpContent content = chunked ? new StreamContent(new MemoryStream(small)) : new ByteArrayContent(small);
            content.Headers.ContentType = MediaTypeHeaderValue.Parse("text/xml; charset=utf-8");
            if (chunked) content.Headers.ContentLength = null;
            var r = await Http.Send(notify, s.Base + "/upnp/event/uuid:nobody", content, gena);
            Assert.Equal($"chunked={chunked} 200 C#", $"chunked={chunked} {r.Status} {r.Header("x-mandarin-answered")}");
        }
    }
}
